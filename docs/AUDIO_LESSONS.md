# Audio lessons

Agent-written listening lessons, rendered to ONE audio file per lesson, for the train and for falling
asleep. A prototype (Oct 2026). Web: More → 🎧 Audio lessons (`/audio-lessons`, player at
`/audio-lessons/:id`). MCP: `create_audio_lesson`, `get_audio_lesson`, `list_audio_lessons`.

## The two formats

**Dialogue (format A, "ChinesePod style").** Input: a situation to practise (+ optionally a pasted
dialogue). Chapters:
1. *Introduction* — the English host sets the scene (Claude's `intro_en`).
2. *First / Second listen* — the dialogue at natural speed (0.9), two Chinese voices.
3. *Third listen, a little slower* (0.75).
4. *Line by line* — each line (0.8), then its English.
5. One chapter per point (word or structure), most important first: the word slowly twice (0.6),
   Claude's English explanation (Chinese inside it is spoken by the Chinese teacher voice), the
   dialogue line that uses it, an extra example (Chinese, English, Chinese), the word once more.
6. *Final listen* — the whole dialogue again, then the outro.

**Sleep (format B, slow immersion).** Input: any Chinese text. All Chinese, no English or pinyin is
spoken. For each new word (one chapter each): "这是一个新词。我说三遍。", the word three times (0.55,
2 s pauses), a very simple explanation built from words the learner knows ("'银'就是'银行'的'银'。"),
"我们听三个句子。", three short simple sentences each said three times (0.6, 1.8 s between repeats,
3 s after), 5 s before the next word. A text of ≤ 600 characters is read once more at the end (原文).

Speeds are on the app's scale (MiniMax's: 1 = normal, cards 0.6); Azure maps them with its
`speed_factor` (0.75 → cards 0.7). Pauses: `PAUSES` in `shared/audio-lesson/compile.ts`.

## How it is made

```
POST /api/audio-lessons → audio_lessons row (queued) → audio-lesson-queue
  1. writing    Claude Opus 5.5 (services/audio-lessons/agent.ts): briefing → check_known_words → submit_lesson
  2. speaking   each DISTINCT clip through the TTS providers → R2 audio-lessons/<user>/<id>/parts/<hash>.mp3
  3. rendering  clips + generated silence → ONE MP3 (Xing header) → audio-lessons/<user>/<id>-<version>.mp3
```

**Plan vs script.** Claude writes a *plan* — the content only (`DialoguePlan`: intro, two speakers, the
dialogue, the points with English explanations; `SleepPlan`: the words, explanations, three sentences
each). `compileDialogueLesson` / `compileSleepLesson` (`shared/audio-lesson/compile.ts`, pure) turn it
into the *script*: ordered `speech` / `pause` segments in chapters, with voice roles and speeds. The
structure (three plays, ×3 repeats, pauses) is code, so it is always right; `validateDialoguePlan` /
`validateSleepPlan` / `validateScript` (`validate.ts`) check the rest (no pinyin in English narration,
the point is in its line, 3 sentences containing the word, sentences short, Chinese-only for sleep, at
most 220 distinct clips, length vs target). Problems go back to Claude as the tool's error → it repairs
in the same conversation.

**Writing (the agent).** `claude-opus-5-5`, adaptive thinking (always on for Opus 5.5), effort `high`,
`tool_choice` auto (Opus 5.5 refuses forced tool use, so the prompt asks for `submit_lesson` and a turn
that ends without it gets one nudge). Tools: `check_known_words` (status known / learning / in_deck /
new + per character the learner's known words containing it) and `submit_lesson`. Transcript
checkpointed in `audio_lessons.agent_transcript` after every turn (append-only, thinking blocks kept);
≤ 10 rounds. No server-side refusal fallback: a refusal fails the lesson with a readable reason.

**Known words.** `learnerVocabulary` (db/audio-lesson-queries.ts): every note's best card tier from the
server's cached card state — the same definition as `services/known-counts.ts` /
`shared/progress/known.ts` (known = Review with stability > 21 d). `services/audio-lessons/vocab.ts`:
`checkWords`, `analyseText` (sleep: greedy longest-match of the text against known/learning words →
the uncovered stretches, given to Claude in the briefing), `levelSample` (80 known words showing the
level).

**Speaking.** `speakClip` (`synth.ts`) → `callProviderTTS` (the provider's limiter + account pause,
batch priority, waits ≤ 40 s for a slot). Chinese: the admin's STORED order (MiniMax → Azure); the
provider of the first Chinese clip is **pinned** for the lesson (`zh_provider`) so one lesson never
mixes voices. English (the host): Azure (`en-US-AndrewNeural`), then Google (`en-US-Neural2-D`).
Voices per role (`voices.ts`): two speakers get two different voices even of the same gender; the
teacher = the provider's default card voice; sleep = MiniMax `audiobook_female_1` / Azure Xiaoxiao with
style `gentle`. Identical clips (a word said three times, the fixed phrases) are made once. A rate
limit or account pause re-enqueues the job with a delay (≤ 5 min) — nothing fails; three real failures
of one clip fail the lesson (Retry resumes, keeping the clips and the script). A delivery past 4 min
re-enqueues itself. A build untouched for 45 min is marked failed (Retry).

## Rendering (MP3 in a Worker)

`services/audio-lessons/mp3.ts`, pure. Every clip is requested as **MPEG-2 Layer III, 24 kHz, mono**
(Azure's `audio-24khz-96kbitrate-mono-mp3`, Google's `sampleRateHertz: 24000`, MiniMax's
`LESSON_MINIMAX_AUDIO_SETTING` = 24 kHz / 64 kbps) and checked frame by frame (`checkClipFormat`) — a
clip in another format is refused rather than joined. Then:
- `parseMp3Frames` drops ID3 tags and each clip's Xing / Info / VBRI tag frame (one in the middle would
  make a player think the lesson ends after that clip);
- silence = 8 kbps frames with all-zero side info (24 bytes, 24 ms each, decoded as digital silence);
- `assembleMp3` concatenates and puts ONE Xing frame (frame count, byte count, 100-point seek TOC) in
  front, so the duration is exact and seeking works although frame bitrates differ.
Each clip's first frame has an empty bit reservoir and silence frames use none, so no frame borrows
bits across a join. Verified: ffmpeg decodes without warnings with exact silence lengths; Chromium reads
the exact duration, seeks and plays to the end (Android's MediaPlayer / ExoPlayer read Xing TOCs too).
Chapters and transcript lines are timed in whole frames (`buildTimeline`, `shared/audio-lesson/timeline.ts`)
from the same clip lengths, so the chapter list lines up with the audio.

## Storage

- D1 `audio_lessons` (migration 0046 reused, 0110 adds the columns; rows from the first, removed attempt
  have `format` NULL and are never listed): status `queued | writing | speaking | rendering | ready |
  failed`, progress + clips done / total, input, agent transcript, plan, script, timeline (chapters +
  transcript), words, file key / size / duration, usage, pinned provider, `for_relationship_id` (a
  tutor's label only — nothing is ever sent to a student).
- R2 `audio-lessons/` — registered in `STORAGE_PREFIXES` as person-made, never collected; the lesson's
  DELETE and account deletion remove it. Not served by the public `/api/audio/*`; only
  `GET /api/audio-lessons/:id/audio` (owner, Range → 206).

## API

- `GET /api/audio-lessons` → `{ lessons }` · `GET /api/audio-lessons/:id` → `{ lesson }` (chapters, transcript, words, speakers, usage)
- `POST /api/audio-lessons` `{ format: dialogue|sleep, description?, dialogue?, text?, title?, target_minutes? (5–40), for_relationship_id? }` → 202 (400 + `problems`; 409 at 3 lessons being made; 503 without the Claude key)
- `GET /api/audio-lessons/:id/audio` · `POST /api/audio-lessons/:id/retry` · `DELETE /api/audio-lessons/:id`

## Offline (web)

`frontend/src/services/audioLessons.ts`: the list + each ready lesson's details in localStorage, the
MP3 in the Cache API (`audio-lessons-v1`, keyed by lesson + file version; a rebuilt lesson replaces the
old file), the position per lesson. Opening a lesson downloads it once ("Saving to this phone… 40 %");
afterwards it plays with no connection.

## The player (web)

Full screen and dark: chapter name, scrubber, ⏮ ↺10 ▶ 10↻ ⏭, speed (0.75 / 0.9 / 1 / 1.25×, pitch kept,
remembered), 🌙 sleep timer (10–60 min or end of chapter; the last 30 s fade out), ☰ chapters, 📝
transcript (on for dialogue, off for sleep; the current line highlighted and followed, tap a line to
jump; an English sentence with Chinese inside shows as one row, `transcriptRows`), the word list,
Media Session (lock screen / headphones: play, pause, ±10 s, chapter back / next, seek). The page must
stay open: the web player stops when you navigate away. The Lab app's player (background playback
with the screen off) is the next PR (android-lab/PARITY.md).

## Cost per lesson

`usage_json` / `get_audio_lesson.usage`: Claude tokens (input incl. cache writes, output, cache reads),
rounds, Claude's cost at list price ($4 / $20 per M), TTS characters per language and distinct clips,
the providers used. Typical (estimates): a 12-minute dialogue ≈ 60–80 distinct clips, ~1.5k Chinese +
~2.5k English characters; a 20-minute sleep lesson ≈ 80–100 clips, ~2–3k Chinese characters. Azure
neural TTS is ~$16 per M characters (F0: 0.5 M free a month) → well under $0.10; Claude (3–5 rounds
with adaptive thinking) ≈ $0.10–0.40. Time is bound by the TTS rate: Azure F0 = 15 clips/min shared
with the audio backfill → roughly 5–15 minutes per lesson.

## Tests

- `shared/audio-lesson/audio-lesson.test.ts`: compile (three plays, ×3 repeats, pauses ≥ 1.5 s, voices,
  Chinese-only sleep, source text), plan validation, timeline, player helpers.
- `worker/…/__tests__/audio-lesson-mp3.test.ts`: frame parsing (tags, Xing, junk), format check,
  silence, assembly (frame boundaries, durations, the Xing header + TOC).
- `worker/…/__tests__/audio-lesson-job.test.ts`: the whole job on real SQLite with a mocked model and
  voices — a repair round, a rate-limit wait → re-enqueue → resume without remaking clips, rendering,
  parts deleted, provider pinning, failure + Retry, the nudge.
- `mcp-server/src/tools/audio-lessons.test.ts`; `e2e/tests/audio-lessons.spec.ts` (E2E_TEST_MODE: fake
  model = the sample plans, fake voices = silent lesson-format clips; make → play → chapters →
  transcript → sleep timer → offline).

## Lessons from the first attempt (June 2026, removed in #321)

It joined MiniMax clips (32 kHz MPEG-1) and Google clips (24 kHz MPEG-2) byte for byte — a file whose
sample rate changes mid-stream, which players mis-time or cut — with no pauses at all, built lessons
from a deck's word list with Haiku, fired 8 TTS calls at once with no rate limiter, and had no
chapters, no offline player and no notion of what the learner already knew.

## Known limitations

- The web player must stay on screen; background playback with the screen off is the Lab app's job.
- Pinned provider + rate limits: with MiniMax out of credit and Azure F0 shared with the backfill, a
  lesson takes minutes.
- `analyseText` is a greedy match, not a word segmenter; Claude makes the final call.
- No URL input yet (paste the text).
