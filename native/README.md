# Native Android App (Capacitor)

This folder wraps the deployed PWA (`https://chinese-learning-2x9.pages.dev`) in a
native Android shell using [Capacitor](https://capacitorjs.com/). The web app is
NOT bundled — the WebView loads the live site, so normal deploys to `main` update
the app content instantly with no APK rebuild.

Rebuild the APK only when something in `native/` changes (widget, deep links,
Capacitor config, app icon, etc.).

## What the native shell adds

- **Home-screen widget** ("Chinese Learning" in the widget picker): three buttons
  that deep-link into the app — 学 Study (`/study`), ✏️ Coach (`/coach`),
  📚 Decks (`/`).
- **Launcher shortcuts**: long-press the app icon for Study / Coach / Analyze.
- **Text-selection entry point**: select text in ANY app, open the selection
  toolbar (⋮ overflow), choose **Sentence Coach** — the app opens on
  `/coach?text=<selection>` and immediately critiques the selected sentence.
  Implemented via Android's `ACTION_PROCESS_TEXT`.
- **Deep-link scheme**: `chineselearning:///<route>` opens the app at that route
  (e.g. `chineselearning:///study`). Usable from other apps, Tasker, etc.

## Getting the APK

CI builds it: the **Android App Build** workflow
(`.github/workflows/android-build.yml`) runs on pushes/PRs touching `native/`
and on manual dispatch. Download the `chinese-learning-debug-apk` artifact from
the workflow run, copy `app-debug.apk` to the phone, and sideload it (you may
need to allow "install unknown apps" for your browser/Files app).

It is a debug-signed APK — fine for personal sideloading, not for Play Store.

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
