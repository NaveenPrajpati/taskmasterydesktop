// ============================================================================
// UPDATES - download, install and restart on their own; the user just sees it
// ============================================================================
// Builds installed from our website (GitHub Releases, electron-builder.yml →
// publish). The Microsoft Store updates its own installs.
//
// - Checks at start (covers "the app was closed") and every 4 hours (covers
//   "the app stays open for days").
// - A new version downloads in the background: progress in a small card at the
//   window's corner (static/update.*) and on the taskbar button.
// - Then Tazor restarts itself to install it, after a 10 s notice. Straight
//   away when its window is hidden in the tray; never while audio is playing
//   (a call), it waits for a quiet minute instead.
// - Quit before that: it installs on quit (autoInstallOnAppQuit).
// - After the restart: "Updated to version X" in the card, or a Windows
//   notification when Tazor came back in the tray (update-state.json).
// ============================================================================

import {BrowserWindow, Notification, app} from 'electron';
import {autoUpdater} from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import {ICON_PATH, STATIC_DIR} from './config';

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const RESTART_NOTICE_S = 10;
// Audio in the last minute probably means a call: don't restart yet
const QUIET_BEFORE_RESTART_MS = 60_000;
const CARD_WIDTH = 340;
const CARD_HEIGHT = 96;
const CARD_MARGIN = 20;

/** What the card shows (static/update.js) */
export type UpdateCardState =
  | {phase: 'downloading'; version: string; percent: number}
  | {phase: 'ready'; version: string; seconds: number}
  | {phase: 'waiting'; version: string}
  | {phase: 'restarting'; version: string}
  | {phase: 'updated'; version: string}
  | {phase: 'latest'; version: string}
  | {phase: 'failed'};

interface UpdaterOptions {
  getWindow: () => BrowserWindow | null;
  // Lets the window really close (it normally hides to the tray)
  beforeRestart: () => void;
}

let options: UpdaterOptions;
let phase: 'idle' | 'checking' | 'downloading' | 'ready' = 'idle';
let manualCheck = false;
let readyVersion = '';
let downloadingVersion = '';
let countdown: NodeJS.Timeout | null = null;
let lastAudibleAt = 0;
let simulating = false;

// ---- Remembering an update across the restart ----------------------------------

const stateFile = () => path.join(app.getPath('userData'), 'update-state.json');

function rememberRestart(to: string, startHidden: boolean) {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({from: app.getVersion(), to, startHidden}));
  } catch (error) {
    console.error('Could not save the update state:', error);
  }
}

/**
 * Call once at start: the update this launch finished installing (then
 * forgotten), or null. `startHidden`: Tazor was in the tray before.
 */
export function finishedUpdate(): {version: string; startHidden: boolean} | null {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    fs.rmSync(stateFile(), {force: true});
    // Still the old version: the install didn't happen; it'll be found again
    if (saved?.to !== app.getVersion() || saved?.from === saved?.to) return null;
    return {version: saved.to, startHidden: !!saved.startHidden};
  } catch {
    return null;
  }
}

// ---- The card --------------------------------------------------------------------

let card: BrowserWindow | null = null;
let cardReady = false;
let cardState: UpdateCardState | null = null;
let hideTimer: NodeJS.Timeout | null = null;

const windowInView = (win: BrowserWindow | null): win is BrowserWindow =>
  !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();

function placeCard() {
  const win = options.getWindow();
  if (!card || card.isDestroyed() || !win || win.isDestroyed()) return;
  const b = win.getContentBounds();
  card.setBounds({
    x: Math.round(b.x + b.width - CARD_WIDTH - CARD_MARGIN),
    y: Math.round(b.y + b.height - CARD_HEIGHT - CARD_MARGIN),
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  });
}

function createCard(parent: BrowserWindow) {
  const win = new BrowserWindow({
    parent,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Shows without taking focus from what the user is typing
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'update-preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  cardReady = false;
  win.webContents.once('did-finish-load', () => {
    cardReady = true;
    if (cardState) win.webContents.send('update:state', cardState);
  });
  void win.loadFile(path.join(STATIC_DIR, 'update.html'));

  const follow = () => placeCard();
  const hide = () => hideCard();
  parent.on('move', follow);
  parent.on('resize', follow);
  parent.on('hide', hide);
  parent.on('minimize', hide);
  win.on('closed', () => {
    if (!parent.isDestroyed()) {
      parent.off('move', follow);
      parent.off('resize', follow);
      parent.off('hide', hide);
      parent.off('minimize', hide);
    }
    card = null;
  });
  return win;
}

function showCard(state: UpdateCardState, hideAfterMs?: number) {
  cardState = state;
  const win = options.getWindow();
  // Only over a window that's in view; otherwise nobody would see it
  if (!windowInView(win)) {
    hideCard();
    return;
  }
  if (!card || card.isDestroyed()) card = createCard(win);
  placeCard();
  if (cardReady) card.webContents.send('update:state', state);
  if (!card.isVisible()) card.showInactive();

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = hideAfterMs ? setTimeout(hideCard, hideAfterMs) : null;
}

function hideCard() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  if (card && !card.isDestroyed()) card.hide();
}

function setTaskbarProgress(fraction: number) {
  const win = options.getWindow();
  if (win && !win.isDestroyed()) win.setProgressBar(fraction);
}

// ---- The flow ----------------------------------------------------------------------

function onAvailable(version: string) {
  phase = 'downloading';
  downloadingVersion = version;
  manualCheck = false;
  showCard({phase: 'downloading', version, percent: 0});
  setTaskbarProgress(0.01);
}

function onProgress(version: string, percent: number) {
  if (phase !== 'downloading') return;
  showCard({phase: 'downloading', version, percent: Math.round(percent)});
  setTaskbarProgress(Math.max(0.01, percent / 100));
}

function onDownloaded(version: string) {
  phase = 'ready';
  readyVersion = version;
  setTaskbarProgress(-1);
  scheduleRestart();
}

function scheduleRestart() {
  if (countdown) clearInterval(countdown);
  let seconds = RESTART_NOTICE_S;
  const tick = () => {
    // Hidden in the tray or minimized: nobody's watching, install now
    if (!windowInView(options.getWindow())) return restartNow(true);
    if (Date.now() - lastAudibleAt < QUIET_BEFORE_RESTART_MS) {
      seconds = RESTART_NOTICE_S;
      showCard({phase: 'waiting', version: readyVersion});
      return;
    }
    if (seconds <= 0) return restartNow(false);
    showCard({phase: 'ready', version: readyVersion, seconds});
    seconds -= 1;
  };
  tick();
  countdown = setInterval(tick, 1000);
}

function restartNow(fromTray: boolean) {
  if (countdown) clearInterval(countdown);
  countdown = null;
  if (!fromTray) showCard({phase: 'restarting', version: readyVersion});

  if (simulating) {
    // Development preview: pretend it restarted
    setTimeout(() => {
      simulating = false;
      phase = 'idle';
      announceUpdated(readyVersion, false);
    }, 1500);
    return;
  }

  rememberRestart(readyVersion, fromTray || !windowInView(options.getWindow()));
  options.beforeRestart();
  // isSilent: no installer window; isForceRunAfter: start Tazor again after
  setTimeout(() => autoUpdater.quitAndInstall(true, true), fromTray ? 0 : 1200);
}

/** After an update: say so (card over the window, or a notification from the tray) */
export function announceUpdated(version: string, inTray: boolean) {
  if (inTray) {
    if (Notification.isSupported()) {
      new Notification({title: 'Tazor was updated', body: `You're now on version ${version}.`, icon: ICON_PATH, silent: true}).show();
    }
    return;
  }
  // Give the window a moment to appear first
  setTimeout(() => showCard({phase: 'updated', version}, 6000), 1500);
}

function check(manual: boolean) {
  if (phase !== 'idle') return;
  phase = 'checking';
  manualCheck = manual;
  autoUpdater.checkForUpdates().catch(() => {
    // Reported by the 'error' event
  });
}

/** Start checking and updating (installed builds from our website only) */
export function startUpdater(opts: UpdaterOptions) {
  options = opts;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', info => onAvailable(info.version));
  autoUpdater.on('download-progress', progress => onProgress(downloadingVersion, progress.percent));
  autoUpdater.on('update-downloaded', info => onDownloaded(info.version));
  autoUpdater.on('update-not-available', () => {
    if (manualCheck) showCard({phase: 'latest', version: app.getVersion()}, 5000);
    manualCheck = false;
    phase = 'idle';
  });
  autoUpdater.on('error', error => {
    console.error('Update failed:', error);
    setTaskbarProgress(-1);
    // Only say so when the user asked; background checks retry later
    if (manualCheck || phase === 'downloading') showCard({phase: 'failed'}, 6000);
    else hideCard();
    manualCheck = false;
    phase = 'idle';
  });

  watchAudio();
  check(false);
  setInterval(() => check(false), CHECK_EVERY_MS).unref?.();
}

/** "Check for updates" from the tray or the Help menu */
export function checkForUpdatesNow() {
  if (phase === 'ready') return restartNow(!windowInView(options.getWindow()));
  if (phase === 'downloading') return; // the card already shows it
  check(true);
}

// Calls and other audio postpone the restart
function watchAudio() {
  setInterval(() => {
    const win = options.getWindow();
    if (win && !win.isDestroyed() && win.webContents.isCurrentlyAudible()) {
      lastAudibleAt = Date.now();
    }
  }, 2000).unref?.();
}

/**
 * Development preview of the whole flow without a release
 * (`npm run dev -- --simulate-update`)
 */
export function simulateUpdate(opts: UpdaterOptions, version = '9.9.9') {
  options = opts;
  simulating = true;
  watchAudio();
  setTimeout(() => {
    onAvailable(version);
    readyVersion = version;
    let percent = 0;
    const timer = setInterval(() => {
      percent += 12.5;
      onProgress(version, Math.min(percent, 100));
      if (percent >= 100) {
        clearInterval(timer);
        onDownloaded(version);
      }
    }, 500);
  }, 3000);
}
