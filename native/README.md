# Native Android App (Capacitor)

This folder wraps the deployed PWA (`https://chinese-learning-2x9.pages.dev`) in a
native Android shell using [Capacitor](https://capacitorjs.com/). The web app is
NOT bundled — the WebView loads the live site, so normal deploys to `main` update
the app content instantly with no APK rebuild.

Rebuild the APK only when something in `native/` changes (widget, deep links,
Capacitor config, app icon, etc.).

## What the native shell adds

- **Home-screen widget** ("Chinese Learning" in the widget picker): two buttons
  that deep-link into the app — 学 Study (`/study`) and ✏️ Coach (`/coach`).
- **Launcher shortcuts**: long-press the app icon for Study / Coach / Analyze.
- **Text-selection entry point**: select text in ANY app, open the selection
  toolbar (⋮ overflow), choose **Sentence Coach** — the app opens on
  `/coach?text=<selection>` and immediately critiques the selected sentence.
  Implemented via Android's `ACTION_PROCESS_TEXT`.
- **Deep-link scheme**: `chineselearning:///<route>` opens the app at that route
  (e.g. `chineselearning:///study`). Usable from other apps, Tasker, etc.

## Getting the APK / updates (Obtainium)

CI builds it: the **Android App Build** workflow
(`.github/workflows/android-build.yml`) runs on pushes/PRs touching `native/`
and on manual dispatch.

- **On `main`** (with signing secrets configured): builds a **signed release
  APK** and publishes it as a GitHub Release (`android-v1.<run>` tags, asset
  `chinese-learning.apk`). `versionCode` is the workflow run number, so every
  release is installable *over* the previous one — no uninstall needed.
- **On branches/PRs**: builds a debug APK and uploads it as the
  `chinese-learning-debug-apk` workflow artifact (throwaway signature; you must
  uninstall before switching between debug and release builds).

**Auto-updates**: install [Obtainium](https://github.com/ImranR98/Obtainium)
on the phone, Add App → paste `https://github.com/jerome3o/claude-for-language`.
Obtainium watches the GitHub Releases and notifies/installs each new version.

**Required GitHub Actions secrets** (repo Settings → Secrets and variables →
Actions):

- `ANDROID_KEYSTORE_BASE64` — base64 of the release keystore
  (alias `chineselearning`)
- `ANDROID_KEYSTORE_PASSWORD` — its store/key password

If the secrets are missing, main builds fall back to the debug artifact rather
than failing. The keystore is precious: if it's lost, the next build can't
update over installed copies (uninstall/reinstall required) — keep a copy in a
password manager.

## Local development

```bash
cd native
npm install
npx cap sync android          # copies config + regenerates gitignored plugin project
cd android && ./gradlew assembleDebug
# APK at android/app/build/outputs/apk/debug/app-debug.apk
```

Requires JDK 21 and the Android SDK (set `ANDROID_HOME`). If the gradle wrapper
can't download its distribution, a system Gradle >= 8.11 works too.

## Key files

- `capacitor.config.json` — app id/name, remote `server.url`, allowed navigation
  hosts, and a Chrome-like `overrideUserAgent` (without it Google OAuth refuses
  to run in a WebView with a `disallowed_useragent` error).
- `android/app/src/main/java/.../MainActivity.java` — routes intents
  (`route` extra or `chineselearning://` data URI) to the corresponding page by
  loading `server.url + route` in the WebView.
- `android/app/src/main/java/.../ProcessTextActivity.java` — receives
  `ACTION_PROCESS_TEXT` selections and forwards to `/coach?text=...`.
- `android/app/src/main/java/.../ShortcutsWidgetProvider.java` +
  `res/layout/widget_shortcuts.xml` + `res/xml/widget_shortcuts_info.xml` — the
  home-screen widget.
- `android/app/src/main/res/xml/shortcuts.xml` — launcher long-press shortcuts.

## Gotchas

- `capacitor.config.json` changes are only picked up after `npx cap sync android`
  (CI does this automatically) — the config is baked into
  `android/app/src/main/assets/capacitor.config.json`. Sync also regenerates
  `android/capacitor-cordova-android-plugins/`, which is gitignored on purpose.
- The widget/shortcut routes are plain web routes; if a page path changes in the
  frontend, update the constants in `ShortcutsWidgetProvider.java`,
  `shortcuts.xml`, and `ProcessTextActivity.java`.
- Sign-in state lives in the WebView's cookies/storage, separate from Chrome and
  the installed PWA — you'll need to sign in once inside the app.
