# Audio lessons

Agent-written listening lessons, rendered to ONE audio file per lesson, for the train and for falling
asleep. A prototype (Oct 2026). Web: More → 🎧 Audio lessons (`/audio-lessons`, player at
`/audio-lessons/:id`). MCP: `create_audio_lesson`, `get_audio_lesson`, `list_audio_lessons`,
`get_audio_lesson_feed`. Every ready lesson is also an episode of the user's private podcast feed
(see "Podcast feed").

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

**Sleep (format B, slow immersion).** Input: any Chinese text. Chinese throughout — no pinyin is ever
spoken, and the only English is one recap line per word. For each new word (one chapter each):
"这是一个新词。我说三遍。", the word three times (0.55, 2 s pauses), what it MEANS in very simple Chinese
built from words the learner knows (`meaning_zh`, 1–3 sentences, REQUIRED: "邮局是一个地方。在邮局，你可以
寄信。"), then **each character with its tone** (below), then its characters (`characters_zh`, 0–3:
"'银'就是'银行'的'银'。"), "我们听三个句子。", three
short simple sentences each said three times (0.6, 1.8 s between repeats, 3 s after), then ONE short English
line in a calm English voice (role `recap`: Azure `en-US-EmmaNeural`, Google `en-US-Neural2-F`; 0.9):
"The word was 银行: bank, as in the place where you keep your money, not the bank of a river." — Claude
writes only what follows the colon (`recap_en`) and pins down the sense when the English word has several;
the word inside it is the sleep voice's own clip (`sleepRecapText`, `mixed` with the recap / sleep voices).
5 s before the next word. A text of ≤ 600 characters is read once more at the end (原文).
`validateSleepPlan` refuses a word without `meaning_zh`, a `meaning_zh` that only says where a character comes
from (`isCharacterOrigin` — that belongs in `characters_zh`), and a missing / pinyin-laden `recap_en`. The
transcript shows the recap as one row (`transcriptRows`: a `recap` line + the `sleep` word right after it).

**Character tones** (`shared/audio-lesson/tones.ts`). Claude gives every Han character of the word its CITATION
tone — `char_tones: [{ char: '导', pinyin: 'dǎo', tone: 3 }, { char: '航', pinyin: 'háng', tone: 2 }]` (tone 1–4,
5 = 轻声 for an inherently neutral character like 了 / 的) — and the compiler (`charToneLines`) speaks, after the
meaning, one line per distinct character, "导，第三声。" (0.6, `PAUSES.sleepCharTone` 1.5 s after each), shown in the
transcript as "导，dǎo，第三声。" (`SpeechSegment.display` → the transcript line's text; the pinyin is not spoken —
a Chinese voice reads Latin pinyin as letters, and the character alone IS that syllable). A polyphone whose reading
alone (pinyin-pro's default, a stand-in for the voice's) differs is spoken inside the word: "银行的行，第二声。". Then,
where the word is SAID with another tone, one line from the word's pinyin: a neutral syllable written unmarked
("在‘任务’里，‘务’读轻声。" for rènwu), third-tone sandhi, which pinyin never writes ("在‘你好’里，‘你’读第二声。";
in a run of 3rd tones all but the last), and the 一 / 不 changes via `applyYiBuToneChanges` ("在‘一样’里，‘一’读第二声。");
a repeated character gets 第二个 (姐姐). `validateSleepPlan` (`charToneProblems`) refuses a missing list, one that isn't
one entry per Han character in order, a tone outside 1–5, a pinyin that isn't one tone-marked syllable or whose mark
disagrees with the tone, 一 / 不 not at yī 1 / bù 4, a syllable that isn't the one in the word's pinyin (行 xíng in
银行 yínháng), and a tone the word's pinyin contradicts (other than a neutral syllable or 一 / 不). Joined pinyin is
split where the characters' syllables say ("fāngàn" → fāng + àn). Plans written before `char_tones` compile without
these lines.

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

- D1 `audio_lessons` (migration 0046 reused, 0111 adds the columns; rows from the first, removed attempt
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

## Podcast feed

A private RSS feed per user, so the lessons play in any podcast app (AntennaPod, Pocket Casts, Apple
Podcasts) — downloads, chapters, the app's own sleep timer. `worker/src/routes/podcast.ts`,
`services/podcast-feed.ts`, migration 0112 `podcast_feeds`.

- **Public routes, before the auth middleware** (the token in the path is the only credential):
  `GET /api/podcast/<token>/feed.xml` — RSS 2.0 + iTunes tags + Podcasting 2.0 (`podcast:chapters`,
  `podcast:locked`, `itunes:block` so no directory lists it), one `<item>` per READY lesson, newest first:
  title, description (format, the words, the chapters as `0:00 开始` timestamps — tappable in most apps),
  pubDate (finished_at), `itunes:duration`, `guid` = `audio-lesson-<id>-<version>` (a rebuilt lesson is a new
  episode), enclosure. `GET /api/podcast/<token>/lessons/<id>/<version>/audio.mp3` — `audio/mpeg`,
  `Accept-Ranges`, Content-Length; a valid Range is always 206 (end clamped to the file), past the end 416,
  HEAD supported. `GET /api/podcast/<token>/lessons/<id>/chapters.json` — JSON chapters.
- **Token**: 32 random bytes, base64url (43 characters; anything else is refused before D1 is asked). Stored
  twice, never in clear: `token_hash` = SHA-256 (how a request finds its user) and `token_enc` = AES-GCM with a
  key derived from `SESSION_SECRET`, so Settings can show the same link again. If that secret ever changes the
  link can't be shown (it still works); Settings then offers "Make a new link".
- **Scope**: every lesson lookup is `id AND user_id = <the token's user>` and the version must match, so a token
  reads one user's ready lessons and nothing else; a wrong, malformed or reset token is a plain 404.
- **Reset / off**: `POST /api/me/podcast-feed/reset` writes a new token (the old feed AND file URLs 404 at
  once); `DELETE /api/me/podcast-feed` removes the row. `GET /api/me/podcast-feed` makes it on first use.
- **Rate limit**: Workers rate-limit binding `PODCAST_RATE_LIMITER` (wrangler.toml, 120 requests / 60 s) keyed
  per token (feed and files separately) and per client IP for unknown tokens → 429 + `Retry-After: 60`; a
  per-isolate fixed window with the same numbers when the binding is absent (tests, dev).
- **Never logged**: the request log line carries the route PATTERN (`/api/podcast/:token/feed.xml`) and nothing
  in these routes prints the path (`podcast-feed.test.ts` checks every console line). Cloudflare's own
  invocation logs (dashboard only) still record request URLs — visible only to the account owner.
- **UI**: web Settings → "🎧 Audio lessons · Podcast feed" (`components/settings/PodcastFeedSection.tsx`;
  linked from the Audio lessons page as `/settings#podcast-feed`): the link shown masked, Copy link, Open in
  podcast app (`podcast://`), Apple Podcasts (`pcast://`), Reset link, Turn off, when a podcast app last
  fetched it. Lab: the same section in Settings and as a sheet from the Audio lessons screen
  (`ui/audiolessons/PodcastFeed.kt`). MCP `get_audio_lesson_feed`. Analytics `audio_lesson.podcast_feed`
  (action), `server.podcast_feed_fetched` (items).

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
stay open: the web player stops when you navigate away.

## The player (Lab app)

`android-lab/…/ui/audiolessons/` + `data/audiolessons/`: the same list, form and player, built for
the train and for bed. The lesson plays in `AudioLessonService`, a Media3 `MediaSessionService`
around ExoPlayer, so it carries on with the screen off and the app closed: a media notification
and lock-screen controls (play / pause, ±10 s, previous / next = chapters via `ChapterPlayer`,
"previous" within 3 s of a chapter's start goes one further back), headphone buttons, audio focus,
pause when headphones are unplugged. The sleep timer (fade over the last 30 s, then pause; or the
end of the chapter) and the remembered position run in the service's `AudioLessonEngine`, not the
screen. Speed uses `PlaybackParameters(speed, pitch = 1)`. MP3s are kept under
`files/audio-lessons/<id>-<audio_version>.mp3` (old versions deleted) and the sync saves every
ready lesson, so they play offline without being opened first; seeking uses ExoPlayer's MP3 index
seeking so chapter / transcript taps land exactly. The player's pure helpers are ported to
`core/…/AudioLessonTimeline.kt` and parity-tested (`android-lab/parity/fixtures/audio-lesson.ts`).

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
  Chinese-only sleep, source text), plan validation, timeline, player helpers; character tones (导航 / 任务 /
  你好 / 一样 / 不是 / 姐姐 / 银行 lines, their place and pauses, the transcript's pinyin, `char_tones` validation).
- `worker/…/__tests__/audio-lesson-mp3.test.ts`: frame parsing (tags, Xing, junk), format check,
  silence, assembly (frame boundaries, durations, the Xing header + TOC).
- `worker/…/__tests__/audio-lesson-job.test.ts`: the whole job on real SQLite with a mocked model and
  voices — a repair round, a rate-limit wait → re-enqueue → resume without remaking clips, rendering,
  parts deleted, provider pinning, failure + Retry, the nudge.
- `worker/src/routes/__tests__/podcast-feed.test.ts`: feed XML well-formed with one item per ready lesson,
  token scope (wrong / malformed / other user's lesson → 404), reset and turn off invalidate feed + files,
  Range / HEAD / 416, the token never in a log line, rate limit.
- `mcp-server/src/tools/audio-lessons.test.ts`; `e2e/tests/audio-lessons.spec.ts` (E2E_TEST_MODE: fake
  model = the sample plans, fake voices = silent lesson-format clips; make → play → chapters →
  transcript → sleep timer → offline).

## Lessons from the first attempt (June 2026, removed in #321)

It joined MiniMax clips (32 kHz MPEG-1) and Google clips (24 kHz MPEG-2) byte for byte — a file whose
sample rate changes mid-stream, which players mis-time or cut — with no pauses at all, built lessons
from a deck's word list with Haiku, fired 8 TTS calls at once with no rate limiter, and had no
chapters, no offline player and no notion of what the learner already knew.

## Known limitations

- The web player must stay on screen; for background playback with the screen off use the Lab app.
- Pinned provider + rate limits: with MiniMax out of credit and Azure F0 shared with the backfill, a
  lesson takes minutes.
- `analyseText` is a greedy match, not a word segmenter; Claude makes the final call.
- No URL input yet (paste the text).
