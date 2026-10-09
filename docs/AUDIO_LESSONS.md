# Audio lessons

Agent-written listening lessons, rendered to ONE audio file per lesson, for the train and for falling
asleep. A prototype (Oct 2026). Web: More → 🎧 Audio lessons (`/audio-lessons`, player at
`/audio-lessons/:id`). MCP: `create_audio_lesson`, `get_audio_lesson`, `list_audio_lessons`,
`get_audio_lesson_feed`. Every ready lesson is also an episode of the user's private podcast feed
(see "Podcast feed").

## The three formats

Pick by what the learner has and wants (the MCP `create_audio_lesson` description says the same): **dialogue** — practise a
situation; **sleep** — learn the new words of a text, slowly; **story** — listen to (and repeat) a whole story or
conversation they already have, in the background.

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

**Sleep (format B, slow immersion, comprehensible input).** Input: any Chinese text. Chinese throughout —
no pinyin is ever spoken; the only English is one recap line per word and one translation per example sentence,
both in a calm English voice (role `recap`: Azure `en-US-EmmaNeural`, Google `en-US-Neural2-F`; app rate 0.9). For
each new word (one chapter each, round 3 order, Oct 2026; round 4 adds the per-character lines and the varied wordings):
1. **"这是一个新词。我说三遍。" + the word ×3** — Jerome hears this every word, so its pauses are short (0.5 s
   between the two phrases, 0.9 s before the word, 1.3 s between repeats, 2 s after). The intro is said in one of a
   few plain wordings ("我们来学一个新词。我念三遍。" …, see "Variation").
2. **Each character, one by one** (every distinct character of the word; a one-character word once): its tone
   (below, "导，第三声。"), then its own line (`char_notes`, below, "Each character": "你学过‘导游’的‘导’。" /
   "‘航’也在‘航空’里。" / "‘驶’是一个新字，你以前没见过。"), then the next character; after the last one, where the word
   says a tone differently ("在‘任务’里，‘务’读轻声。"). Plans written before round 4 say `characters_zh` here instead.
3. **What it MEANS** (`meaning_zh`, REQUIRED, 5–8 short sentences, each ≤ 30 characters): comprehensible input — the
   meaning said, then said again a little differently, a tiny everyday situation, a contrast with a known word, and
   restated plainly, all with words the learner knows ("邮局是一个地方。" "在邮局，你可以寄信。" "你想给妈妈寄一封信，
   你去邮局。" … "邮局不是银行。银行里有钱，邮局里有信。" "邮局，就是寄信的地方。"); 2.2 s after each sentence.
4. **ONE English recap line**: "The word was 银行: bank, as in the place where you keep your money, not the bank of a
   river." — Claude writes only what follows the colon (`recap_en`) and pins down the sense when the English word has
   several; the word inside it is the sleep voice's own clip (`sleepRecapText`, `mixed` with the recap / sleep voices).
5. **"我们听三个句子。" and the three example sentences**: each said three times (1.8 s between, 1.2 s after), then its
   `english` translation ONCE in the recap voice (`sleepTranslationText`), 2.5 s, the next sentence.
3.5 s before the next word. A text of ≤ 600 characters is read once more at the end (原文).
`validateSleepPlan` refuses a word whose `meaning_zh` has fewer than 5 or more than 8 sentences, repeats a sentence
word for word, or has a sentence that only says where a character comes from (`isCharacterOrigin` — that belongs in
`characters_zh`); a missing / pinyin-laden `recap_en`; and an example sentence without a spoken English translation
(letters required, ≤ 140 characters, no pinyin). The
transcript shows the recap as one row (`transcriptRows`: a `recap` line + the `sleep` word right after it); a line
said several times in a row is ONE row with "×3" (`TranscriptRow.repeat`), and an example sentence's spoken
translation joins that sentence's row (it is already its `english`).

**Each character** (round 4, Oct 2026, `shared/audio-lesson/characters.ts`, `worker/…/audio-lessons/char-links.ts`).
Jerome: "the last one doesn't seem to explain all the characters" — the round-3 `characters_zh` was optional and the
agent covered about half of them (安静的周末: 附, 锻, 炼, 筝, 天, 散 … had nothing). Now every character gets a line,
and WHICH words it names is decided in code, never from the model's memory. `pickCharLinks` per distinct character:
1. **known** — 1–3 words he has REVIEWED (a learning or mature card; `learnerVocabulary` tier ≥ 1) that contain the
   character with the same reading as in the taught word, mature first, then the most frequent (wordfreq rank), then
   2-character words: "你学过‘导游’的‘导’。";
2. **common** — else 1–2 words containing it with the same reading within the top 5000 of the wordfreq list
   (`CHAR_LINK_LIMITS.commonMaxRank`): the character dictionary's frequent words (`CharRecord.words`) ranked by the
   word dictionary (`WordRecord.rank` / `syllables`), both static assets read through `CHAR_DICT`: "‘航’也在‘航空’里。";
3. **other_reading** — else his reviewed words where it is read differently ("你在‘不行’里见过‘行’，这里读音不一样。");
4. **new** — else, when no reviewed note of his (word or sentence) contains it: the app's own line, "‘驶’是一个新字，
   你以前没见过。" (one of `NEW_CHARACTER_LINES`); **none** — met only in a sentence card: nothing more is said.
The taught word itself is never offered. Readings: the word's pinyin when it lines up with the characters, else
pinyin-pro (`charReadings`). The facts reach the agent in `check_known_words` (per character `say` + `words`, sleep
only) and again in any refusal; at `submit_lesson` the worker recomputes them for the plan's words and
`charNoteProblems` checks each `char_notes` entry `{ char, words, zh }`: one per distinct character in order; named
words (and anything quoted in `zh`) only from the facts; known 1–3, common 1–2 and never "学过 / 认识 / 见过 / 你知道";
not "新字" for a character he knows; zh Chinese only, ≤ 40 characters, saying the character and every named word;
a new character: words [] (its zh is replaced). `stampCharNotes` then writes each note's `kind` from the facts (never
the model's) and clears a new character's zh, so the compiler says the new-character line itself. Without the
dictionary binding (tests) there are no common words — a character is then "new" only if he truly never met it.

**Variation** (`shared/audio-lesson/phrases.ts`). The fixed lines of a word block come in 4–6 hand-written, plain
(HSK 1–3) wordings each, never improvised by the model: the intro (`NEW_WORD_INTROS`: "这是一个新词。我说三遍。",
"我们来学一个新词。我念三遍。", "下面是一个新词。请听三遍。" …), the tone line (`TONE_LINES`: "导，第三声。" / "导，是第三声。" /
"导，读第三声。" / "导，它是第三声。"), the tone-change line (`TONE_CHANGE_LINES`), the new-character line
(`NEW_CHARACTER_LINES`), "我们听三个句子。" (`SENTENCES_INTROS`) and the English recap's opening (`RECAP_OPENINGS`: "The
word was" / "That word was" / "Our new word was" / "The new word was"). `variantIndex` picks deterministically from a
seed of the lesson (`sleepVariationSeed`: title + words) and the word's index — an offset plus a step that is never a
multiple of the pool size, so a plan always compiles to the same script and two consecutive words never use the same
wording (new-character lines count their own index across the lesson). No seed = variant 0 = the original line.

**Character tones** (`shared/audio-lesson/tones.ts`). Claude gives every Han character of the word its CITATION
tone — `char_tones: [{ char: '导', pinyin: 'dǎo', tone: 3 }, { char: '航', pinyin: 'háng', tone: 2 }]` (tone 1–4,
5 = 轻声 for an inherently neutral character like 了 / 的) — and the compiler (`charToneLines`) speaks, after the
word ×3, one line per distinct character, "导，第三声。" (the sleep rate, `PAUSES.sleepCharTone` 1.5 s after each), shown in the
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

**Story (format C, "Listen & repeat a story", Oct 2026).** Input: a longer Chinese story or conversation as pasted — a
transcript, a dialogue with speaker labels, an article (≤ 6,000 characters). Nothing is taught and the Chinese is never
rewritten: the app splits it, Claude only translates, and the lesson is the whole text, chunk by chunk:
1. the chunk (one or two sentences) in Chinese at the slowest rate, 2 s;
2. the same again, 2 s; a third time, 2 s;
3. its English translation once (the calm English voice, role `recap`, app rate 0.9), 2.5 s; the next chunk.

The music bed is on by default (background listening, like sleep); the transcript is on by default.

- **The splitter** (`splitStoryText`, `shared/audio-lesson/story.ts`, deterministic, unit-tested in `story.test.ts`): breaks
  after 。！？!?… (a run of them — "真的吗？！", "……" — and the closing quotes / brackets right after), at line breaks and at
  speaker turns; never inside quotes (“” 「」 『』 ‘’ 《》 and ASCII ", tracked as a stack; an unclosed quote keeps the rest of
  its line together). A chunk shorter than 8 letters / characters (`minChunkChars`; punctuation doesn't count) takes the next
  sentence in while it stays ≤ 40 (`maxChunkChars`) — within one speaker's turn or a run of narration lines, never across a
  turn or a heading; a short tail that can't joins the chunk before it. A sentence over 40 is cut at its commas (，；：、) about
  evenly (41 → 21 + 20); a piece still over 80 at sentence ends inside its quotes, then by count.
- **Speaker labels** ("A：", "B:", "明慧：", "Speaker 1:", or a lone "A：" line whose turn is the next line) come off the spoken
  text and pick the voice: a Latin label always counts; a Han label (≤ 8 characters) only when it starts 2+ lines and doesn't
  end in a speech verb ("他说：" / "老师问：" are narration). The first label gets `speaker_a`, the second `speaker_b`, a third
  `speaker_a` again (two voices only); genders from the translation pass (a plain A / B alternates, A female); narration
  is the app's own voice (`teacher` = the provider's default card voice). The transcript shows "明慧：你好！…" (`display`).
- **Headings** — `# …`, a line starting 第一章 / 第二幕 / 第三回 … (followed by a space, a colon or nothing), or 【…】 on a line
  of its own — become chapters and are not spoken. Without headings a chapter starts every 10 chunks, titled with the first
  words of its first chunk (its first clause when that is 4–12 characters, "小明每天早上七点起床…"); ≤ 40 chapters.
- **Cleaned out of the spoken text**: short asides in brackets ("（笑）", "[laughs]", ≤ 12 characters — stage directions), list
  markers ("- ", "1. "), and symbols a voice reads out (/ | \\ _ * # ~ brackets). Lines without Chinese are dropped.
- **Length**: as long as the text — about 2.35 s of audio per Han character (`STORY_MS_PER_HAN`, the forms' "About 5 minutes
  of audio." — `storyEstimateLine`, Lab `AudioLessonFormats`, parity-tested). A lesson holds at most 60 minutes
  (`STORY_LIMITS.maxMinutes`, estimated per chunk the way `estimateScriptMs` measures a script) and 120 chunks (two distinct clips
  each, under the 260-clip limit): `fitStoryChunks` keeps the first chunks that fit and the rest is LEFT OUT — the POST answers
  `notice: "The text is long: this lesson covers the first 1,480 of 3,900 characters (about 60 minutes). Paste the rest as
  another lesson."` (`storyCutNotice`; also on the lesson's detail and the player), the forms say so while typing. That is
  roughly 1,500 Han characters a lesson. No `target_minutes`.
- **Translation** (`worker/src/services/audio-lessons/story.ts`): one Claude pass, `structuredCall` with Sonnet (Haiku on the
  last attempt), forced tool `submit_translations`, thinking off, 30 chunks a call (`translateBatch`) with the 3 chunks before
  as context; per chunk natural, faithful English (no additions, no corrections) + pinyin (through `applyYiBuToneChanges`);
  per speaker label a voice gender. Every asked chunk must come back (else the call is retried). The translations are
  checkpointed in `agent_transcript` (`{ story: StoryState, usage }`) after every batch, so a delivery past the 4-minute deadline
  resumes with the next batch; a failure fails the lesson with the reason and Retry translates again. Usage: Sonnet's
  $2 / $10 per M tokens. The plan (`StoryPlan`: title, speakers, chunks with pinyin / english / speaker / section, `cut`) is
  validated (`validateStoryPlan`) and compiled (`compileStoryLesson`); then speaking and rendering are the same as the other
  formats. A story of 75 chunks ≈ 150 distinct clips.
- **Rates**: the chunks are app rate 0.5 (`STORY_RATE`); any Chinese clip at 0.5 is spoken at the provider's slowest natural
  rate, like the sleep voice (`lessonClipRate`: MiniMax 0.5, Azure 0.6, Google 0.6).
- E2E_TEST_MODE: `fakeStoryTranslate` ("Line 3 of the story." + pinyin-pro's pinyin).

Speeds are on the app's scale (MiniMax's: 1 = normal, cards 0.6); Azure maps them with its
`speed_factor` (0.75 → cards 0.7). Pauses: `PAUSES` in `shared/audio-lesson/compile.ts`.

### Speech rates (sleep)

The sleep voice's Chinese is as slow as each provider still sounds natural — `SLEEP_ZH_PROVIDER_RATE`
(`compile.ts`), in the PROVIDER's own scale, applied by the worker to every `sleep`-voice clip instead of the usual
mapping (`lessonClipRate`, `synth.ts`):

| Provider | Sleep rate | Why there |
|---|---|---|
| MiniMax (`audiobook_female_1`) | 0.5 | its floor; it re-synthesises at the pace (no time-stretch) and stays clean at 0.5 |
| Azure (Xiaoxiao, style `gentle`) | 0.6 (`<prosody rate="-40%">`) | neural zh-CN voices drag and smear syllables below ~0.6 |
| Google (Wavenet A) | 0.6 | WaveNet turns robotic below ~0.6 |

Before round 3 the sleep lines were MiniMax 0.6 / 0.55 (word) and Azure 0.7 / 0.66. The script records the app rate
0.5 (`RATES.sleep`, `RATES.sleepWord`) — the estimate and the clip identity use it. English (recap + translations)
stays at the app's 0.9 (Azure 0.93): calm but natural. These were chosen from the providers' documented ranges and
the rates the app already uses; no clip was synthesised to compare them in the build container (no TTS keys there).

### Pacing (sleep, per word)

| Step | Pause after |
|---|---|
| 这是一个新词。 | 0.5 s (`sleepIntroPhrase`) |
| 我说三遍。 | 0.9 s (`sleepAfterIntro`) |
| the word ×3 | 1.3 s between (`sleepWordRepeat`), 2 s after the third (`sleepAfterWord`) |
| each tone line | 1.5 s (`sleepCharTone`) |
| each sentence of a character's line | 1.8 s (`sleepCharNote`) |
| each `characters_zh` sentence (plans before round 4) | 2 s (`sleepSentence`) |
| each meaning sentence | 2.2 s (`sleepMeaning`) |
| the English recap | 1.5 s (`sleepRecap`) |
| 我们听三个句子。 | 1.5 s |
| each example sentence | 1.8 s between repeats, 1.2 s before its translation, 2.5 s after the translation |
| end of the word | 3.5 s (`sleepBetweenWords`) |

A word now takes about 3 minutes (`SLEEP_MINUTES_PER_WORD`, `agent.ts`; 2.7 before the character lines): the briefing
asks for `round((minutes − 0.5) / 3)` words (2–12; 20 min → 7) and a plan estimated over `1.3 × target + 2` minutes is sent
back ("teach fewer words"). The distinct-clip limit is 260 (each word ≈ 20 clips).

## Music

A very soft, slow ambient bed under the lesson — mixed in the PLAYERS, not the file (the Worker can't decode / mix MP3
cheaply), so the lesson MP3 and the **podcast feed stay speech-only** for now.

- **The track**: `frontend/public/audio/lesson-music-v1.mp3` and the Lab's identical
  `android-lab/app/src/main/res/raw/lesson_music.mp3` (480 KB, 24 kHz mono 40 kbps, a 96 s loop), made by
  `scripts/audio/generate-lesson-music.mjs` — procedural (four slow pad chords Dmaj9 → Bm7 → Gmaj7 → Asus2, soft sine
  partials with a detuned twin, 8 s crossfades, a slow swell), no samples, no third-party audio; written for this app
  and dedicated to the public domain (**CC0 1.0**). It is rendered circularly (exactly periodic) and breathes out to
  near silence at its seam, so a player's loop restart or an encoder's padding is never heard. Peak −12 dBFS, ~−26 dB
  RMS. Rebuild: `FFMPEG=/path/to/ffmpeg node scripts/audio/generate-lesson-music.mjs` (needs libmp3lame); bump the
  file name (`LESSON_MUSIC` in `shared/audio-lesson/music.ts`) when the track changes.
- **Rules** (`shared/audio-lesson/music.ts`, Lab `core/…/AudioLessonMusic.kt`, parity-tested): on by default for
  sleep and story lessons, off for dialogue lessons, the learner's choice remembered per format; it plays only while the lesson
  plays (pause, the end, headphones out and the sleep timer stop it); volume 0.05–1, default 0.35, × the sleep timer's
  fade (`musicOutputVolume`), so it fades out with the voice.
- **Web** (`AudioLessonPlayerPage.tsx`): a second `<audio loop>` from an object URL of the track (Cache API
  `audio-lesson-music-v1` after the first fetch; also in the PWA precache via `includeAssets`), 🎵 Music chip
  (`aria-pressed`) + a volume slider under the chips. localStorage `audio-lesson-music-on-v1:<format>`,
  `audio-lesson-music-volume-v1`.
- **Lab** (`data/audiolessons/LessonMusic.kt`): `LessonMusic` drives an `ExoMusicTrack` — a second ExoPlayer in the
  background service (`REPEAT_MODE_ONE`, `CONTENT_TYPE_MUSIC`, no audio focus of its own: the lesson's player holds it,
  and a call / another app pauses the lesson and with it the music); `AudioLessonEngine` calls it from
  `onIsPlayingChanged`, `STATE_ENDED` and the sleep-timer tick. 🎵 chip + slider in the player.
- Analytics `audio_lesson.music` (on, format, volume_pct).
- **Follow-up (not done)**: a pre-mixed music version for the podcast feed — would need decoding + mixing PCM and
  re-encoding (a Container / a native encoder), or rendering the lesson's speech over a pre-encoded music bed frame by
  frame; not worth it until someone asks for music in the podcast app.

## How it is made

```
POST /api/audio-lessons → audio_lessons row (queued) → audio-lesson-queue
  1. writing    Claude Opus 5.5 (services/audio-lessons/agent.ts): briefing → check_known_words → submit_lesson
                (story: splitStoryText → fitStoryChunks → translations in batches, services/audio-lessons/story.ts)
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
most 260 distinct clips, length vs target). Problems go back to Claude as the tool's error → it repairs
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
- `POST /api/audio-lessons` `{ format: dialogue|sleep|story, description?, dialogue?, text?, title?, target_minutes? (5–40; ignored for story), for_relationship_id? }` → 202 `{ lesson, notice?, chunks? }` (story: how many chunks, and the cut notice; 400 + `problems`; 409 at 3 lessons being made; 503 without the Claude key)
- `audio_lessons.format` is a TEXT column without a CHECK, so the story format needed no migration.
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
remembered), 🎵 music (see "Music"), 🌙 sleep timer (10–60 min or end of chapter; the last 30 s fade out), ☰ chapters, 📝
transcript (on for dialogue and story, off for sleep; the current line highlighted and followed, tap a line to
jump; an English sentence with Chinese inside shows as one row, `transcriptRows`; 拼 / EN chips hide the pinyin / English
lines, remembered per device — `audio-lesson-transcript-pinyin-v1` / `-english-v1`, Lab `AudioLessonPrefs`), **word chips** in
the transcript (every format: the Chinese of each row — and the Chinese inside an English narration row — is word chips made on
the device by the deterministic segmenter, CLAUDE.md "Word chips without an LLM": web `components/audioLessons/TranscriptLine.tsx`
over the chat's `ChatWordsText`, Lab `TranscriptRowView` over `ChineseWords` + `DeviceWords`; a word opens the language
explorer's Word view (source `audio_lesson`), a word already in a deck has the quieter underline; a tap anywhere else on the row
still seeks, a word tap never does; layout unchanged — no per-word pinyin, the row's own pinyin line follows 拼; until the word
lists load the row is its plain text), the word list,
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
~2.5k English characters; a 20-minute sleep lesson (7 words) ≈ 120 clips, ~2.5–3.5k Chinese + ~1k English characters. Azure
neural TTS is ~$16 per M characters (F0: 0.5 M free a month) → well under $0.10; Claude (3–5 rounds
with adaptive thinking) ≈ $0.10–0.40. Time is bound by the TTS rate: Azure F0 = 15 clips/min shared
with the audio backfill → roughly 5–15 minutes per lesson.

## Tests

- `shared/audio-lesson/story.test.ts`: the splitter (sentence ends and their runs, closing quotes, never inside quotes, unclosed
  quotes, long sentences at commas / hard, speaker labels Latin / Han / "他说：", a lone label line, no merging across turns,
  short sentences merged — also across narration lines, headings, asides / list markers / symbols / English lines dropped,
  CRLF), the compile order (×3 at 0.5 with 2 s, the English, 2.5 s; the pinyin / English on the first only; voices; a third
  speaker; chapters per heading / every 10; the transcript rows ×3 with the English joined), the 60-minute cut + notice, the
  forms' estimate (calibrated within 20 % of the compiled script), `validateStoryPlan`, `pickAudioLessonInput` (story), format
  info + music default.
- `worker/…/__tests__/audio-lesson-story.test.ts`: the job on real SQLite with a mocked translation and voices — one batch, the
  一 / 不 rule over Claude's pinyin, 10 distinct clips for 5 chunks, the chapters / transcript / usage; a long text in batches of 30
  with a deadline in the middle → re-enqueue → resume without translating again, the cut noted; no Chinese → failed; a throwing
  translation → failed, Retry translates again; the slowest provider rates; the translation call's shape and its check.
- `shared/audio-lesson/characters.test.ts`: the picker (known words first — mature, then frequent; common words within
  the rank limit and with the word's reading; other reading; new vs met-only-in-a-sentence; never the word itself;
  one step for a one-character word / 姐姐), `char_notes` validation against the facts (invented / unquoted-in-facts
  words, "学过" for common words, "新字" for a known one, a new character naming words), `stampCharNotes`, the compile
  order (tone → its line → next character → meaning; the app's new-character line), and the wordings (4–6 per pool,
  every one Chinese-only / short / closed, deterministic, never the same twice in a row in a compiled lesson).
- `shared/audio-lesson/audio-lesson.test.ts`: compile (three plays, ×3 repeats, the sleep word order a–e, the short
  intro pauses, the translations after each triplet, voices and rates, source text), plan validation (5–8 meaning
  sentences, no repeats / origins, a spoken English translation per sentence), timeline, transcript rows (×3, the
  translation joined), the music rules, player helpers; character tones (导航 / 任务 /
  你好 / 一样 / 不是 / 姐姐 / 银行 lines, their place and pauses, the transcript's pinyin, `char_tones` validation).
- `worker/…/__tests__/audio-lesson-mp3.test.ts`: frame parsing (tags, Xing, junk), format check,
  silence, assembly (frame boundaries, durations, the Xing header + TOC).
- `worker/…/__tests__/audio-lesson-job.test.ts`: the character facts from cards + a fake `CHAR_DICT` (`makeCharLinks`),
  `check_known_words` carrying them and a refusal naming them; the sleep rates per provider (`lessonClipRate`), the word target
  and length limit, the prompt's order; the whole job on real SQLite with a mocked model and
  voices — a repair round, a rate-limit wait → re-enqueue → resume without remaking clips, rendering,
  parts deleted, provider pinning, failure + Retry, the nudge.
- `worker/src/routes/__tests__/podcast-feed.test.ts`: feed XML well-formed with one item per ready lesson,
  token scope (wrong / malformed / other user's lesson → 404), reset and turn off invalidate feed + files,
  Range / HEAD / 416, the token never in a log line, rate limit.
- `mcp-server/src/tools/audio-lessons.test.ts` (incl. format story: the enum, the when-to-use description, chunks + notice
  passed back); `e2e/tests/audio-lessons.spec.ts` (a story lesson from a pasted conversation: no length slider, the estimate,
  in the list with 📖, the player's header, one row ×3 per line with the speaker, pinyin and English, 拼 / EN, tap to seek, the
  heading as chapter, music on; E2E_TEST_MODE: fake
  model = the sample plans, fake voices = silent lesson-format clips; make → play → chapters →
  transcript (×3 rows with the translation) → music on by default for sleep, plays / pauses with the lesson,
volume, off remembered, off for dialogue → sleep timer → offline, music included). Lab: `LessonMusicTest` (the music
starts / stops with playback, the fade, the toggle), `AudioLessonParityTest` (rows + music rules), screenshots
`audio-lessons-17-player-sleep-music` / `18-player-dialogue-music-off`, `AudioLessonStoryTest` (the create screen offers Story with
its paste box and estimate and no length slider; the player's header, ×3 rows, 拼 / EN), screenshots `audio-lessons-19…22` (story
form, cut notice, player, no pinyin); transcript word chips: `frontend/src/components/audioLessons/TranscriptLine.test.tsx` (chips render with
the row's pinyin / English / ×N unchanged, a word tap opens the explorer and does not seek, a tap elsewhere seeks, an English row
chips only its Chinese), Lab `AudioLessonTranscriptWordsTest` + screenshots `audio-transcript-words-*`.

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
- Story: a lesson is at most ~60 minutes (~1,500 characters); a longer text needs several lessons (the first part is made, the
  notice says so).
