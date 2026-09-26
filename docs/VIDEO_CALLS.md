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
- **Review page** — `/calls/:id/review`: summary, corrections, vocabulary with checkboxes →
  "Add N cards" (`POST /api/calls/:id/flashcards`, through the content service so TTS and
  sentence sets happen as usual), the merged transcript grouped into turns with ▶ per line
  (plays that stretch of the speaker's piece), pinyin (from the transcriber, else
  `pinyin-pro` on the device) and English toggles, the whiteboard snapshot and the chat.

Tables (migration `0071_video_calls.sql`): `calls`, `call_recording_pieces`,
`call_recording_chunks`, `call_transcript_segments`. Audio lives in the existing R2 bucket
under `calls/<callId>/…` and is served by the public `/api/audio/*` route (unguessable
keys, same model as study recordings).

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
  button is hidden where unsupported).
- Transcripts are after the call, not live captions.
- The review page seeks inside MediaRecorder webm files, which have no cue index; Chrome
  copes for ≤5-minute pieces.

## Ideas for next steps

- Tutor-side "Send these words to the student" from the report (a homework deck).
- Log the lesson automatically (`tutor_lesson_log`) and feed the transcript into the
  student's lesson notes / daily reader.
- MCP tools: `list_calls`, `get_call_transcript` so Claude can prep the next lesson.
- Live captions via a streaming STT provider.
