# Audio pipeline (TTS)

By default every clip the app speaks with comes from **MiniMax**, model **`speech-2.8-hd`**, voice
**`Chinese (Mandarin)_Radio_Host`** (the clear "theatre" voice), speed **0.6**, MP3 32 kHz /
128 kbps mono (`worker/src/services/tts/settings.ts`). Since Oct 2026 **Azure Speech** is a
second provider and Google a third; which one speaks, in what order and in which voices is an
admin setting (**/admin/audio**, see "Providers" below).

## Providers (MiniMax · Azure Speech · Google)

Oct 2026: MiniMax refused every call with `2053 insufficient credit`, and Google's voice is poor,
so the pipeline got a provider layer and an admin page.

| Piece | Where |
|---|---|
| Settings (validation, voice catalogues, speed mapping, defaults) | `shared/tts/config.ts` (`TtsConfig`, `mergeTtsConfig`, `DEFAULT_TTS_CONFIG`) |
| Stored settings | D1 `tts_settings` (one row, migration 0107); `services/tts/config.ts` `loadTtsConfig` (cached 30 s per isolate) |
| The providers (HTTP + decode + error classification) | `services/tts/providers.ts`: `minimaxProvider`, `azureProvider` (`buildAzureSsml`, `classifyAzureError`), `googleProvider` |
| Limiter + account pause per provider | `durable/tts-limiter.ts`, one instance per `idFromName('minimax' \| 'azure' \| 'google')` |
| Calls + fallback order | `services/audio.ts`: `callProviderTTS` (slot → call → report), `synthesizeOrdered`, `shouldTryNextProvider`, `combineProviderFailures` |
| Admin | `routes/audio-settings.ts` (`GET|PUT /api/admin/audio/settings`, `POST /api/admin/audio/sample`), page `/admin/audio`, MCP `audio_settings_get` / `audio_settings_update` |

**Settings** (`TtsConfig`):
- `stored_order` — providers tried, in order, for clips that are **kept**: stored clips (word, card
  sentence, sentence set) and `/api/practice/tts` (lesson / chat clips both apps cache for good).
  Default **`["minimax"]`** (= the behaviour before providers).
- `live_order` — for live playback nobody keeps (`/api/conversations/:id/tts`, role-play replies).
  Default **`["minimax", "google"]`**.
- `upgrade_backup_clips` (default **on**) — see "Current" below.
- per provider: `enabled`, `max_rpm` (hard cap; the limiter learns below it), `voices` for the roles
  `default` / `female` / `male`, `speed_factor`.
A provider that is disabled or has no secrets is skipped at run time (still listed in the order).

**Fallback.** Each provider in the order is tried through ITS limiter. An **account pause** (no
credit / bad key), "not configured" or a failure → the next provider. A **plain rate limit** (the
limiter's wait, MiniMax 1002, HTTP 429) → the next provider only for an interactive caller (someone
is waiting); background work (pump, queue) waits for the first provider rather than spending the
backup on every clip. When nobody could speak: wait (the shortest wait asked for) if any provider
asked to wait, else a clip failure (`tts_clip_failures`, reasons joined `base_resp 2013 …; azure http 500 …`).

**Current.** Each provider has its own stored-clip settings hash (MiniMax: the old formula, so clips
made before providers stay current; Azure / Google: provider | voice | rate | encode). A clip is
current when its signature carries an **acceptable** hash (`storedClipPolicy`): the first usable
provider's always; every provider of the stored order's while the first one is **unavailable**
(account-paused); and always when `upgrade_backup_clips` is **off**. So with `["minimax", "azure"]`
while MiniMax has no credit, Azure clips are current and the backfill makes missing ones with
Azure; once MiniMax answers again they become `old_voice` and the pump remakes them with MiniMax
(upgrade on). Moving another provider FIRST makes the backfill remake every clip with it (upgrade on).
The R2 `tts-cache/` key is per provider + voice + rate (MiniMax's key unchanged); only clips of a
provider in the stored order are kept there.

**Voices.** Stored clips use each provider's `default` voice. Conversation lines and chat
read-aloud still pick a MiniMax catalogue voice (`shared/lesson/voices.ts`, `shared/chats/voice.ts`
— unchanged on both apps); MiniMax speaks it as is, another provider maps it by the catalogue
voice's **gender** to its `female` / `male` voice (`voiceRole`, `providerVoice` in
`services/tts/config.ts`); the app's own voice → `default`. (Two same-gender speakers in one
dialogue therefore share Azure's voice of that gender.) MiniMax voice samples
(`/api/conversation-voices/sample`) stay MiniMax only.

**Speed.** The app's speeds are MiniMax's scale (0.6 cards, 0.9 conversations). Another provider's
rate = `1 + (speed − 1) × speed_factor` (clamped 0.5–2): Azure's default factor **0.75** → cards
**0.7** (`<prosody rate="-30%">`), conversations **0.93**. Google 1.0 (its `speakingRate` = the
speed, as before). Azure **HD voices** (`…:DragonHDLatestNeural`, `…:DragonHDFlashLatestNeural`)
take no `<prosody>` — they speak at their own pace (the hash records `own`) and exist only in some
regions (eastus, westeurope, southeastasia).

**Azure Speech.** `POST https://<AZURE_SPEECH_REGION>.tts.speech.microsoft.com/cognitiveservices/v1`,
`Ocp-Apim-Subscription-Key: <AZURE_SPEECH_KEY>`, `Content-Type: application/ssml+xml`,
`X-Microsoft-OutputFormat: audio-24khz-96kbitrate-mono-mp3`. Errors: 401 / 403 → account pause
(`azure http 401` — the recovery's `resetAccountFailures` covers it); 429 → rate limit; 400 / 415 →
permanent for this text; 5xx → transient. The free tier (F0) allows 20 requests per 60 s, so the
default `max_rpm` is **15** (the limiter starts at 8/min and learns up to it). Curated voices:
Xiaoxiao 晓晓 (default, female), Xiaochen, Xiaoyi; Yunxi 云希 (male), Yunjian, Yunyang; HD Flash /
Dragon HD variants. Secrets `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` (GitHub Actions secrets of
the same names, pushed by deploy.yml only when set); unset = Azure is skipped.
`GET /api/admin/audio/settings?azure_voices=1` lists the region's zh-CN voices (read-only; proves the key).

**Admin page `/admin/audio`**: a card per provider (configured? missing secrets, paused / working,
learned RPM, last success / error, enable, max RPM, voices per role with ▶ samples via
`POST /api/admin/audio/sample { provider, voice?, role?, text?, speed? }` — through that provider's
limiter, nothing kept), ↑↓ ordering for stored and live, the upgrade toggle, the backlog with
**Retry failed now** / **Run backfill**, sticky Save. `audio_backfill_status` also returns
`providers` (the same per-provider state) and `stored_clips` (effective order, current providers).

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
| Rate limiter | `durable/tts-limiter.ts` (DO `TTS_LIMITER`, one instance per provider) + `services/tts/bucket.ts` (pure) | token bucket at the LEARNED rate (AIMD, below; hard cap `MINIMAX_RPM` = 55, ceiling `MINIMAX_RPM_MAX` = 60), burst ≤ 5 → never more than rpm + burst in any minute |
| Account pause | `services/tts/account.ts` (pure + the failure-reset SQL), held by the same DO | no credit / bad key → every call paused 5 → 60 min, one probe per pause, auto-recovery (below) |
| The MiniMax call | `services/audio.ts` `callMiniMaxTTS` | the ONLY function that calls MiniMax: slot first, then the call, outcome reported back |
| Clip worker | `services/tts/clips.ts` `ensureClip` | one clip (word / card sentence / sentence-set row): idempotent, key swap, shared copies |
| Queue | `tts-queue` (`services/tts/queue.ts`) | one clip per message + the backfill pump; `max_concurrency` 2, batch 4 |
| Backfill | `services/tts/backfill.ts`, `cron.ts`, `schedule.ts` | the backlog in priority order; nightly + hourly crons |
| Admin | `routes/audio-backfill.ts`, MCP `audio_backfill_status` / `audio_backfill_run` / `audio_retry_failed` / `audio_tts_compare` | account problem, counts, limiter, throughput, ETA, retry failed clips |
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
  made now waits in the queue. See "Google fallback" for the only live exceptions.
- The DO logs `{"type":"tts_limiter", …}` once a minute with tokens and last-hour counts, and
  `event: rpm_changed` / `minimax_rate_limited` whenever the learned rate moves.
- **A waiting tap reserves the next token**: when an interactive caller is told to wait, batch may
  not take a token until its retry time + 5 s. At 9/min the burst is ONE token, so without this a
  pump worker polling for a slot could take every token from under a waiting tap.

## Account problems (no credit, bad key)

Oct 2026: the Starter plan was cancelled before the pay-as-you-go top-up reached the API key, and
every call answered `base_resp 2053 insufficient credit`. Each clip recorded that as its own
failure, climbed the 10 min → 24 h retry ladder and 715 word clips ended up waiting until the next
day. An account problem is not about the clip, so (`services/tts/account.ts`):

- **Account codes**: `2053` insufficient credit, `1008` insufficient balance, `2056` plan quota for
  this 5-hour window, `1004` auth failed, `2049` invalid key, HTTP `401` / `403`
  (`MINIMAX_ACCOUNT_CODES` / `MINIMAX_ACCOUNT_HTTP`). `1004` used to be "permanent" per clip (7 days).
- `callMiniMaxTTS` reports `account_error` to the limiter and returns `rateLimited: true` +
  `account: <code>`: the caller waits, exactly like a rate limit — **no `tts_clip_failures` row,
  no attempt burnt**. Queue messages requeue after the pause (≤ 5 min a hop); the pump sleeps.
- The limiter **pauses every call** (all priorities): 5 min, then 10, 20, 40, 60, 60… Calls that
  were already in flight when the pause began don't lengthen it. While paused `acquire` answers
  `{ granted: false, account: <code> }` at once (an interactive tap doesn't wait 8 s) and the
  denials don't count as demand for the AIMD.
- After a pause the next caller is the **probe** (one at a time; others wait for it, a probe that
  never reports frees the gate after 60 s). A clip, or MiniMax's own rate limit, **clears** the
  problem: clips whose last failure was an account error are due again now (attempts 0,
  `resetAccountFailures`) and the pump starts. Another account error doubles the pause. A network
  blip / 5xx / refused text proves nothing: the next caller probes again.
- **ntfy** (`NTFY_TOPIC`): one ping when the problem starts, one when it clears.
- State lives in DO storage key `account` (survives deploys). `audio_backfill_status` shows it
  first: `account_problem: { code, message, since, last_error_at, errors_in_a_row, paused_until,
  probing }` (null = fine) and `clips_waiting_on_account_errors`.
- **`audio_retry_failed({ error_code? })`** (`POST /api/admin/audio/retry-failed`): failed clips
  due now with attempts 0 — account errors (default), one code (`2053`, `401`) or `"all"`; also
  ends a running pause so the next call probes at once, and starts the pump. Use it after fixing
  the account instead of waiting for the next probe.
- **Balance**: MiniMax publishes **no balance / usage API for pay-as-you-go keys** (the error-code
  page says "check your balance on the platform"; the only quota endpoint,
  `GET /v1/token_plan/remains`, is for Token Plan subscription keys and refuses PAYG keys).
  `audio_backfill_status.account` says so (`balance: null`, `balance_api: false`).

## Google fallback

With the default settings Google's voice is only ever a stand-in for **live playback that nobody
keeps** (it is in `live_order`, not `stored_order`), while MiniMax can't speak (rate limit, account
pause). Anything stored — by the server or on a device — uses the stored order instead.
`generateConversationTTS` / `cachedConversationTTS` take `allowGoogleFallback` (default **off**) =
"use the live order"; a clip of a provider outside the stored order is never put in R2
`tts-cache/`. The table below describes the defaults; an admin can put Azure (or Google) in the
stored order at /admin/audio.

| Path | Kept where | Google fallback |
|---|---|---|
| Stored clips (word, card sentence, sentence set: `ensureClip`, ensure-audio, generate-audio, backfill) | R2 + both apps | **never** — queued; the device shows "Audio coming…" |
| `POST /api/practice/tts` (lesson exercises, conversation voices, readers' page audio, quests, chat Read aloud / listening clips, in-call activities) | the device keeps it **forever** (web `ttsCache`, Lab `LessonMedia` / `ChatClips`) | **never** — `503 { retryable: true }`; the device voice covers the moment and the next play / prefetch tries MiniMax again. (Before Oct 2026 a Google stand-in returned here was cached on the phone for good — why lesson / homework audio "ended up with the Google voice".) |
| Chat listening-mode pre-generation (`services/chat/message-audio.ts`) | R2 `tts-cache/` | **never** (background) |
| Voice samples (`/api/conversation-voices/sample`) | R2 | **never** (`generateMiniMaxTTS`) |
| `POST /api/conversations/:id/tts` (Lab's Read-aloud fallback when nothing is cached) | played once | **yes** (`provider: 'gtts'` in the response) |
| Claude role-play replies (`/ai-respond`, `/ai-opener`) | played once with the reply | **yes** |

Old Google clips already stored on the server are the backlog's `google` tier (regenerated by the
pump). Clips a phone cached before this change stay on that phone until its cache is cleared.

### The learned rate (AIMD)

The plan's real RPM is not known to the code (Starter = 10/min; pay-as-you-go = 60/min; it may
change without notice). The limiter learns it (pure logic `services/tts/bucket.ts`
`adaptiveBounds` / `initialAdaptive` / `rollAdaptive` / `noteRequest` / `noteRateLimited`,
unit-tested in `tts-limiter.test.ts`):
- first run: **8/min**; afterwards the persisted rate (DO storage key `adaptive`, with the last 30
  changes) — a restart or deploy keeps what was learned;
- **×1.25 (at least +2/min)** after each full minute in which someone was refused a slot (there was
  demand — an idle minute proves nothing; neither does an account pause) and MiniMax never said
  1002 / 429: 9 → 12 → 15 → 19 → 24 → 30 → 38 → 48 → 55, i.e. 8 busy minutes from the old Starter
  rate to the cap (it was +2/min: 23 minutes);
- **×0.5** on a 1002 / 1039 / 429 (plus the 15 s / 60 s block above); the minute that started with
  the 1002 earns nothing;
- floor **2/min**; ceiling `MINIMAX_RPM_MAX` (default 60) and `MINIMAX_RPM` when it is set (a hard
  cap: what we allow ourselves whatever the learning says).
- `wrangler.toml` ships `MINIMAX_RPM = "55"` (pay-as-you-go: 60/min for T2A, since Oct 2026; it
  was 9 on the 10/min Starter plan). The learned rate finds the real limit below it; a 1002 halves it.

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

- Status: MCP `audio_backfill_status` (or `GET /api/admin/audio/backfill`): `account_problem`
  first (null = fine), backlog by kind ×
  state, clips by provider / model / voice, failures, limiter (`learned_rpm`, `rpm_cap`,
  `last_rate_limited_at`, `rpm_history`, night, last hour), measured clips/min, the ETA and
  `eta_at_learned_rpm` (backlog ÷ the batch share of the learned rate).
- Kick: `audio_backfill_run` (`limit` also queues that many clips at once).
- After fixing the account: `audio_retry_failed` (failed clips due now + probe at once).
- Plan RPM: `MINIMAX_RPM` in `worker/wrangler.toml` `[vars]` is a hard cap a little under the
  plan's limit (55 for pay-as-you-go's 60/min).
- Perceived speed after a model change: `audio_tts_compare` returns durations for the old and
  new model; if they differ, set `TTS_SPEED_OVERRIDE` (0.5–2) — the settings hash changes and the
  backfill regenerates everything at the new speed.
