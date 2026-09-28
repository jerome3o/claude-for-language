# Video calls (experimental)

A Preply-style live lesson inside the app: video + audio, a shared whiteboard (draw
or type — pinyin IME works), in-call chat, screen sharing, and a **recording of both
microphones** that becomes a Chinese + English transcript, a Claude-written lesson
report and one-tap flashcards after the call.

Entry points: **📹 Video call (beta)** on a student's / tutor's page
(`/connections/:relId`), **More → Video calls (beta)** (`/calls`, which also offers a solo
test call), and the **Join the call** button that appears in the relationship's chat.

## How it works

```
 browser A ──WebRTC media (peer to peer, STUN / optional TURN)── browser B
     │                                                              │
     └──── WebSocket ───► CallRoom Durable Object ◄─── WebSocket ───┘
                          (signalling, whiteboard, chat, "call ended")
     │                                                              │
     └── mic → MediaRecorder → IndexedDB queue → PUT chunks ──► R2 ◄┘
                                                                │
      call ended / piece complete → call-processing-queue ─────┘
          1 message per piece: stitch chunks → transcribe → segments (D1)
          then 1 message: Claude lesson report → calls.summary_json
```

- **Board (text first)** — the 📝 button opens **Board**: one plain-text document both people
  type into at once, each person's caret and selection shown to the other in their colour with
  their name (`components/calls/TextBoard.tsx`: a real `<textarea>` over a "mirror" with identical
  layout that paints the other person's selection / caret). The model is a small sequence CRDT,
  RGA, in `shared/calls/textDoc.ts` (unit-tested for convergence with three random typists and
  random delays; the Lab app's `CallTextDoc.kt` replays 5,000 recorded steps identically): every
  character has an id `[counter, site]` and the id of the character it was typed after; concurrent
  inserts after one character are ordered by id; deletes leave tombstones. The site is
  `<user id>:<random per page load>` and the room refuses inserts whose site isn't the sender's.
  The room applies ops in arrival order, keeps the document in its storage, sends it in `welcome`
  and relays `text` / `text_cursor` messages; edits made while the socket was down are replayed on
  the rejoin (idempotent). **IME**: nothing is sent between `compositionstart` and
  `compositionend`, and the other person's edits wait until the composition ends, so pinyin input
  is never disturbed (E2E drives a real composition over CDP). Selecting Chinese shows its pinyin
  (`pinyin-pro`, on the device) and, online, a word-by-word **Meaning**
  (`/api/sentences/explain-text`). **Draw** is the second tab (the old whiteboard). The text is
  saved with the call (`calls.board_text`, migration 0081), shown on the review page under
  "Board", and goes into the lesson report and the session-notes homework agent ("SHARED NOTES").
- **Room** — `worker/src/durable/call-room.ts`, one SQLite-backed Durable Object per call
  (`idFromName(callId)`), WebSocket Hibernation API. Relays SDP / ICE between the two
  peers, keeps the board (`shared/calls/board.ts` ops) and chat, broadcasts media state
  (mic / cam / screen / recording), ends the call (the End button, or 20 minutes after the
  room empties). It copies board + chat to D1 whenever someone leaves.
- **Join tickets** — a WebSocket can't carry the `Authorization` header, so
  `POST /api/calls/:id/join` returns a one-minute HMAC ticket bound to call + user
  (`services/calls/ticket.ts`); `GET /api/calls/:id/ws?ticket=` is registered before the
  auth middleware.
- **Media** — `frontend/src/services/calls/peer.ts`: perfect negotiation, one audio + one
  video transceiver, so camera / flipped camera / screen share are all `replaceTrack`.
  ICE servers come from `GET /api/calls/ice-servers` / the join response: Cloudflare +
  Google STUN, plus Cloudflare Realtime TURN credentials when configured.
- **Recording** — each person records **their own microphone** (no diarization needed:
  every segment already knows its speaker). `services/calls/recorder.ts` starts a new
  `MediaRecorder` every 5 minutes (each *piece* is a standalone webm/opus file) emitting a
  chunk every 10 s. Chunks go to IndexedDB first (`callUploads`, Dexie v18) and are drained
  in order by `services/calls/uploads.ts` — during the call and on every sync afterwards,
  so a flaky connection or a closed tab only delays the upload (offline-first, like study
  recordings). Piece start times are on the server clock so both tracks line up.
- **Processing** — readiness-driven, not a single "finalize": every event that can unblock
  work calls `advanceCallProcessing` (`services/calls/processing.ts`): a piece that is closed
  with all chunks uploaded is queued once; when the call has ended and nothing is in flight,
  the report is queued once. Pieces that will never close (crashed tab) are force-closed by
  **Process now** on the review page.
- **Video layout** — `shared/calls/videoFit.ts` (pure, unit-tested; the Lab app's `VideoFit.kt`
  is parity-tested against it): a feed is cropped to fill its box (`cover`) only when the two
  aspect ratios are within 15 %; otherwise it is shown whole (`contain`) — on the web over a
  small, dimmed, blurred copy of itself (`components/calls/CallVideo.tsx`, cheap: the copy is
  drawn at 1/8 size and scaled up), in the Lab app on a dark letterbox (the renderer is sized to
  the picture's rectangle). A shared screen is always shown whole. The choice follows the
  track's real size (the video's `resize` event / WebRTC's `onFrameResolutionChanged`, so a
  phone rotating mid-call re-fits) and the box's size (ResizeObserver / `onSizeChanged`). The
  self-view PiP takes my camera's shape (portrait phone, landscape webcam) and ~⅓ of the
  stage's shorter side (`pipSize`, 88–260 px): top-right on phones, bottom-right on wide windows.
  The pre-join preview takes the camera's shape too.
- **Review page** — `/calls/:id/review`: summary, corrections, vocabulary with checkboxes →
  "Add N cards" (`POST /api/calls/:id/flashcards`, through the content service so TTS and
  sentence sets happen as usual), the merged transcript grouped into turns with ▶ per line
  (plays that stretch of the speaker's piece), pinyin (from the transcriber, else
  `pinyin-pro` on the device) and English toggles, the whiteboard snapshot and the chat.

Tables (migration `0071_video_calls.sql`): `calls`, `call_recording_pieces`,
`call_recording_chunks`, `call_transcript_segments`. Audio lives in the existing R2 bucket
under `calls/<callId>/…` and is served by the public `/api/audio/*` route (unguessable
keys, same model as study recordings).

## Finding the call (banners, ring, notifications)

The person being called must notice. Every signal comes from ONE list, `GET /api/calls?live=1`,
and ONE pure rule set, `shared/calls/alerts.ts` (the Lab app's `CallAlerts.kt` is parity-tested):

- **Banners** — `pickCallBanner`: an incoming call (someone else started it) wins over my own call
  to rejoin; newest first; not the call already on screen, not one I hid, not one older than 4 h
  (a room nobody entered never ends by itself). "📹 王老师 is calling — Join" appears as a big card
  on **Home** (study and tutor home), a bar across the **top of every normal page** (not full-screen
  pages like a study session, not where the page shows its own), **inline** on the student / tutor
  page and in the **chat** (`components/calls/CallBanner.tsx`, `CallAlerts.tsx`). The web polls every
  20 s while visible (`hooks/useLiveCalls.ts`) and refreshes at once when a push arrives.
- **Ring** — `callToRing`: a new incoming call started in the last 2 minutes rings once per device
  (a Web Audio chime every 2 s + vibration, 30 s at most; `services/calls/ringtone.ts`), unless the
  account is **Silent** (Settings → Video call alerts; `users.call_alerts`, `PUT /api/profile/call-alerts`).
  Browsers only play sound on a page that has been used; the banner shows regardless.
- **Web Push** (PWA / desktop browser) — `POST /api/calls` sends "📹 <name> is calling" to the other
  member's subscriptions (`services/calls/alerts.ts` → `services/push/`). The service worker
  (`public/push-sw.js`, imported by Workbox) shows it unless a normal page of the app is in front
  (that page rings instead), tap → the call. When the call ends and they never joined (the room
  records who joined), a "Missed video call" notice replaces it. VAPID + RFC 8291 encryption are done
  with WebCrypto in `services/push/webpush.ts` (unit-tested by decrypting like a browser). Keys: the
  `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` secrets when set, otherwise a pair generated once and kept
  in `app_keys`; a device re-subscribes when the key changes. Subscriptions: `push_subscriptions`
  (migration 0080), dropped on 404/410 or after 5 failures. The user turns notifications on from a
  tap (Settings, or the "🔔 Get a notification when <name> calls" nudge on the tutor / student page).
  The hybrid Android app (Capacitor WebView) has no Web Push — it gets the banners and the ring.
- **Lab app** — polls every 20 s while in front and rings with the phone's ringtone; there is **no
  FCM project**, so in the background `CallWatchWorker` checks about once a minute for 2 hours after
  the app is left (WorkManager may stretch that in Doze) and the hourly shell check looks too, each
  posting a high-priority "📹 <name> is calling" notification (tap → the call). True instant push
  would need Firebase Cloud Messaging (a `google-services.json`, the FCM server key as a worker secret,
  and the worker sending to FCM tokens next to Web Push).

API: `GET /api/push/config` (`public_key`, `call_alerts`, `subscriptions`), `POST|DELETE
/api/push/subscriptions`, `POST /api/push/test`, `PUT /api/profile/call-alerts`; `call_alerts` is on
`/api/auth/me`.

## The native Lab app (android-lab/)

The Lab app is a second client of the same API, room protocol and upload routes
(`android-lab/app/…/ui/calls/`, `data/calls/`, `core/…/calls/`). Differences worth knowing:

- **Recording format**: Android has no streaming webm MediaRecorder, so the phone encodes Opus with
  MediaCodec (Android 10+) and writes the Ogg pages itself (`core/…/calls/OggOpus.kt`); pieces are
  registered as `audio/ogg;codecs=opus`, which the worker already accepts. Chunks are cut by audio
  time (10 s of samples), pieces every 5 minutes, exactly like the web's timers.
- **Mic source**: while a peer is connected the recorder taps WebRTC's own (echo-cancelled) capture;
  alone in the room it opens its own AudioRecord, because WebRTC only captures while sending.
- **Uploads** go through the app's Outbox (Room): register → raw chunk PUTs → close, drained during
  the call, after every sync and by the background worker; a killed app's open pieces are closed on
  the next sync.
- **Background**: a foreground service (microphone / camera / mediaProjection) keeps the call and
  its recording alive with the screen off; screen sharing uses MediaProjection.

## Setup — what needs a key

**Nothing new is required.** With the secrets the app already has:

| Piece | Uses | Status |
|---|---|---|
| Rooms, recording, storage | Durable Objects, R2, D1, Queues | created by `wrangler deploy` / `deploy.yml` (queue `call-processing-queue` added to "Ensure Queues Exist") |
| Transcription | `GEMINI_API_KEY` (already a secret) | default provider |
| Lesson report | `ANTHROPIC_API_KEY` (already a secret) | Claude Sonnet |
| Fallback transcription | Workers AI `AI` binding | no key |

Optional, worth adding:

1. **TURN relay — `TURN_KEY_ID` + `TURN_KEY_API_TOKEN`** (GitHub Actions secrets; `deploy.yml`
   already pushes them). Without TURN a call connects on most home / office networks but can
   fail on phone carrier NAT or strict Wi-Fi. Cloudflare dashboard → **Realtime → TURN
   Server → Create**; copy the key ID and API token. Free up to 1,000 GB/month (a 1-hour
   video lesson relayed is well under 1 GB).
2. **Better transcription — `SONIOX_API_KEY`** (GitHub secret, already wired). When set,
   Soniox is used instead of Gemini. Sign up at console.soniox.com.
3. Check the **Gemini key is on a paid tier** — on the free tier Google may use the lesson
   audio to improve its products.

`CALL_TRANSCRIBE_PROVIDER` (`gemini` | `soniox` | `whisper`) forces one provider;
`CALL_GEMINI_MODEL` overrides the Gemini model (default `gemini-2.5-flash`). Any provider
failure falls back to Whisper so a lesson is never left without a transcript.

## Choosing a transcription service

The hard part is **code-switching**: Mandarin and English inside one sentence
("我想 order 一个 coffee"). Volume is tiny — 1–4 lesson hours a month = 2–8 billed audio
hours (two tracks) — so every option costs under ~$3/month and the choice is about
quality and friction. Researched September 2026; code-switching claims are the vendors'
own — there is no neutral zh/en code-switching benchmark.

| Option | ~$/audio hr | Code-switching zh/en | Timestamps | Friction |
|---|---|---|---|---|
| **Gemini Flash** (generateContent + audio) — **default** | ~$0.12 | Good in practice; we also get pinyin + translation per line in the same call | Segment, model-generated (can drift a little; pieces are ≤5 min so drift stays small) | none — key exists |
| Gemini 3.5 Transcribe (new dedicated model) | ~$0.30 | Vendor: intra-sentence code-switching, `cmn-Hans-CN` | Word | none, but new Interactions API — not wired yet |
| **Soniox** `stt-async-v5` — **wired, optional** | ~$0.10 | Its main selling point; per-token language | Token (ms) | light signup |
| ElevenLabs Scribe v2 | $0.22 (4.5 h/month free) | Mandarin in its high-accuracy tier; no explicit switching claim | Word | light signup |
| AssemblyAI Universal-3.5 Pro (also on Workers AI) | $0.21 | Vendor docs show an English↔Mandarin example | Word | Cloudflare credits or signup |
| OpenAI `gpt-transcribe` / `gpt-4o-transcribe` | $0.27–0.36 | `languages: [zh, en]` hint | none (only `whisper-1`) | paid account |
| Workers AI Whisper large-v3-turbo — **fallback** | $0.03 | Weak: tends to translate / drop the switched language | Segment + word | none |
| Qwen3-ASR (Alibaba) | ~$0.13 | Strongest native Chinese model | Word (file API) | heavy (Alibaba Cloud account) |
| Deepgram Nova-3, xAI grok-stt | — | No Chinese in multilingual mode / no Mandarin | — | ruled out |

Recommendation: keep **Gemini** as the zero-setup default; if transcripts of real lessons
disappoint, add a **Soniox** key (best code-switching per dollar). The cheapest way to
decide is to run two or three real lesson clips through both and compare — the
review page shows which provider made each transcript.

## Limits of the prototype

- 1:1 only (a tutor and a student; a third connection is refused). Media is peer to peer —
  no SFU, so no server-side composite recording.
- Only **audio** is recorded (for the transcript). Recording video would mean an SFU
  recording pipeline (Cloudflare Realtime / RealtimeKit) or large client uploads.
- Screen sharing needs `getDisplayMedia` — desktop browsers yes, Android Chrome no (the
  button is hidden where unsupported). The native Lab app shares its screen with MediaProjection.
- Transcripts are after the call, not live captions.
- The review page seeks inside MediaRecorder webm files, which have no cue index; Chrome
  copes for ≤5-minute pieces.

## Ideas for next steps

- Tutor-side "Send these words to the student" from the report (a homework deck).
- Log the lesson automatically (`tutor_lesson_log`) and feed the transcript into the
  student's lesson notes / daily reader.
- MCP tools: `list_calls`, `get_call_transcript` so Claude can prep the next lesson.
- Live captions via a streaming STT provider.
