# TaskMastery for Windows

An Electron shell around the hosted TaskMastery site. The server, database
and secrets stay on the server. This app adds a window, a tray icon, Windows
notifications, a screen-share picker, `taskmastery://` links, Google
sign-in through the browser, and auto-updates.

Full developer guide: `docs/dev/desktop-app.md` in the web repo
(`taskMasteryWeb`).

## Setup

```sh
npm install
```

`npm start` / `npm run dev` go through `scripts/start-electron.js`, which
clears `ELECTRON_RUN_AS_NODE` (VS Code and tools inside it set it, and then
Electron starts as plain Node, so `app` is undefined). Running
`electron .` by hand in such a terminal? Unset it first:
`Remove-Item Env:ELECTRON_RUN_AS_NODE` (PowerShell) or
`unset ELECTRON_RUN_AS_NODE` (bash/zsh).

## Develop

Start the web app (`pnpm dev` in `taskMasteryWeb`), then:

```sh
npm run dev      # opens http://localhost:3000, profile "TaskMastery (dev)"
npm start        # opens the URL in app.config.json
```

`--url=<address>` or `TASKMASTERY_URL` overrides the address (unpackaged
runs only).

## Build the installer

1. Set the production address in `app.config.json` (`appUrl`, the web
   app's `NEXT_PUBLIC_APP_URL`).
2. `npm run dist` → `release/TaskMastery-Setup-<version>.exe`

## Release an update

Installed apps check GitHub Releases (`publish` in `electron-builder.yml`)
on start and install updates when they quit.

1. Create the GitHub repo named in `electron-builder.yml`. Make it public,
   or the apps can't download updates.
2. Bump `version` in `package.json`.
3. `GH_TOKEN=<token with repo scope> npm run release`. This uploads the
   installer, its `.blockmap` and `latest.yml` to a release.

## Code signing

Unsigned installers get a SmartScreen "unknown publisher" warning. Sign
with Azure Trusted Signing (fill in `win.azureSignOptions` in
`electron-builder.yml` and set the `AZURE_*` credentials), or with a
code-signing certificate (`CSC_LINK` / `CSC_KEY_PASSWORD`). Store builds
don't need this: the Store signs them.

## Microsoft Store

1. In [Partner Center](https://partner.microsoft.com/dashboard), open a
   developer account and reserve the app name (**Apps and games → New
   product → MSIX or PWA app**).
2. Copy **Product management → Product identity** into the `appx` section
   of `electron-builder.yml`: `Package/Identity/Name` → `identityName`,
   `Package/Identity/Publisher` → `publisher`,
   `Package/Properties/PublisherDisplayName` → `publisherDisplayName`.
3. `npm run dist:store` → `release/TaskMastery-Store-<version>.appx`
   (unsigned; the Store signs it). Upload it under **Packages** in a new
   submission.
4. Updates: bump `version`, build again and submit. The Store installs
   updates; Store installs skip the app's own updater and the "Start with
   Windows" option (no auto-start entry in the package).

Tile images live in `assets/appx/`; regenerate with `npm run store-assets`
after changing `assets/icon.png`.

## macOS

Runs on a Mac with the same steps (`npm install`, `npm run dev`). macOS
builds can only be made on a Mac:

```sh
npm run dist:mac   # release/TaskMastery-<version>.dmg (+ .zip for updates)
```

To give it to other people, sign and notarize it, or macOS blocks it as
"damaged / unidentified developer". This needs an Apple Developer account
and a **Developer ID Application** certificate in the Keychain.
electron-builder signs with it automatically and notarizes when these are
set: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.

On first use, macOS asks for the microphone (calls), and for **Screen
Recording** the first time you share your screen (System Settings →
Privacy & Security).

## Layout

| Path | What |
|---|---|
| `src/main.ts` | app lifecycle, window, navigation rules, permissions, menus, updates |
| `src/config.ts` | which server to open, paths |
| `src/sign-in-handoff.ts` | Google sign-in through the system browser |
| `src/notifications.ts` | Windows notifications from the site |
| `src/tray.ts` | tray icon and menu, start with Windows |
| `src/screen-picker.ts` | `getDisplayMedia` picker |
| `src/preload.ts` | `window.taskmasteryDesktop` for the site |
| `src/picker-preload.ts` | bridge for the picker window |
| `src/window-state.ts` | remembered size and position |
| `static/` | offline page, "continue in your browser" page, picker |
| `assets/icon.png` | app, installer and tray icon |
| `assets/appx/` | Microsoft Store tile images (generated) |
| `assets/entitlements.mac.plist` | macOS hardened-runtime entitlements |
| `scripts/` | dev launcher, Store image generator |
