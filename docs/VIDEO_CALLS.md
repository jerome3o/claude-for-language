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
- **Tab-complete on the board** — type Chinese, stop for 500 ms (and no IME composition open)
  and a grey ` - pīnyīn - meaning` appears right after the caret; **Tab** types it in (through the
  CRDT, like any typing, so the other person sees it and it is saved in `board_text`), typing on or
  **Esc** dismisses. On a touch screen a **⇥ pīnyīn - meaning** chip under the caret accepts on tap.
  Only the typist sees the offer. The rules are `shared/calls/gloss.ts` (`findGlossSegment`: the
  trailing run of Chinese characters / Chinese punctuation on the caret's line, ≤ 40 characters, only
  at the end of a line that has no ` - …` after it yet; `formatGloss`: always one line), ported to the
  Lab app as `CallGloss.kt` and parity-tested. `POST /api/calls/:id/gloss { text }` (members of the
  call only) asks Haiku through `structuredCall` (forced tool, thinking off, 200 tokens, 4 s, one
  retry when the reply is unusable) and returns `{ pinyin, english }` cleaned by `cleanGloss` (tone
  marks, ≤ 8 English words, no line breaks); answers are cached per text in the worker isolate and
  in a 300-entry LRU on each device (a repeat is instant and free), and each user may make 30
  uncached requests a minute (429). No key / offline / an error → simply no offer (the client stays
  quiet for a minute after 503 / 429). A request in flight is aborted on new input and a reply for
  text that has changed since is ignored. Off switch: the board's ⋯ (web, remembered per user on the
  device) / "⇥ Pinyin hints" (Lab). Web: `components/calls/useBoardGloss.ts`,
  `services/calls/boardGloss.ts`; Lab: `ui/calls/TextBoardPanel.kt`, `BoardGlossFetcher.kt`.
- **Both people draw on a shared screen** — the sharer's own screen is a tile like any other
  (large, not a corner preview): **✏️ Draw on it** on the share bar puts it on the stage (their
  camera floats beside it) with the pen on, so the sharer can circle things on their own screen the
  same way the viewer does on theirs. Strokes go both ways over the same `annot` messages and show
  on both views; each person's pen starts in their own colour (sharer blue `#38bdf8`, viewer red
  `#f43f5e`; `defaultAnnotColor`), any swatch can be picked. **Keep** (`annot_mode`, one setting for
  both, remembered by the room and sent in `welcome.annot_persist`) stops strokes fading until
  **Clear**; turning it off starts every stroke's fade. Strokes themselves are never stored, so
  someone who (re)joins sees only new ones. The Document PiP mini window (below) shows both people's
  strokes; the Lab app's overlay too.
- **Drawing on a shared screen** — when one person shares their screen, the other taps
  **✏️ Draw on …'s screen** over it: a drag is a stroke (circle a character), a quick tap a "look
  here" ping; strokes fade ~3 s after the pen lifts, **Clear** clears. Points are normalised to the
  shared picture (`shared/calls/annotate.ts`, unit-tested; Lab `CallAnnotate.kt` parity-tested), so
  they land on the same spot in any window size. They travel as `annot` / `annot_ping` /
  `annot_clear` room messages (relayed, never stored). The sharer sees them over **their own
  preview of the share** in the call and, on Chrome / Edge desktop, in an **always-on-top mini
  window** (Document Picture-in-Picture, "See drawings over your other windows" on the share bar;
  `services/calls/annotationPip.ts`) showing their shared stream with the drawings and pings —
  so they see what's being circled while looking at their other window. **Limitation: a browser
  cannot draw on the sharer's real screen**; without Document PiP (Firefox, Safari, phones) the
  drawings show only in the call's own preview. The share bar says "<name> is drawing on your
  screen" either way. The **Lab app can**: while it shares (MediaProjection), the drawings are
  painted over every app in a see-through, untouchable overlay window ("Display over other apps"
  permission, asked for from the share bar; `data/calls/ScreenAnnotationOverlay.kt`).
- **Room** — `worker/src/durable/call-room.ts`, one SQLite-backed Durable Object per call
  (`idFromName(callId)`), WebSocket Hibernation API. Relays SDP / ICE between the two
  peers, keeps the board (`shared/calls/board.ts` ops) and chat, broadcasts media state
  (mic / cam / screen / recording), ends the call (the End button, or automatically — see
  "Who is in the call" below). It copies board + chat to D1 whenever someone leaves.
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
- **Tiles & layout** — the call is six tiles: their camera, my camera, a shared screen, the text
  board, the drawing board and the chat. `shared/calls/layout.ts` (pure, unit-tested; the Lab's
  `CallLayout.kt` is parity-tested) holds the model: `focus` (one tile on the stage, the rest in a
  side rail ≥ 1024 px or a bottom strip), `split` (two tiles, draggable divider, side by side or
  stacked) and `grid`; **their camera is never hidden** — off the stage it floats (or sits in the
  rail if floating is switched off); my camera floats in a corner (drag → snaps to the nearest
  corner; resize handle). Presets (▦ menu, keys 1–5): Speaker, Board + camera, Screen + camera,
  Side by side, Grid; B / D / C / V / S focus a tile; double-click a tile or its ⤢ focuses it. When
  the other person starts sharing, the layout switches to Screen + camera. `layoutRects` turns the
  layout into pixel rectangles and `CallTiles.tsx` moves ONE element per tile (a transform), so a
  video never restarts and the board keeps its caret when the layout changes. Phones (< 640 px):
  focus only — the tile fills the screen, both cameras float small, a sideways swipe moves between
  tiles (touch events; horizontal overscroll "back" is disabled on the call page), 📝 / 💬 jump to
  the board / chat. The layout is remembered per user on the device (`call-layout-v1:<user>`).
- **Screen share has its own channel** — the offerer creates audio, camera and screen transceivers;
  the second video m-line is the screen, so the viewer sees the screen AND the sharer's camera. An
  older app that offers one video m-line gets the old behaviour (the screen replaces the camera;
  `screenChannel` false on the web).
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

## Joining when the camera or microphone won't open

Joining never depends on the devices: without a camera you join with audio, without a microphone
you join to listen and watch, and the 🎙️ / 📷 buttons turn a missing device on later (a tap asks the
browser again; the track goes onto the existing transceiver with `replaceTrack`, no renegotiation;
recording starts when a mic appears). `services/calls/mediaAccess.ts` (unit-tested) asks for camera +
mic together, then each alone, and classifies what went wrong — `blocked` (site blocked in the
browser, or an organisation's policy), `system` (macOS / Windows privacy settings stop the browser),
`dismissed`, `in-use` (Teams / Zoom has the camera), `no-device`, `insecure`, and `waiting` (no
answer after 6 s: the prompt is probably hidden behind an address-bar icon). `MediaProblemCard`
shows the exact steps for that browser and OS plus **Try again** (a tap, which also brings back a
suppressed prompt); a permission switched to Allow in site settings is picked up without a reload
(`navigator.permissions` change). The Join button says what you'll join with ("Join with audio only",
"Join without camera & mic"). **Devices** (⚙️ before joining, ⋯ → Camera, mic & speaker in the call):
camera / microphone / speaker (`setSinkId`), remembered per device (`call-devices-v1`).

Our side sends no `Permissions-Policy` header (the Pages site and the worker were checked), and the
preview's `getUserMedia` runs on page load, which Chrome allows; so a missing prompt comes from the
browser / computer — a site previously blocked, a prompt dismissed a few times (Chrome then stops
asking), or a work machine's policy. Before this change that left the Join button disabled with no
way forward.

## Staying connected

The room socket (signalling) and the WebRTC link (media) are independent, and the rules are pure,
in `shared/calls/connection.ts` (Lab: `CallConnection.kt`, parity-tested):

- **Same page, new socket** — each page load / app session has an `instance` (the socket URL's
  `?instance=`). A socket that drops and comes back from the same instance keeps its
  RTCPeerConnection on both sides (`shouldAdoptPeer`); the room closes the dead socket quietly (4001)
  instead of saying "replaced". The other person's socket leaving keeps their picture (frozen on the
  last frame) for `PEER_AWAY_GRACE_MS` (30 s) before the link is closed. A reload / second device is
  a new instance → a new link, as before.
- **Dead sockets** — ping every 10 s, no pong in 8 s → close and reconnect; the browser coming back
  `online` checks at once; messages from a stale socket are ignored.
- **ICE restarts** (`nextIceRestartAt`) — `disconnected` gets 2.5 s to heal, then `restartIce()`;
  `failed` restarts at once; then 2 s, 4 s, 8 s … 30 s; only while the socket is open (re-checked when
  it returns), and signals always go to the other person's current socket.
- **Never blank** — the `<video>` element and its `srcObject` stay through a drop; the tile shows a
  small "Reconnecting…" badge (`tileStatus`), "Connecting…" before the first connect.
- **Encoders** (`videoEncodingFor`) — camera: `maintain-framerate`, ≤ 900 kbps, ¼ / ½ resolution when
  the outgoing estimate (`availableOutgoingBitrate`) falls under 180 / 350 kbps (1.5× hysteresis);
  screen: `maintain-resolution`, ≤ 1.5 Mbps, 15 fps; audio `networkPriority: high`.
- **TURN** — Cloudflare Realtime TURN when `TURN_KEY_ID` / `TURN_KEY_API_TOKEN` are set; every URL it
  returns is offered except port 53, i.e. UDP 3478, TCP 3478/80 and **TLS 443** (gets through
  firewalls that only allow HTTPS).
- **Connection log** — each side sends `diag` events (pc / ICE state changes, restarts, socket status,
  the route in use — host / srflx / relay and its protocol + RTT —, device problems, whether TURN was
  offered, peer away / back); the room keeps the newest 600 and copies them to
  `calls.diagnostics_json` (migration 0085); the review page has a collapsed **Connection log**.

## Typing latency on the board

The room relays a keystroke **before** storing it and stores the board / text / log at most every
400 ms with `allowUnconfirmed` (a durable write per keystroke used to hold the next keystroke's
relay behind the output gate, and serialised the whole document — up to 125 KB — each time; a lost
write is harmless because clients replay unconfirmed edits on rejoin). The client sends each edit
at once. Chinese typed through a pinyin IME only enters the document when the composition is
committed, so the other person used to see nothing for the whole composition (2 s+ for a phrase):
now `text_cursor` carries `compose` (≤ 40 chars, ≤ 12 updates/s) and the composition shows in the
typist's name flag above their caret ("Jerome · wo ba cha") — never in the text, so nothing moves.
Measured locally (two Chromium contexts, `wrangler dev`, 960-char document, 60 keystrokes):
relay p50 10.1 → 7.5 ms, p90 13.5 → 12.3 ms; first sign of IME typing: at commit (≈ 2.1 s) → 17 ms.
In production the network round trip to the room dominates.

## The board is paper

The text board, the drawing board and the chat are always light paper with dark ink (`#111827`)
for both people, whatever the theme: `color-scheme: light` on the panel on the web, a `BoardPaper`
palette in the Lab app (its dark theme used to paint light ink on the white board).

## Who is in the call (presence) and when a call ends by itself

A call row stays `live` until someone presses End — and before this, a room nobody was in never
ended: on 30 Sep 2026 Jerome and Minghui pressed "Video call" in the same second, two calls were
made, both joined Minghui's, and Jerome's (nobody ever entered it; its room never had a socket, so
the 20-minute empty-room alarm — armed only when a socket left — never ran) stayed "live", and both
apps showed "📹 … is calling — Join" for hours. Now (pure rules in `shared/calls/presence.ts`,
applied by the CallRoom; worker tests with a mocked clock in `durable/__tests__/call-room.test.ts`):

- **Present** = the socket is open, hasn't said `leave`, and the room heard from it in the last
  **45 s** (every client pings every 10 s; the room notes the time at most every 5 s in the socket's
  attachment, so it survives hibernation). A phone that went to sleep or was killed without closing
  its socket drops out within ~45 s: the room's alarm, set just after the oldest present socket
  would time out, closes it (4003, the client reconnects if it is in fact alive) and tells the other
  side `peer_left`.
- **Ends by itself** — through the same path as End (`ended_at`, the "missed call" push, post-call
  processing): **3 min** after the last person left (time for a reload or a network blip), or
  **10 min** after creation for a call nobody ever entered (the caller may still be on the pre-join
  screen). `POST /api/calls` arms the room; `GET /api/calls` asks each live call's room
  `presence()` (≤ 10 rooms, 2.5 s), which also ends a room past its deadline — so a call stuck from
  before this change is swept up on the first poll after deploy. No "missed call" push for a call
  ended more than 30 min after it was created.
- **Leave** — the web's page unmount and the Lab's Leave send `{ type: 'leave' }` before closing;
  closing the tab sends it too plus a **beacon** on `pagehide` (`POST /api/calls/:id/leave`
  `{ client_id, token }`, no session — the token is the socket's secret from `welcome.leave_token`;
  text body, always 204); the Lab app sends it when swiped away from recents
  (`CallService.onTaskRemoved`). Switching to another app is not leaving (the call goes on in the
  background; the heartbeat decides).
- **One call per relationship** — `POST /api/calls` returns the relationship's live call instead of
  a new one (`reused: true`, no chat line / push) when someone is in it, or when it started in the
  last 10 min (one conditional `INSERT … WHERE NOT EXISTS`, so two presses in the same second can't
  both insert).

## Finding the call (banners, ring, notifications)

The person being called must notice. Every signal comes from ONE list, `GET /api/calls?live=1`,
and ONE pure rule set, `shared/calls/alerts.ts` (the Lab app's `CallAlerts.kt` is parity-tested):

- **Banners** — `pickCallBanner`: only a call **someone other than me is connected to right now,
  and I'm not** (`someoneElseInCall` over the list's `present_user_ids`; a server without presence
  → not older than 4 h, as before); an incoming call (someone else started it) wins over my own call
  to rejoin; newest first; not the call already on screen, not one I hid (✕ on every banner, inline
  ones too). So the banner goes on the next poll (≤ 20 s) once the caller leaves or the call ends. "📹 王老师 is calling — Join" appears as a big card
  on **Home** (study and tutor home), a bar across the **top of every normal page** (not full-screen
  pages like a study session, not where the page shows its own), **inline** on the student / tutor
  page and in the **chat** (`components/calls/CallBanner.tsx`, `CallAlerts.tsx`). The web polls every
  20 s while visible (`hooks/useLiveCalls.ts`) and refreshes at once when a push arrives.
- **Ring** — `callToRing`: a new incoming call started in the last 2 minutes, with the caller in it,
  rings once per device (and stops when they leave)
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
