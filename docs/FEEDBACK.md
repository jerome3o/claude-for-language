# In-app feedback

"Something's wrong" or "I have an idea", sent from anywhere in the apps with a screenshot of what was
on screen — and, on a phone, by **shaking it** (the angry shake). Feedback is not a separate system: every
item is a row in `feature_requests` (`kind` = `feedback` | `bug`), so the admin page, Settings → Feature
requests and the MCP feature-request tools (`list_feature_requests`, `get_feature_request`,
`claim_feature_request`, …) see it like any other request, and agents can pick it up.

## Where it is sent from

| App | How the sheet opens | Screenshot |
|-----|--------------------|------------|
| Web (browser, PWA, hybrid Android shell, desktop) | More → 💬 Send feedback · Settings → Feedback · the 💬 floating button · **Shift + ?** on a keyboard · **shake** on a phone whose browser reports motion without asking (Android Chrome; Settings → "Shake to send feedback", on by default) | `html2canvas` (already the app's screenshot library, lazy-loaded) redraws the page as a JPEG — it may miss videos, canvases and cross-origin pictures. Tap the preview to draw on it or cover something; untick "Include screenshot" to leave it out |
| Lab app (native) | **shake** (accelerometer while the app is in front; Settings → "Shake to send feedback", on by default) · More → 💬 Send feedback · Settings → Feedback | The app's own window (`PixelCopy`) — no screen-recording permission, nothing outside the app. "Include screenshot" switch to leave it out |
| VR (`/vr`, WebXR) | 💬 Feedback on the VR tray (docs/VR.md) | the scene rendered from the head pose (the canvas in the flat preview), sent through the web's outbox (`queueFeedback`) with `platform: 'vr'`, `via: 'vr'` — `frontend/src/vr/feedback.ts` |

A shake never opens the sheet during a call (the call screens, the phone's call / communication audio mode)
or while the microphone is recording (a study take, dictation, a voice message): web
`services/micActivity.ts` wraps `getUserMedia` once and knows which streams are live; Lab
`AudioManager.activeRecordingConfigurations`.

The shake rule is ONE function, `shakeStep` (`shared/feedback/shake.ts`, Lab `core/…/feedback/Feedback.kt`
`Shake`, parity-tested by `parity/fixtures/feedback.ts`): a jolt = a sample of at least 25 m/s² (≈ 2.5 g,
gravity included; walking peaks near 1.5 g, running near 2–2.5 g) at least 90 ms after the previous one;
four jolts inside one second = a shake; then a 4 s cooldown so one shake opens one sheet.

## The sheet

🐛 Something's wrong / 💡 Idea (a shake starts on 🐛), a voice-first message box (say it or type it — its
Send sends; web `VoiceTextInput`, Lab `VoiceFirstField`, surface `feedback`), the screenshot with "Include
screenshot", opt-in console logs (web), the context line ("Lab app 0.142 · /study · Google Pixel 9 ·
shaken"). A screenshot alone is enough ("Send the screenshot only").

**Offline first.** Web: its own IndexedDB `feedback-outbox` (blob included), sent at once when online, else
when the browser comes back online and on every sync (`flushFeedback`). Lab: the Outbox (`kind: feedback`;
multipart with the screenshot copied into the Outbox's folder, JSON without), drained at once when online,
else by the sync / `SyncWorker`. The item's `client_id` makes every retry safe.

## API

`POST /api/feedback` (signed in; `routes/feedback.ts`, `services/feedback.ts`)

- `multipart/form-data`: `message` (≤ 4,000 characters; may be empty when a screenshot is attached),
  `kind` (`feedback` | `bug`, default `feedback`), `client_id` (8–64 of `[A-Za-z0-9_-]`, recommended),
  `context` (a JSON string, below), `console_logs` (optional, last 50,000 characters kept),
  `screenshot` (a PNG / JPEG / WebP file — the type is sniffed from the bytes —, ≤ 4 MB)
- or `application/json` with the same fields minus the screenshot (`context` as an object)
- → `201 { feedback: { id, kind, status, approval_status, created_at, client_id, has_screenshot }, created: true }`;
  the same `client_id` again → `200` with the first item (`created: false`, nothing stored twice)
- `400 { error, problems }` (`empty` | `too_long` | `kind`), `413` screenshot too big, `415` not a picture,
  `429 { error, retry_after }` + `Retry-After` after `FEEDBACK_PER_HOUR` (20) items in an hour, `401` signed out

`context` (everything else is dropped — `pickFeedbackContext`, on the device and on the server):

```jsonc
{
  "platform": "web | lab | vr | desktop",
  "app_version": "0.142 (142)",
  "screen": "/decks/:id",          // a route PATTERN: ids, hanzi, query strings never kept
  "install_kind": "pwa",
  "device": "Google Pixel 9",
  "os": "Android 16",
  "online": true,
  "viewport": "412x915",
  "via": "shake | menu | shortcut | vr | fab | settings",
  "recent_events": ["study.card_rated", "feedback.open"]   // ≤ 15 analytics event NAMES, no props
}
```

The row: `content` = the message (or "(Screenshot only, no message)"), `page_context` = the context line,
`kind`, `client_id`, `context` (JSON), `screenshot_key` + `screenshot_url` (`/api/audio/feedback/…`),
`console_logs` (migration 0142). Listing: `GET /api/feature-requests?kind=feedback` (feedback + bug) |
`bug` | `request`; rows carry `kind`, `context` (parsed), `context_line`.

**Approval** follows the feature-request rule: an admin's feedback with a message is approved at once (and
starts the Claude Code routine when it is configured); everything else — anyone else's, a screenshot with no
message — waits for an admin. Feedback from someone other than an admin sends one ntfy ping (`NTFY_TOPIC`).

## Privacy

- **The screenshot shows whatever was on the screen** — cards, chat messages, a student's name. The sheet
  says so, shows it before sending, lets you draw over it (web) and leave it out.
- It is stored privately in R2 `feedback/<user>/<id>.<ext>` (person-made: never collected by the storage
  clean-up, removed with the account) and served by `GET /api/audio/<key>` only to **its author and admins**
  — with the session (`Authorization: Bearer`), the web's media token, or a signed link
  (`shared/media/access.ts` + `services/media-access.ts`). The MCP tools hand agents a signed link valid 24 h.
- The context is diagnostics only (above). Console logs are opt-in and web-only.
- Analytics: `feedback.open { via }`, `feedback.sent { via, kind, has_screenshot, queued }` — never the text.

## MCP

`list_feature_requests` takes `kind` (`feedback` = feedback + bug, `bug`, `request`) and returns each row's
`kind`, `context`, `context_line`, `has_screenshot` and a signed `screenshot_url`; `get_feature_request`
the same plus comments and console logs. Claim / status / comment work unchanged.

## Files

- `shared/feedback/` — the context filter, route pattern, copy, the shake rule (+ tests)
- `worker/src/services/feedback.ts`, `worker/src/routes/feedback.ts`, migration `0142_feedback.sql`
- web: `components/feedback/FeedbackProvider.tsx` (open, Shift+?, shake, flush on online),
  `FeedbackSheet.tsx`, `services/feedback.ts` (outbox, context, shake setting), `services/micActivity.ts`,
  `components/settings/FeedbackSettingsSection.tsx`, the 💬 `FeedbackFAB`
- Lab: `data/feedback/FeedbackCenter.kt` (capture, send), `ShakeWatcher.kt`, `ui/feedback/FeedbackSheet.kt`
  (sheet, host, settings card, screenshot loader), core `feedback/Feedback.kt`
- MCP: `mcp-server/src/tools/feedback.ts`
