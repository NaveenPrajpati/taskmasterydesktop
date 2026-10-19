// Tray icon (macOS: menu bar icon): closing the window keeps TaskMastery
// running here, so live notifications keep arriving. Quit from its menu.

import {Menu, Tray, app, nativeImage, type MenuItemConstructorOptions} from 'electron';
import {ICON_PATH} from './config';

export const START_HIDDEN_ARG = '--hidden';

const isMac = process.platform === 'darwin';

// macOS login items can't pass arguments, so the app opens with its window there
const openAtLogin = () =>
  app.getLoginItemSettings(isMac ? undefined : {args: [START_HIDDEN_ARG]}).openAtLogin;

export function createTray(actions: {
  show: () => void;
  /** Left out where the app doesn't update itself (Store, development) */
  checkForUpdates?: () => void;
  canAutoStart: boolean;
  quit: () => void;
}): Tray {
  const tray = new Tray(nativeImage.createFromPath(ICON_PATH).resize({width: 16, height: 16}));
  tray.setToolTip('TaskMastery');

  const buildMenu = () => {
    const items: MenuItemConstructorOptions[] = [
      {label: 'Open TaskMastery', click: actions.show},
      {type: 'separator'},
    ];
    if (actions.canAutoStart) {
      items.push({
        label: isMac ? 'Open at login' : 'Start with Windows',
        type: 'checkbox',
        checked: openAtLogin(),
        click: item => {
          // Windows: starts in the tray, not with a window in your face
          app.setLoginItemSettings(
            isMac
              ? {openAtLogin: item.checked}
              : {openAtLogin: item.checked, args: [START_HIDDEN_ARG]},
          );
        },
      });
    }
    if (actions.checkForUpdates) {
      items.push({label: 'Check for updates', click: actions.checkForUpdates});
    }
    items.push({type: 'separator'}, {label: 'Quit TaskMastery', click: actions.quit});
    return Menu.buildFromTemplate(items);
  };

  tray.setContextMenu(buildMenu());
  // Refresh the checkbox in case it was changed in the system settings
  tray.on('right-click', () => tray.setContextMenu(buildMenu()));
  // On macOS a click opens the menu; on Windows it shows the window
  if (!isMac) tray.on('click', actions.show);
  return tray;
}
