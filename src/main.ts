// ============================================================================
// TASKMASTERY FOR WINDOWS - Electron main process
// ============================================================================
// A thin shell around the hosted site (APP_URL): the server, database and
// secrets stay on the server, and every web deploy reaches the app at once.
// What the shell adds:
// - Google sign-in through the system browser (sign-in-handoff.ts)
// - a screen picker for screen sharing in calls (screen-picker.ts)
// - Windows notifications + tray, so they arrive with the window closed
// - outside links open in the default browser
// - one instance, remembered window size, an offline page, auto-updates
// ============================================================================

import {
  BrowserWindow,
  Menu,
  app,
  clipboard,
  ipcMain,
  session,
  shell,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import path from 'node:path';
import {
  APP_ORIGIN,
  APP_URL,
  ICON_PATH,
  PARTITION,
  PROTOCOL,
  STATIC_DIR,
  isAppUrl,
  originOf,
} from './config';
import {findDeepLink, handleDeepLink, isGoogleSignInStart, startBrowserSignIn} from './sign-in-handoff';
import {installScreenPicker} from './screen-picker';
import {installNotifications} from './notifications';
import {START_HIDDEN_ARG, createTray} from './tray';
import {
  announceUpdated,
  checkForUpdatesNow,
  finishedUpdate,
  simulateUpdate,
  startUpdater,
} from './updater';
import {loadWindowState, trackWindowState} from './window-state';

const isMac = process.platform === 'darwin';
// Installed from the Microsoft Store (MSIX): the Store delivers updates, and
// the package manifest registers taskmastery:// links
const isStore = process.windowsStore === true;

// Windows groups notifications and taskbar entries by this id (= appId in
// electron-builder.yml)
if (process.platform === 'win32') app.setAppUserModelId('com.taskmastery.desktop');

// `npm run dev` gets its own profile, so it runs next to an installed copy
// (one instance per profile) without sharing its sign-in
if (!app.isPackaged) app.setPath('userData', `${app.getPath('userData')} (dev)`);

let mainWindow: BrowserWindow | null = null;
let quitting = false;
// Opened from a taskmastery:// link before the window existed
let pendingDeepLink = findDeepLink(process.argv);

// Permissions the site may have (calls need the microphone; screen sharing
// goes through the picker)
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'notifications',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
]);

// Payment popups (Razorpay's bank / 3-D Secure pages) stay inside the app
const IN_APP_POPUP_HOSTS = [/(^|\.)razorpay\.com$/];

// ----------------------------------------------------------------------------
// One instance; taskmastery:// links
// ----------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Windows: a link starts a second instance, which hands it over here
  app.on('second-instance', (_event, argv) => {
    showWindow();
    const link = findDeepLink(argv);
    if (link && mainWindow) handleDeepLink(mainWindow, link);
  });

  // macOS: links arrive as an event (also before the app is ready)
  app.on('open-url', (event, link) => {
    event.preventDefault();
    if (!mainWindow) {
      pendingDeepLink = link;
      return;
    }
    showWindow();
    handleDeepLink(mainWindow, link);
  });

  // macOS: clicking the Dock icon brings the hidden window back
  app.on('activate', () => {
    if (app.isReady()) showWindow();
  });

  if (!isStore) {
    // In development the link must start electron with this app's folder
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL);
    }
  }

  app.whenReady().then(start);
}

function start() {
  const ses = session.fromPartition(PARTITION);
  // Lets the server tell app traffic apart in logs
  ses.setUserAgent(`${ses.getUserAgent()} TaskMasteryDesktop/${app.getVersion()}`);

  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(originOf(details.requestingUrl) === APP_ORIGIN && ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return originOf(requestingOrigin) === APP_ORIGIN && ALLOWED_PERMISSIONS.has(permission);
  });

  installScreenPicker(ses, () => mainWindow);
  installNotifications(() => mainWindow, showWindow);
  ipcMain.on('desktop:version', event => {
    event.returnValue = app.getVersion();
  });

  Menu.setApplicationMenu(buildAppMenu());
  createTray({
    show: showWindow,
    checkForUpdates: canSelfUpdate() ? checkForUpdatesNow : undefined,
    // The Store package has no auto-start entry (addAutoLaunchExtension)
    canAutoStart: !isStore,
    quit,
  });

  // Restarted by an update: come back the way it was (in the tray or not)
  const updated = canSelfUpdate() ? finishedUpdate() : null;
  const startHidden = process.argv.includes(START_HIDDEN_ARG) || !!updated?.startHidden;
  createMainWindow(!startHidden);

  const updaterOptions = {
    getWindow: () => mainWindow,
    beforeRestart: () => {
      quitting = true;
    },
  };
  if (canSelfUpdate()) {
    startUpdater(updaterOptions);
    if (updated) announceUpdated(updated.version, updated.startHidden);
  } else if (process.argv.includes('--simulate-update')) {
    // `npm run dev -- --simulate-update`: preview the update card
    simulateUpdate(updaterOptions);
  }
}

// ----------------------------------------------------------------------------
// Main window
// ----------------------------------------------------------------------------

function createMainWindow(show: boolean) {
  const state = loadWindowState();
  const win = new BrowserWindow({
    width: state.bounds?.width ?? 1280,
    height: state.bounds?.height ?? 820,
    x: state.bounds?.x,
    y: state.bounds?.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Tazor',
    icon: ICON_PATH,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  mainWindow = win;
  trackWindowState(win);

  win.once('ready-to-show', () => {
    if (!show) return;
    if (state.maximized) win.maximize();
    win.show();
  });

  // Closing hides to the tray; "Quit" in the tray menu really quits
  win.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });
  win.on('focus', () => win.flashFrame(false));
  win.on('closed', () => {
    mainWindow = null;
  });

  guardNavigation(win.webContents);
  addContextMenu(win.webContents);
  showOfflinePageOnFailure(win);

  if (pendingDeepLink) {
    const link = pendingDeepLink;
    pendingDeepLink = undefined;
    // Without a sign-in in progress this just lands on the login page
    handleDeepLink(win, link);
  } else {
    void win.loadURL(`${APP_URL}/dashboard`);
  }
}

function showWindow() {
  if (!mainWindow) {
    createMainWindow(true);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function quit() {
  quitting = true;
  app.quit();
}

app.on('before-quit', () => {
  quitting = true;
});

// ----------------------------------------------------------------------------
// Links and navigation
// ----------------------------------------------------------------------------

function openExternal(url: string) {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
}

function guardNavigation(contents: WebContents) {
  contents.on('will-navigate', (event, url) => {
    // Google blocks sign-in here: do it in the browser
    if (isGoogleSignInStart(url)) {
      event.preventDefault();
      if (mainWindow) void startBrowserSignIn(mainWindow, url);
      return;
    }
    if (isAppUrl(url) || url.startsWith('file:')) return;
    // On an identity provider's page mid sign-in (SSO): let it finish
    const current = contents.getURL();
    if (current && !isAppUrl(current) && !current.startsWith('file:')) return;
    // A link out of the app: the default browser
    event.preventDefault();
    openExternal(url);
  });

  // window.open / target=_blank
  contents.setWindowOpenHandler(({url}) => {
    if (isAppUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {autoHideMenuBar: true, icon: ICON_PATH},
      };
    }
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      // not a URL
    }
    if (IN_APP_POPUP_HOSTS.some(pattern => pattern.test(host))) {
      return {action: 'allow', overrideBrowserWindowOptions: {autoHideMenuBar: true}};
    }
    openExternal(url);
    return {action: 'deny'};
  });

  // Child windows (in-app popups) follow the same rules
  contents.on('did-create-window', child => {
    guardNavigation(child.webContents);
    addContextMenu(child.webContents);
  });
}

// A page that hasn't started rendering by now: the server is stuck (a blank
// window otherwise). Generous, since a dev server compiles pages on demand.
const SLOW_LOAD_MS = 45_000;

function showOfflinePageOnFailure(win: BrowserWindow) {
  const contents = win.webContents;
  const showOffline = (url: string, reason: 'offline' | 'slow') =>
    void win.loadFile(path.join(STATIC_DIR, 'offline.html'), {query: {retry: url, reason}});

  contents.on('did-fail-load', (_event, errorCode, _description, url, isMainFrame) => {
    // -3: the load was replaced by another one (not a failure)
    if (!isMainFrame || errorCode === -3 || !isAppUrl(url)) return;
    showOffline(url, 'offline');
  });

  let slowTimer: NodeJS.Timeout | undefined;
  const clearSlowTimer = () => clearTimeout(slowTimer);
  contents.on('did-start-navigation', details => {
    if (!details.isMainFrame || details.isSameDocument) return;
    clearSlowTimer();
    if (!isAppUrl(details.url)) return;
    slowTimer = setTimeout(() => {
      contents.stop();
      showOffline(details.url, 'slow');
    }, SLOW_LOAD_MS);
  });
  contents.on('dom-ready', clearSlowTimer);
  contents.on('did-fail-load', clearSlowTimer);
}

// ----------------------------------------------------------------------------
// Menus
// ----------------------------------------------------------------------------

function addContextMenu(contents: WebContents) {
  contents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];

    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      items.push({label: suggestion, click: () => contents.replaceMisspelling(suggestion)});
    }
    if (params.misspelledWord) {
      items.push(
        {
          label: 'Add to dictionary',
          click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        },
        {type: 'separator'},
      );
    }

    if (params.linkURL) {
      items.push(
        {label: 'Open link in browser', click: () => openExternal(params.linkURL)},
        {label: 'Copy link', click: () => clipboard.writeText(params.linkURL)},
        {type: 'separator'},
      );
    }

    if (params.isEditable) {
      items.push(
        {role: 'undo', enabled: params.editFlags.canUndo},
        {role: 'redo', enabled: params.editFlags.canRedo},
        {type: 'separator'},
        {role: 'cut', enabled: params.editFlags.canCut},
        {role: 'copy', enabled: params.editFlags.canCopy},
        {role: 'paste', enabled: params.editFlags.canPaste},
        {role: 'selectAll'},
      );
    } else if (params.selectionText) {
      items.push({role: 'copy'});
    }

    if (items.length) Menu.buildFromTemplate(items).popup();
  });
}

function buildAppMenu() {
  // Windows: hidden until Alt is pressed, mostly here for the keyboard
  // shortcuts. macOS: the menu bar, with the usual app menu first.
  const file: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {label: 'Close window', accelerator: 'CmdOrCtrl+W', click: () => mainWindow?.hide()},
      // On macOS Quit is in the app menu
      ...(isMac ? [] : [{label: 'Quit Tazor', accelerator: 'Ctrl+Q', click: quit}]),
    ],
  };
  return Menu.buildFromTemplate([
    ...(isMac ? [{role: 'appMenu'} as MenuItemConstructorOptions] : []),
    file,
    {role: 'editMenu'},
    {
      label: 'View',
      submenu: [
        {
          label: 'Back',
          accelerator: isMac ? 'Cmd+[' : 'Alt+Left',
          click: () => mainWindow?.webContents.navigationHistory.goBack(),
        },
        {
          label: 'Forward',
          accelerator: isMac ? 'Cmd+]' : 'Alt+Right',
          click: () => mainWindow?.webContents.navigationHistory.goForward(),
        },
        {type: 'separator'},
        {role: 'reload'},
        {role: 'forceReload'},
        {role: 'toggleDevTools'},
        {type: 'separator'},
        {role: 'resetZoom'},
        {role: 'zoomIn'},
        {role: 'zoomOut'},
        {type: 'separator'},
        {role: 'togglefullscreen'},
      ],
    },
    {
      label: 'Help',
      submenu: [
        {label: 'Help Centre', click: () => openExternal(`${APP_URL}/help`)},
        {label: 'Privacy Policy', click: () => openExternal(`${APP_URL}/privacy/desktop-app`)},
        ...(canSelfUpdate()
          ? [{label: 'Check for updates', click: checkForUpdatesNow}, {type: 'separator' as const}]
          : [{type: 'separator' as const}]),
        {label: `Tazor ${app.getVersion()}`, enabled: false},
      ],
    },
  ]);
}

// ----------------------------------------------------------------------------
// Updates (updater.ts; GitHub Releases, see electron-builder.yml → publish)
// ----------------------------------------------------------------------------

/** Installed builds update themselves, except from the Store (it updates them) */
function canSelfUpdate() {
  return app.isPackaged && !isStore;
}
