# Audio pipeline (TTS)

Every clip the app speaks with comes from **MiniMax**, model **`speech-2.8-hd`**, voice
**`Chinese (Mandarin)_Radio_Host`** (the clear "theatre" voice), speed **0.6**, MP3 32 kHz /
128 kbps mono. These live in ONE place: `worker/src/services/tts/settings.ts`.

## Why this exists

Cards "sounded robotic" mostly because they had **no clip at all**: the device then read the
word with its own TTS (web `speechSynthesis`, Lab Android `TextToSpeech`). Clips went missing
because MiniMax rate-limits by requests per minute (`1002 rate limit exceeded(RPM)`), every
path called it at full speed with 3 retries inside the request, a rate-limited clip was left
empty, and nothing came back for it. A bulk import came out ~95 % silent.

## The pieces

| Piece | Where | What |
|---|---|---|
| Settings + signature | `services/tts/settings.ts` | model / voice / speed / encode → `s<hash>`; each stored clip records `<settings hash>.<text hash>` |
| Rate limiter | `durable/tts-limiter.ts` (DO `TTS_LIMITER`, one instance) + `services/tts/bucket.ts` (pure) | token bucket at `MINIMAX_RPM` (default 55, wrangler var), burst ≤ 5 → never more than rpm + burst in any minute |
| The MiniMax call | `services/audio.ts` `callMiniMaxTTS` | the ONLY function that calls MiniMax: slot first, then the call, outcome reported back |
| Clip worker | `services/tts/clips.ts` `ensureClip` | one clip (word / card sentence / sentence-set row): idempotent, key swap, shared copies |
| Queue | `tts-queue` (`services/tts/queue.ts`) | one clip per message + the backfill pump; `max_concurrency` 2, batch 4 |
| Backfill | `services/tts/backfill.ts`, `cron.ts`, `schedule.ts` | the backlog in priority order; nightly + hourly crons |
| Admin | `routes/audio-backfill.ts`, MCP `audio_backfill_status` / `audio_backfill_run` / `audio_tts_compare` | counts, limiter, throughput, ETA |
| Devices | web `services/noteAudioEnsure.ts` + StudyPage; Lab `NoteAudioFixer` | ask for a missing / broken clip; "Audio coming…" |

## Rate limit

- **Every** MiniMax call goes through `callMiniMaxTTS`: stored word / sentence clips, sentence
  sets, conversation lines (`/api/practice/tts`), chat read-aloud and listening-mode
  pre-generation (`services/chat/message-audio.ts` → `tts-cache.ts`), Claude role-play replies,
  voice samples, the admin calibration.
- Two priorities. **interactive** (a card just made / edited, a tap on ▶, ensure-audio, a chat
  message): any token, may wait up to 8 s for one. **batch** (backfill, imports, sentence-set
  jobs, deck "regenerate all"): also needs a token from a slower bucket (60 % of the rate by
  day, 90 % at night) and never takes the last global token — a tap is served next.
- MiniMax `1002` / `1039` / HTTP 429 → the limiter empties both buckets and blocks (15 s
  everyone, 60 s batch); the message is **requeued with a delay (60 s)** — never retried inside
  the request. A rate limit is not a failure.
- No Google fallback for stored clips (Google Wavenet is "pretty terrible"). A clip that can't be
  made now waits in the queue. Ephemeral conversation audio may still fall back to Google in the
  moment (never stored).
- The DO logs `{"type":"tts_limiter", …}` once a minute with tokens and last-hour counts.

## Provenance and the key swap

`notes.audio_voice / audio_model / audio_settings`, the same three for `sentence_clue_audio_*`,
and `note_sentences.audio_*` (migration 0103). NULL = made before provenance = "old voice".
A clip is **current** when its signature equals `<current settings hash>.<hash of its text>`,
so a changed hanzi / sentence is stale too.

`ensureClip`:
1. current → nothing (idempotent per row × field × settings × text);
2. a student's copy of a tutor deck → copy the tutor's current clip; else (no clip) the tutor's
   older one for now; else make the **tutor's** clip once and share it;
3. generate → fresh R2 key → `UPDATE … WHERE id = ? AND url IS <the key we started from>`
   (someone else changed it meanwhile → ours is dropped) → every other row pointing at the old
   key moves too → old object deleted only when nothing references it
   (`deleteUnreferencedAudio`) → `updated_at` bumped (notes: SQLite datetime; note_sentences:
   ISO), so `/api/sync/changes`, `/api/sentences/changes` and `/api/audio-manifest` carry the new
   key; both apps' caches are keyed by R2 key, so a new key is simply downloaded.
4. Failures (not rate limits) go to `tts_clip_failures` with growing retry times
   (10 min → 1 h → 6 h → 24 h; permanent errors 7 days) so one bad row never blocks the backlog.

## Backfill

Tiers (`selectBackfill`), each word → card sentence → sentence set:
1. missing clips of notes with a card due within 48 h;
2. missing clips in Jerome's (`ADMIN_EMAIL`) and recently active (opened ≤ 7 days) accounts;
3. other missing clips;
4. Google-made clips;
5. MiniMax clips with other settings (old voice / model / speed, or NULL provenance).

The **pump** (`{ kind: 'pump' }` on tts-queue) picks 9, works them 3 at a time at batch
priority (paced by the limiter), then sends itself again; it stops when nothing is left. One
pump at a time (a lease in the limiter DO). Crons (`wrangler.toml`, UTC):
- `0 23 * * *` and `0 0 * * *`: act only when it is **midnight in London** (23:00 UTC in BST,
  00:00 UTC in GMT) → night mode for 7 h (batch may use 90 %) and start the pump;
- `37 * * * *`: nudge the pump, so the backlog keeps draining by day at low priority.

## Devices

- **Web** (`services/noteAudioEnsure.ts`, StudyPage): a card with no word / sentence clip, or a
  clip that fails to load, calls `POST /api/notes/:id/ensure-audio` (interactive; ≤ every 20 s,
  ≤ 6 times per note per page load). `queued` → "Audio coming…" next to Play; on reveal the
  card waits for the real clip instead of reading the word in the device voice, and plays it
  when it arrives. A tap on Play still uses the device voice meanwhile; offline nothing changes.
- **Lab**: `NoteAudioFixer` does the same (`queued` is pending, not a failure).

## Operating it

- Status: MCP `audio_backfill_status` (or `GET /api/admin/audio/backfill`): backlog by kind ×
  state, clips by provider / model / voice, failures, limiter (RPM, night, last hour), measured
  clips/min and the ETA.
- Kick: `audio_backfill_run` (`limit` also queues that many clips at once).
- Plan RPM: set `MINIMAX_RPM` in `worker/wrangler.toml` `[vars]` a few under the plan's limit.
- Perceived speed after a model change: `audio_tts_compare` returns durations for the old and
  new model; if they differ, set `TTS_SPEED_OVERRIDE` (0.5–2) — the settings hash changes and the
  backfill regenerates everything at the new speed.
