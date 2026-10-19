// ============================================================================
// SCREEN SHARING - a picker for getDisplayMedia()
// ============================================================================
// Chrome shows its own "choose what to share" dialog; Electron on Windows
// doesn't, so a call's "Share screen" would fail without this. The page
// asks, we list screens and windows in a small modal window, and hand back
// the one picked.
// ============================================================================

import {BrowserWindow, Session, desktopCapturer} from 'electron';
import path from 'node:path';
import {APP_ORIGIN, STATIC_DIR, originOf} from './config';

export function installScreenPicker(ses: Session, getWindow: () => BrowserWindow | null) {
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    const parent = getWindow();
    if (!parent || originOf(request.securityOrigin ?? request.frame?.url ?? '') !== APP_ORIGIN) {
      callback(null);
      return;
    }
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: {width: 320, height: 180},
      });
      const chosenId = await pick(parent, sources);
      const chosen = sources.find(s => s.id === chosenId);
      callback(chosen ? {video: chosen} : null);
    } catch (error) {
      console.error('Screen picker failed:', error);
      callback(null);
    }
  });
}

function pick(
  parent: BrowserWindow,
  sources: Electron.DesktopCapturerSource[],
): Promise<string | null> {
  return new Promise(resolve => {
    const picker = new BrowserWindow({
      parent,
      modal: true,
      width: 760,
      height: 540,
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      title: 'Share your screen',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'picker-preload.js'),
        contextIsolation: true,
        sandbox: true,
      },
    });

    let settled = false;
    const finish = (id: string | null) => {
      if (settled) return;
      settled = true;
      resolve(id);
      if (!picker.isDestroyed()) picker.close();
    };

    picker.webContents.ipc.on('picker:choose', (_event, id: unknown) => {
      finish(typeof id === 'string' ? id : null);
    });
    picker.on('closed', () => finish(null));

    picker.webContents.once('did-finish-load', () => {
      picker.webContents.send(
        'picker:sources',
        sources.map(s => ({
          id: s.id,
          name: s.name,
          kind: s.id.startsWith('screen:') ? 'screen' : 'window',
          thumbnail: s.thumbnail.toDataURL(),
        })),
      );
      picker.show();
    });
    void picker.loadFile(path.join(STATIC_DIR, 'picker.html'));
  });
}
