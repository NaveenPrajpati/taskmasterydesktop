// ============================================================================
// PRELOAD - window.taskmasteryDesktop for the TaskMastery site
// ============================================================================
// The site checks for it (src/app/lib/desktop.ts in the web repo) to show
// Windows notifications and skip web push, which Electron can't do.
// Keep this surface small: the page is remote content.
// ============================================================================

import {contextBridge, ipcRenderer} from 'electron';

interface DesktopNotification {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

contextBridge.exposeInMainWorld('taskmasteryDesktop', {
  platform: process.platform,
  version: ipcRenderer.sendSync('desktop:version') as string,
  notify(notification: DesktopNotification) {
    ipcRenderer.send('desktop:notify', notification);
  },
  onOpenUrl(callback: (path: string) => void) {
    const listener = (_event: Electron.IpcRendererEvent, path: string) => callback(path);
    ipcRenderer.on('desktop:open-url', listener);
    return () => {
      ipcRenderer.removeListener('desktop:open-url', listener);
    };
  },
});
