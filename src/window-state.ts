// Remembers the window's size, position and maximized state between runs

import {BrowserWindow, Rectangle, app, screen} from 'electron';
import fs from 'node:fs';
import path from 'node:path';

interface WindowState {
  bounds?: Rectangle;
  maximized?: boolean;
}

const file = () => path.join(app.getPath('userData'), 'window-state.json');

export function loadWindowState(): WindowState {
  try {
    const state: WindowState = JSON.parse(fs.readFileSync(file(), 'utf8'));
    // Forget a position on a monitor that's no longer connected
    const visible =
      state.bounds &&
      screen.getAllDisplays().some(({workArea: a}) => {
        const b = state.bounds!;
        return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
      });
    return visible ? state : {maximized: state.maximized};
  } catch {
    return {};
  }
}

export function trackWindowState(win: BrowserWindow) {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (win.isDestroyed()) return;
    const state: WindowState = {
      bounds: win.isMaximized() || win.isMinimized() ? undefined : win.getBounds(),
      maximized: win.isMaximized(),
    };
    // Keep the last normal bounds while maximized
    if (!state.bounds) state.bounds = loadWindowState().bounds;
    try {
      fs.writeFileSync(file(), JSON.stringify(state));
    } catch (error) {
      console.error('Could not save the window state:', error);
    }
  };
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  win.on('resize', later);
  win.on('move', later);
  win.on('maximize', later);
  win.on('unmaximize', later);
  win.on('close', save);
}
