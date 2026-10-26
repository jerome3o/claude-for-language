# 🥽 VR (beta) — study in a headset

`/vr` is a WebXR room served by the web app: study, graded readers, homework and the language
explorer as little windows you can grab and place around you, a 🎤 for speaking answers and
look-ups, and 💬 feedback with a screenshot of what you were looking at.

**Open it:** <https://chinese-learning-2x9.pages.dev/vr> (More → Practice → 🥽 VR (beta), or
Settings → Advanced → VR). Sign in as usual; the headset browser keeps you signed in like any other
browser.

Web only, by design (android-lab/PARITY.md "VR"): it ships with every deploy to `main`, reuses the
app's sign-in, API, offline IndexedDB, study queue, audio caches and live transcription, works on
any WebXR headset, and degrades to a **flat 3D preview** (mouse / touch) in every other browser.

## Using it on the Valve Steam Frame

The Frame's stock browser exposes `navigator.xr` but can't start immersive VR
(`isSessionSupported('immersive-vr')` is false), so `/vr` shows the flat preview there. Two
community builds of Chromium for the Frame (SteamOS, arm64) can:

1. **Chromium XR from Frame Tools** (<https://yellkell.com/frame>) — the easy way. On the Frame, in
   Desktop Mode, download *Install Frame Tools* and open it: it adds **Chromium XR** (and
   FramePlayer) to your Steam library. Its source is
   <https://github.com/yellkell/frameplayer/tree/main/docs/webxr>.
2. **chromium-webxr-steam-frame** (<https://github.com/saphid/chromium-webxr-steam-frame>) — build
   it yourself (an x86-64 Linux machine, or the repo's GitHub Actions workflow), copy the tarball to
   the Frame and run `frame/install.sh`; it adds **Chromium XR** to the Steam library too.

⚠️ **Both relax Chromium's sandboxing** so SteamVR accepts the session (the system-call filter is
off; the namespace sandbox stays on), save passwords unencrypted and don't update themselves.
**Use Chromium XR only for this app (and other VR sites you trust); keep the normal browser for
everything else.**

Then:

1. Open **Chromium XR** from the Steam library (it opens as a panel in the headset).
2. Go to <https://chinese-learning-2x9.pages.dev/vr> and sign in with Google.
3. Press **Enter VR**; allow VR when Chromium asks (*Allow while visiting the site*).
4. Allow the microphone the first time you press 🎤.
5. To leave: **Exit VR** on the tray, or the Steam button.

Other headsets (Quest browser, Pico, Android XR, Vision Pro with WebXR on) need nothing extra.

## Controls

| | Controllers | Hands | Flat preview |
|---|---|---|---|
| Point | the ray from the controller | the ray from your hand | the mouse / your finger |
| Press a button, tap a word | trigger | pinch | click / tap |
| Move a window | grab its bar with the trigger, or squeeze (grip) anywhere on it | pinch the bar | drag the bar |
| Look around | turn your head | turn your head | drag empty space, arrow keys |

- **Windows** sit in a ring at arm's length (0.85 m), each turned to face you, their top edge just
  above eye level. Drag one anywhere (it keeps facing you, and stays 0.35–3 m away); ⤒ brings it in
  front of you; ✕ closes it. Where you left each one — and which were open — is remembered on the
  device (`localStorage` `vr-windows-v1`).
- **The tray** is a low desk in front of you: 📚 Study · 📖 Reader · ✅ Homework · 🔍 Explore ·
  🎤 Speak · 💬 Feedback · ↺ Bring here (every window back in front of you) · Exit VR. It follows
  you when you've turned well away from it for a moment.
- **Comfort:** nothing ever moves you (no artificial locomotion, no snapping the view), a calm static
  room, upright panels, text sized for ~0.85 m.

## Windows

| Window | What it is | Reuses |
|---|---|---|
| **Study** | The regular study session: today's queue, card front / back, Show answer, Again / Hard / Good / Easy with their intervals. Reading cards, meaning → hanzi and listening cards (the clip plays itself); the typing cards are answered with 🎤 *Say the answer* (homophones count, like the web). Today's story hands off to the Reader window. | `useStudySession` (same queue, same event-sourced review events in IndexedDB, synced by the existing sync), `checkSpokenAnswer`, note clips from the audio cache |
| **Reader** | Up next (the reader queue) → a story page by page: picture, Chinese, 拼 / EN, ▶ narration, Finish ✓ | `readerQueueOrder`, `recordReaderFinish` (the same read + its homework), cached narration (`getReaderPageTTS`) |
| **Homework** | Home's one-off homework list; a word list is passed right there (Show answer → Not yet / Got it); a reader opens in the Reader window, a lesson in a lesson window; a link says "open it on your phone" | `useHomeworkItems`, `recordPassEvent` |
| **Explorer** | Tap any Chinese in any window: the character / word view with readings, meaning, parts, words with it, ▶; tap inside to go deeper, ← back. 🎤 with the explorer in front looks up what you say. | `shared/explorer` stack, `lookupChar` / `lookupWord` (device cache first) |
| **Mini lesson** | A lesson spec played in VR: `note`, `choice`, `scramble`; other exercise types say "open it on your phone". Practice only — nothing recorded. | `shared/lesson` specs, `validateLessonSpec` |
| **Feedback** | 💬 on the tray: a screenshot of your view, then a message said with 🎤 or quick chips, Send | `POST /api/feedback` through the app's feedback outbox (`services/feedback.ts`; offline → sent later), platform `vr`, via `vr` |

**🎤 Speak** uses the app's live transcription (`useVoiceDictation`: Soniox temporary key from
`POST /api/transcribe/live`, upload fallback) and gives the text to the **focused window** (the
one with the blue bar): Study → the answer, Explorer → a look-up, Feedback → the message.
Anything else with Chinese in it opens the explorer.

## How it's built

```
frontend/src/vr/
  VrPage.tsx          the route (lazy): windows, one PanelHost per window, 🎤, feedback, Enter VR
  windowStore.ts      pure reducer: open / close / focus / move / recall + per-device memory
  panels/*.tsx        one trusted builder per panel kind: hooks → a view of UI nodes (pure *View functions)
  ui/layout.ts        the panel UI kit: text / button / row / list / image / bar → draw ops + hit regions
  ui/draw.ts          paints a layout on a 2D canvas (the window's texture)
  ui/fonts.ts         Noto Sans SC, self-hosted, loaded slice by slice
  scene/VrScene.tsx   three.js via @react-three/fiber: room, windows, tray, session, screenshot
  scene/interaction.ts one pointer pipeline (raycast, hover, click, drag) for mouse and XR rays
  scene/XrInput.tsx   controllers / hands → the pipeline (rays, cursors, joint spheres)
  scene/FlatControls.tsx the flat preview's mouse / keyboard
shared/vr/
  panelSpec.ts        VrPanelSpec + validateVrPanelSpec (content as data)
  layout.ts           placement maths (ring, facing, clamping, dragging, tray)
```

- **The page owns the data, the scene only draws.** Each window's host runs that panel's hooks on
  the normal React side and reports a *view* — plain UI nodes. The scene turns views into canvas
  textures and reports back which action was pressed. Nothing crosses into three.js but data.
- **Windows are canvases.** A panel's nodes are laid out (`ui/layout.ts`, unit-tested with fake
  metrics) and painted on a 2D canvas at 1600 px a metre, used as the window's texture. A ray hit's
  UV → canvas pixel → hit region → action. Text is the browser's own font rendering, so every
  Chinese character renders — no glyph atlas.
- **Fonts:** Noto Sans SC (SIL OFL 1.1) from `@fontsource-variable/noto-sans-sc`, imported only by
  the VR chunk: ~100 woff2 slices by Unicode range; `document.fonts.load` fetches only the slices the
  windows draw. They're left out of the service worker's precache and cached once fetched
  (`vite.config.ts` `vr-fonts`). Latin text uses the system UI font first (CJK fonts draw curly
  quotes full-width).
- **No downloaded models.** Controller / hand models from a CDN (what WebXR libraries usually load)
  would break the CSP and the "no third-party code paths" rule, so rays, cursors and joint spheres
  are plain meshes. That's also why it uses three.js + @react-three/fiber directly rather than
  @react-three/xr (whose controller layouts are fetched from cdn.jsdelivr.net even with models off).
- **Bundle:** three.js + fiber are a lazy `vendor-three` chunk (~235 kB gzip) loaded only by `/vr`;
  the main bundle doesn't change. Pinned exact versions (`three` 0.186.1, `@react-three/fiber` 8.18.0
  — the React 18 line).
- **Sessions:** `immersive-vr` with optional `local-floor`, `bounded-floor`, `hand-tracking`.
  Without `local-floor` the room is lowered by a standing eye height. On entering, every window is
  re-placed around your real head.
- **Screenshot:** flat — the canvas right after a render; in the headset — the scene rendered once
  more into a 1280×800 render target from your head pose, read back and sRGB-encoded.

### Fonts / CSP / permissions

`frontend/public/_headers`: the fonts are `'self'` (no new origin); `Permissions-Policy` adds
`xr-spatial-tracking=(self)`. No new script, style or connect origin.

## Security model — content as data

VR will become dynamic ("make me an exercise view with these cards" generated in-app). That must
never become a way to run code. The rule:

1. **A window is a spec, never code.** Every window is opened from a `VrPanelSpec` — a `kind` from a
   fixed list (`study`, `reader`, `homework`, `explorer`, `lesson_spec`, `feedback`) plus a few
   parameters — checked by `validateVrPanelSpec` (`shared/vr/panelSpec.ts`): unknown kinds and
   unknown keys are refused, ids are plain tokens (never URLs or markup), explorer text is a few
   Chinese characters, an inline lesson must pass `validateLessonSpec`. The same validator guards
   the tray, taps inside windows, what is read back from `localStorage`, and — later — specs Claude
   makes.
2. **A fixed set of trusted renderers.** Each kind has one builder in `frontend/src/vr/panels/`
   that turns validated data into UI nodes from a closed list (text, button, row, list, image,
   divider, progress, bar). Text is drawn as text on a canvas — there is no HTML, no
   `dangerouslySetInnerHTML`, no `eval`, no remote script, no iframes.
3. **Pictures by media key only.** An image node names an R2 media key (`isMediaKey`: no scheme,
   no host, no `..`), loaded as a same-origin blob through the app's own media cache / API — never a
   URL from content.
4. **Generated content is made server-side and validated before storage**, exactly like mini
   lessons and clips today: Claude produces a spec (a `lesson_spec`, or a future kind such as a
   card-drill view over note ids) through a forced tool; the worker validates it (the shared
   validator), stores it, and the headset renders it with the trusted builders. A new capability is
   a new `kind` + validator rule + builder, reviewed and shipped like any code — never shipped
   inside content.

## Analytics

`vr.enter` (mode flat / immersive, supported), `vr.window_open` (kind, source), `vr.speech` (target,
outcome), `vr.feedback` (screenshot, via, mode) — plus `feedback.open` / `feedback.sent` with
`via: 'vr'`. Ids / enums only (shared/analytics/events.ts; Kotlin mirror kept in step).

## Tests

- Unit: `shared/vr/vr.test.ts` (spec validator, placement maths), `frontend/src/vr/windowStore.test.ts`,
  `frontend/src/vr/ui/layout.test.ts`, `frontend/src/vr/panels/panels.test.ts` (every panel's view),
  `frontend/src/vr/feedback.test.ts`.
- E2E: `e2e/tests/vr.spec.ts` — the flat preview with WebGL (SwiftShader): Study → Show answer → Good
  writes a review event, a word opens the explorer, windows close / open / are remembered. Dev builds
  expose `window.__vr` (where each tap target is on screen) so the test clicks real canvas pixels
  through the same raycast path a controller uses.
- The immersive path was also exercised with an emulated Quest 3 (IWER): Enter VR, controller rays,
  trigger → reveal, tray → explorer.

## Known limits / next

- Typed answers have no VR keyboard yet (🎤 instead). No recording of takes from the headset.
- Mini lessons: `note` / `choice` / `scramble` only, practice-only (not recorded).
- No wrist-mounted tray yet (the tray is a desk that follows you); no window resizing.
- Untested on the Steam Frame hardware itself (no device in CI): Chromium XR reports controllers
  and squeeze; trigger / hand pinch select and the left controller are untested there.
- Next: Claude-made panel specs (content as data, above), a card-drill panel over chosen notes,
  the full reader scrubber, a VR keyboard, passthrough (immersive-ar) where supported.
