// ============================================================================
// CONFIG - which TaskMastery server the app opens
// ============================================================================
// app.config.json holds the production address. While developing,
// `npm run dev` passes --url=http://localhost:3000 (or set TASKMASTERY_URL).
// ============================================================================

import {app} from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.join(__dirname, '..');
export const STATIC_DIR = path.join(ROOT, 'static');
export const ICON_PATH = path.join(ROOT, 'assets', 'icon.png');

/** Custom link scheme: taskmastery://auth?code=… */
export const PROTOCOL = 'taskmastery';

/** Cookies, storage and cache live here (kept across restarts) */
export const PARTITION = 'persist:taskmastery';

function configuredUrl(): string {
  if (!app.isPackaged) {
    const arg = process.argv.find(a => a.startsWith('--url='));
    if (arg) return arg.slice('--url='.length);
    if (process.env.TASKMASTERY_URL) return process.env.TASKMASTERY_URL;
  }
  const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.config.json'), 'utf8'));
  return file.appUrl;
}

export const APP_URL = configuredUrl().replace(/\/$/, '');
export const APP_ORIGIN = new URL(APP_URL).origin;

/** The origin of a URL, or null if it can't be parsed */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export const isAppUrl = (url: string) => originOf(url) === APP_ORIGIN;
