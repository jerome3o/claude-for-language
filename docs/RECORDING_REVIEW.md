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

## Mix-ups

`shared/recordings/mixups.ts` (`deriveMixUps`): pairs of characters the learner confuses (买 ↔ 卖),
from wrong typed characters and wrong multiple-choice picks (a multiple-choice review's
`user_answer` is the picks in row order). The answer is aligned to the hanzi along a longest common
subsequence; an unmatched stretch of the same length on both sides is read as substitutions.
Unordered pairs, counted once per review, newest example words kept. On the insights report
(`mix_ups`), the tutor's insights page, the Claude summary's input and MCP `get_student_insights`.

## Privacy

Recordings are only listed for the student's tutor (`requireTutor`); the check data never reaches
the student. The upload route refuses a `review_id` that belongs to another account.
