// ============================================================================
// GOOGLE SIGN-IN THROUGH THE BROWSER
// ============================================================================
// Google refuses to sign in inside embedded browsers, so when the page heads
// for /api/auth/google the app opens the system browser instead (PKCE-style):
//
// 1. make a random verifier; open
//    <APP_URL>/api/auth/google?redirect=/desktop/connect?challenge=<sha256>
// 2. after signing in, the site's /desktop/connect page opens
//    taskmastery://auth?code=<one-time code>
// 3. POST code + verifier to /api/auth/desktop/exchange in the app window;
//    the server checks them and sets the session cookies
//
// Server side: src/lib/auth/desktop-handoff.ts in the web repo.
// ============================================================================

import {BrowserWindow, shell} from 'electron';
import crypto from 'node:crypto';
import path from 'node:path';
import {APP_URL, PROTOCOL, STATIC_DIR, isAppUrl} from './config';

const PENDING_TTL_MS = 15 * 60 * 1000;

let pending: {verifier: string; next: string; startedAt: number} | null = null;

/** The page is starting Google sign-in (login or signup "Google" button) */
export function isGoogleSignInStart(url: string): boolean {
  if (!isAppUrl(url)) return false;
  return new URL(url).pathname === '/api/auth/google';
}

export async function startBrowserSignIn(win: BrowserWindow, url: string) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  // Where the page wanted to land (an invite link, a shared task...)
  const next = new URL(url).searchParams.get('redirect') || '/dashboard';
  pending = {verifier, next, startedAt: Date.now()};

  const connect = `/desktop/connect?challenge=${challenge}`;
  await shell.openExternal(`${APP_URL}/api/auth/google?redirect=${encodeURIComponent(connect)}`);

  await win.loadFile(path.join(STATIC_DIR, 'waiting.html'), {
    query: {login: `${APP_URL}/login`},
  });
}

/** A taskmastery:// link from Windows (first launch or a second instance) */
export function findDeepLink(argv: string[]): string | undefined {
  return argv.find(arg => arg.startsWith(`${PROTOCOL}://`));
}

export function handleDeepLink(win: BrowserWindow, link: string) {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return;
  }
  // taskmastery://auth?code=…
  if (url.hostname !== 'auth') return;

  const code = url.searchParams.get('code');
  const started = pending;
  pending = null;
  if (!code || !started || Date.now() - started.startedAt > PENDING_TTL_MS) {
    // Not one we asked for (or too old): back to the sign-in page
    void win.loadURL(`${APP_URL}/login?error=desktop_handoff`);
    return;
  }

  const body = new URLSearchParams({code, verifier: started.verifier, next: started.next});
  void win.loadURL(`${APP_URL}/api/auth/desktop/exchange`, {
    postData: [{type: 'rawData', bytes: Buffer.from(body.toString())}],
    extraHeaders: 'Content-Type: application/x-www-form-urlencoded\nx-client-type: desktop',
  });
}
