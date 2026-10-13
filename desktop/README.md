# Chinese Learning — desktop app (prototype)

A Mac (and Windows) app for teaching from a computer. It is **the web app in a window** — the
same site as the PWA, so every web deploy updates it — plus what a browser can't do:

- **Share your screen like in Zoom**: a native picker of screens and windows.
- **Draw and type on your real screen while you share it.** Share an *entire screen* and a
  transparent layer covers it: your student's drawings, pings and texts appear right on your screen
  (not only in the call window), and **🖍️ Draw on screen** lets you circle, point and write on
  anything — a PDF, a website, Keynote — and your student sees it on your shared screen.

Screenshots: `docs/pr-screenshots/desktop-app-prototype/README.md`.

## Install on a Mac

1. Open the newest **Desktop v0.N** pre-release on the repo's
   [Releases page](https://github.com/jerome3o/claude-for-language/releases) and download
   `Chinese-Learning-0.N.0-mac.dmg` (one download for Apple silicon and Intel Macs).
2. Open the `.dmg` and drag **Chinese Learning** onto **Applications**.
3. **First open** — the app is not notarized by Apple yet, so macOS stops it once:
   - Double-click Chinese Learning in Applications. macOS says it "cannot verify" the app → **Done**
     (not "Move to Bin").
   - Open **System Settings → Privacy & Security**, scroll down to *"Chinese Learning" was blocked…*
     and click **Open Anyway**, then **Open Anyway** again and enter your password.
   - (On macOS 14 and older, right-click the app → **Open** → **Open** also works.)
   - From then on it opens normally.
4. **Sign in**: *Sign in with Google* opens your normal browser (Google doesn't allow sign-in inside
   apps). After signing in, the browser asks to open **Chinese Learning** → **Open**, and you're in.
5. **Permissions** (macOS asks the first time each is used):
   - **Camera** and **Microphone** — when you join a video call → **Allow**.
   - **Screen Recording** — the first time you share: the share window says *Allow screen
     recording*; click **Open System Settings**, turn on **Chinese Learning** under
     *Privacy & Security → Screen & System Audio Recording*, then **Quit & reopen**.

> Until the app is signed with an Apple Developer ID, **each new version may ask for Screen
> Recording again** (macOS ties the permission to the app's signature). Turn it off and on again in
> System Settings if sharing shows a black screen after an update.

**Updates**: on start (and *Help → Check for updates…*) the app checks the Releases page and offers
**Download** when there is a newer version; install it the same way (replace the app in
Applications).

### Windows

Download `Chinese-Learning-0.N.0-windows.exe` from the same release and run it. It is unsigned:
SmartScreen says "Windows protected your PC" → **More info → Run anyway**. Drawing on the screen
works the same way; sharing a screen also shares the computer's sound.

## Drawing on your screen in a lesson

1. In a video call, press 🖥️ and choose **Entire screen** (a window can be shared too, but you
   can only draw on it inside the call window).
2. A small toolbar appears at the top of the shared screen. Your student's drawings show on your
   screen as they draw.
3. **🖍️ Draw on screen** (on the toolbar, or *Draw on my real screen* on the call's share bar):
   a blue frame shows the screen is in drawing mode. ✏️ Pen — drag to draw, tap to point "look here";
   **T** — click and type (any input method, Enter to finish, Esc to cancel); colours; 🗑 clears
   everyone's drawings; **✋ Done** (or Esc) gives the mouse back to your apps.
4. Stop sharing and the layer goes away.

## Architecture

```
desktop/
├── src/main.ts            main process: window, navigation rules, permissions, menu, bridge IPC, deep links
├── src/preload.ts         window.desktopBridge for the app page (contextIsolation + sandbox)
├── src/auth.ts            sign-in in the system browser → chineselearning-desktop://auth deep link
├── src/share.ts           getDisplayMedia() → our picker (static/picker.html, src/picker/*)
├── src/overlay.ts         the overlay window (transparent, always on top, click-through, hidden from capture)
├── src/overlay/renderer.ts draws with the web app's frontend/src/services/calls/annotations.ts
├── src/updates.ts         "A new version is available" from GitHub releases
├── src/smoke.ts           end-to-end smoke test (CHINESE_LEARNING_SMOKE=<dir>), used by CI
├── build.mjs              esbuild bundles → dist/ (no node_modules ship)
└── electron-builder.yml   packaging (.dmg / .zip universal, Windows NSIS)
```

- **The bridge** is the only way the page reaches the app. Its contract and every rule that can be
  tested without Electron — what may cross it, the overlay's coordinate mapping, the sign-in deep link,
  the update check — live in `shared/desktop/bridge.ts` (unit-tested with the web app's tests). The
  main process accepts bridge calls only from the app's own origin and overlay events only from the
  overlay window, and cleans both with the call room's own sanitizers.
- **The call page** uses it in `frontend/src/services/calls/desktopOverlay.ts` (`useDesktopOverlay`):
  nothing happens in a browser.
- **Coordinates**: the shared picture of a screen is the whole display, so the annotations' 0..1
  points are 0..1 of the display bounds; Electron gives bounds in DIPs, so Retina scale never enters
  (the canvas only uses it for sharpness). If macOS keeps the overlay below the menu bar, the canvas
  is offset so a point stays on the same pixel (`overlayCanvasRect`).
- **No doubles**: the overlay is excluded from screen capture (`setContentProtection`), so the
  student sees each stroke once — drawn by their own call page over the video.
- **Sign-in**: Google refuses OAuth in embedded browsers, so `…/api/auth/login` opens in the system
  browser with `client=desktop&nonce=…`; the worker (`NATIVE_AUTH_CLIENTS`) redirects to
  `chineselearning-desktop://auth?session_token=…&nonce=…`, and the app loads the web app with
  `?session_token=` (only with the nonce it generated).
- **No secrets** are in the app: it holds nothing but the web app's URL; every key stays in the worker.
- Analytics events from the app carry platform `desktop`; `call.desktop_overlay` records the overlay.

## Developing

You need a desktop (or a virtual display) to run it:

```bash
cd desktop
npm ci
npm start                       # builds and opens the app against the deployed web app
CHINESE_LEARNING_URL=http://localhost:3000 CHINESE_LEARNING_API=http://localhost:8787 npm start
npm run typecheck
# headless end-to-end check (Linux): page → picker → overlay → events back, screenshots in /tmp/smoke
npm run build && CHINESE_LEARNING_SMOKE=/tmp/smoke xvfb-run -a -s "-screen 0 1440x900x24" npx electron --no-sandbox --disable-gpu .
```

CI: `.github/workflows/desktop-build.yml` — type check + bundle + the smoke test on Linux, the Mac
app on `macos-latest` and the Windows installer on every PR touching `desktop/`; on `main` it
publishes a **pre-release `desktop-v0.N`** with the `.dmg`, `.zip` and `.exe`.

## Signing (when there is an Apple Developer account)

Today the Mac app is **ad-hoc signed** (a valid signature with no identity), which is why macOS asks
for "Open Anyway" once and may forget Screen Recording after an update. To sign and notarize it,
join the Apple Developer Program (99 USD / year) and add these **GitHub Actions secrets** — the
workflow switches to them automatically (no code change):

| Secret | What |
|---|---|
| `CSC_LINK` | The **Developer ID Application** certificate + key exported from Keychain as `.p12`, base64-encoded (`base64 -i cert.p12 \| pbcopy`) |
| `CSC_KEY_PASSWORD` | The password chosen when exporting the `.p12` |
| `APPLE_ID` | The Apple ID e-mail of the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID (appleid.apple.com → Sign-In and Security) |
| `APPLE_TEAM_ID` | The 10-character Team ID (developer.apple.com → Membership) |

With `CSC_LINK` set the app is signed with the hardened runtime (`build/entitlements.mac.plist`:
camera, microphone, JIT); with the three `APPLE_*` secrets too, electron-builder notarizes and
staples it, and the first-open steps above go away. Never commit a certificate or password.
Windows signing would need a code-signing certificate (`WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`).

## Not done yet / known limits

- Tested end to end only on Linux (headless); the Mac build is made by CI but the overlay on a real
  Mac — full-screen apps, several displays, the menu bar offset, content protection on the newest
  macOS — needs a first real lesson.
- Sharing the Mac's **sound** is not supported by this API on macOS (Windows shares it); the call
  says so.
- No auto-install of updates (an unsigned app can't replace itself safely): Download opens the release.
- Texts typed on the overlay can't be moved or deleted there yet (Clear removes everything; in the call
  window they can be moved / deleted as before).
