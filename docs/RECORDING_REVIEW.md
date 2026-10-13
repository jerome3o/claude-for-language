# "Needs your ear" — the tutor's recording review queue

The learner records themselves on the read card ("see the characters, say it"). The tutor used to
see **every** recording; now she is asked to listen only to the ones that need her ear.

## Which recordings are in the queue

`shared/recordings/queue.ts` (`reviewQueueReasons`, `isInReviewQueue`) — ONE rule for the worker's
queue route, the dashboard pill, the MCP tool and the in-call Review activity. A recording is in the
queue while the tutor hasn't marked it (Listened / Needs work) and **any** of:

| Reason | Label | Source |
|---|---|---|
| `heard_different` / `nothing_heard` | "Heard: 音响" / "Nothing was heard" | transcript vs the card's hanzi — pinyin **with tones**, numbers normalised (`shared/recordings/transcript.ts`, the same comparison as the study card's ✅ / ❌) |
| `rated_again` / `rated_hard` | "Rated Again" / "Rated Hard" | the learner's own rating of that review |
| `low_score` | "Pronunciation score 72" | Azure accuracy `< LOW_PRONUNCIATION_SCORE` (85) |
| `sounded_off` | "Sounded off: 银 (tone)" | a character `< WEAK_CHAR_SCORE` (80), mispronounced or missed |
| `flagged` | "Flagged for you" | an open card flag on the word |

Thresholds are deliberately **conservative** — better a few too many than a missed mistake. Azure's
zh-CN accuracy runs 0–100: native speakers score ≈ 90+, a clearly wrong tone or initial pulls a
character well under 70. Tune them in `shared/recordings/queue.ts` only; stored per-character scores
are re-judged on every read, so a change applies to old recordings too.

Why both a transcript **and** a score: transcribers "autocorrect" toward real words, so a wrong tone
often still comes back as the right characters (Jerome: "I was saying some words incorrectly and it
was still coming through as correct"). Scripted pronunciation assessment compares the audio with
the expected syllables instead.

## The background check (`worker/src/services/recording-checks.ts`)

`POST /api/audio/upload` → `recording_checks` row (migration 0109) → **`recording-check-queue`**
(one consumer, batch 5). Opening the queue also starts checks for up to 30 recordings in range that
never had one (older recordings, a missed upload hook). The consumer:

1. **Transcript** — `transcribeTake` (Workers AI Whisper → Soniox async → Gemini).
2. **Score** — Azure Speech **Pronunciation Assessment**, REST API for short audio
   (`services/pronunciation/azure.ts`): `https://<region>.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=zh-CN&format=detailed`,
   header `Pronunciation-Assessment` = base64 JSON `{ ReferenceText: <hanzi>, GradingSystem: HundredMark,
   Granularity: Phoneme, Dimension: Comprehensive, EnableMiscue: True, PhonemeAlphabet: SAPI }`.
   Per word: `AccuracyScore`, `ErrorType` (None / Mispronunciation / Omission / Insertion), `Syllables`
   (`Grapheme` = the character) and `Phonemes`. A character is marked **tone** when the weakest phoneme
   of its syllable is the SAPI final carrying the tone digit (`"in 2"`), else **sound**.
   Audio formats Azure accepts: 16 kHz mono PCM WAV or Ogg/Opus. `services/pronunciation/audio-convert.ts`
   remuxes WebM/Opus takes (web, Lab MediaRecorder) into Ogg/Opus without decoding, and down-mixes /
   resamples WAV (Lab live takes are already 16 kHz). MP4/AAC → not scored (`score_note`).
3. Stored: `transcript`, `transcript_match`, `score`, `char_scores` JSON (`CharScore[]`), `score_note`
   (why there is no score: `not_configured`, `over_budget`, `unsupported_audio`, `too_long`,
   `azure_auth`, …), `audio_ms`, `scored_at`.

**Free tier (F0)**: 20 requests / minute and 5 audio hours / month. `AZURE_REQUESTS_PER_MINUTE` (18)
counts rows stamped in the last minute (stamped `scoring` before the call, so parallel deliveries
see it) → over it the message is retried 20–40 s later; `AZURE_MONTHLY_BUDGET_MS` (4.5 h) sums
`audio_ms` this UTC month → over it, no more scores until the 1st. A 429 frees the slot and retries
in 60 s; 401/403 is recorded (`azure_auth`), not retried. Takes over 30 s are not scored. Nothing
here runs while the learner waits: study is never blocked.

Secrets: `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` (same as Azure TTS). Without them the queue still
works from transcripts, ratings and flags (`scoring: false` in the response).

## API

- `GET /api/relationships/:relId/recordings/queue?from&to&view=queue|all` (tutor only) →
  `RecordingQueueResponse` (`shared/recordings/queue.ts`): items with the note (+ reference clip key),
  the take's key, rating, mark, check (transcript, score, `weak_chars`), open flag, `reasons`,
  `labels`, `in_queue`; `counts { queue, all, checking }`, `scoring`.
- Marks: the existing `PUT|DELETE /api/relationships/:relId/recordings/:eventId/mark`.
- Dashboard / student page: `pills.recordings_need_ear`.
- MCP: `list_student_recordings` `queue: true`.

## Model recordings — "how it should sound"

When the tutor marks a take **needs work** she can also record her own pronunciation (a model
answer) beside the note. The student hears it next to their own take and compares.

- **Tutor** (web `components/recordings/ModelRecorder.tsx` inside `RecordingsInboxPage`'s note box —
  "+ Note · 🎤"; Lab `ModelRecorderBox` in `ui/teaching/RecordingQueueScreen.kt`): 🎤 Record it → ⏹ Stop · 0:03
  (+ level, stops by itself at a minute) → ▶ Your take · 🔁 Record again · Discard; nothing is uploaded until
  **Needs work + recording** (a take makes the mark needs-work). A saved clip shows as ▶ Your recording on the
  card and in the box (Record again replaces it, Remove takes it off on Save). Optional — a mark can still be
  words only. Not in the call's "Review together" (the live call is the model there).
- **Storage**: R2 `tutor-recordings/<relId>/<eventId>-<id>.<ext>` (person-made, `STORAGE_PREFIXES`, never
  collected), `tutor_recording_marks.model_audio_key` / `model_audio_mime` / `model_audio_ms` (migration 0122).
  The object is deleted when the mark is cleared, when it becomes **listened** (from the recordings page or
  MCP `mark_recording`), when a new clip replaces it, and by account deletion (the tutor's or the student's).
  A new clip clears `student_seen_at`, so the note shows on the card back again.
- **API** (`routes/insights.ts`, `services/model-recordings.ts`): `PUT /api/relationships/:relId/recordings/:eventId/mark/audio`
  (raw audio body ≤ 2 MB, sniffed webm / ogg / mp4 / wav / mp3, `?duration_ms=` ≤ 60 s; 409 without a needs-work
  mark) → `{ mark }`; `DELETE …/mark/audio` → `{ removed, mark }`. Marks carry `model_audio_url`
  (`/api/recording-marks/<eventId>/model-audio?v=<clip id>` — a new URL per clip) on the queue, the student's
  unseen feed (`GET /api/me/recording-notes`, which also carries `recording_url` = his take) and the Tutor notes
  page (`GET /api/me/tutor-notes`). `GET /api/recording-marks/:eventId/model-audio` (routes/recording-notes.ts)
  serves the bytes ONLY to the tutor who made the mark and the student whose take it is (404 otherwise);
  `/api/audio/tutor-recordings/…` is refused. A needs-work mark with a clip and no words is still a note.
- **Student**: "▶ 明慧老师 says it" · "▶ You" (`tutorSaysItLabel`, `shared/tutor-notes`; web
  `components/recordings/ModelRecordingButtons.tsx`, Lab `ModelRecordingPills`) under "From <tutor>: …" on the
  card back (once, like the note), on the Tutor notes page and pinned in its Practice route. Offline: the sync
  downloads the clips of my notes with the session (web `services/modelRecordings.ts` → the `cachedAudio`
  table under `model-recording:<url>`, with my take; Lab `data/audio/ModelRecordings.kt` → `files/model-recordings/`).
- Analytics: `tutor.model_recording_saved { replaced, duration_ms, source }`, `tutor.model_recording_removed`,
  `study.tutor_model_play { where: card | notes | practice, which: tutor | mine }`. MCP `list_student_recordings`
  marks carry `has_model_recording` (no upload through MCP).

## Mix-ups

`shared/recordings/mixups.ts` (`deriveMixUps`): pairs of characters the learner confuses (买 ↔ 卖),
from wrong typed characters and wrong multiple-choice picks (a multiple-choice review's
`user_answer` is the picks in row order). The answer is aligned to the hanzi along a longest common
subsequence; an unmatched stretch of the same length on both sides is read as substitutions.
Unordered pairs, counted once per review, newest example words kept. On the insights report
(`mix_ups`), the tutor's insights page, the Claude summary's input and MCP `get_student_insights`.

## In the call: "Review together"

Going through pronunciation in a lesson used to mean the tutor sharing her screen with the recordings
page open in another tab — and the student couldn't hear their own recording. Now **⋯ → 🎲 Activities →
🎧 Review together** (either person) starts a shared activity (`shared/call-activities`, kind `review`):

- The CallRoom builds the list when it starts (`services/calls/review-activity.ts` `buildReviewSpec`,
  last 60 days, ≤ 30 items): the student's "Needs your ear" queue, their open card flags (words without
  a recording too) and the tutor's needs-work marks from the last 30 days. It rides inside the session
  like every activity spec.
- Both see the same list and the same selected item (`round`); **either** selects (`select`).
- **🔊 Their recording — play for both** / **🔊 Reference** (`play_clip`) bump the session's `play`
  counter with `data.clip`; each device plays the R2 clip itself when it sees the counter rise (never
  on first sight, never through screen-share audio). Selecting keeps the counter, so nothing replays.
- Only the tutor (the host) marks **✓ Listened / ✎ Needs work** + a note (`review_mark`); the room writes
  it through the normal paths (`applyReviewMark`): `tutor_recording_marks` (so it leaves the queue and a
  needs-work note shows once on the student's card) and, for a flagged word, the flag reply
  (`replyToCardFlag` — resolves it and mirrors it into the chat).
- The student doesn't record again in the call (kept simple — they just say it live).
- Results land with the lesson like every activity (`call_activities`; "银行 (yínháng, bank) [Sounded
  off: 银 (tone)] — needs work: …"), on the review page and in the homework agent's notes.
- Lab app: `core/…/calls/CallActivities.kt` (parity-tested) + `ui/calls/ActivityTile.kt`.

## Privacy

Recordings are only listed for the student's tutor (`requireTutor`); the check data never reaches
the student. The upload route refuses a `review_id` that belongs to another account.
