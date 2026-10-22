// ============================================================================
// WINDOWS NOTIFICATIONS - from the site's live notification stream
// ============================================================================
// Electron has no web push, so the site (LiveNotifications.tsx) calls
// taskmasteryDesktop.notify() for each new notification while the window
// isn't in front. Clicking one brings the window back and opens its page.
// ============================================================================

import {BrowserWindow, Notification, ipcMain} from 'electron';
import {APP_ORIGIN, ICON_PATH, isAppUrl} from './config';

const byTag = new Map<string, Notification>();

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';

export function installNotifications(getWindow: () => BrowserWindow | null, show: () => void) {
  ipcMain.on('desktop:notify', (event, payload: Record<string, unknown>) => {
    // Only our own site may notify
    if (!event.senderFrame || !isAppUrl(event.senderFrame.url)) return;
    if (!Notification.isSupported()) return;

    const title = text(payload?.title, 200);
    if (!title) return;
    const tag = text(payload?.tag, 200);
    const url = text(payload?.url, 2000);

    // A newer one with the same tag replaces the older one
    if (tag) byTag.get(tag)?.close();

    const notification = new Notification({
      title,
      body: text(payload?.body, 500),
      icon: ICON_PATH,
      // The page plays the app's own sound (alert1.wav, notificationSound.ts
      // in the web repo), so Windows' default would double it
      silent: true,
    });
    if (tag) byTag.set(tag, notification);

    notification.on('click', () => {
      show();
      const path = inAppPath(url);
      if (path) getWindow()?.webContents.send('desktop:open-url', path);
    });
    notification.on('close', () => {
      if (tag && byTag.get(tag) === notification) byTag.delete(tag);
    });
    notification.show();

    const win = getWindow();
    if (win && !win.isFocused()) win.flashFrame(true);
  });
}

/** A path on the site for a relative or same-origin URL, else null */
function inAppPath(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, APP_ORIGIN);
    if (!isAppUrl(parsed.href)) return null;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return null;
  }
}
