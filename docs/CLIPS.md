# 🎬 Clips (experimental)

Short, vertical, learning-first "TikTok" clips about the words Jerome is learning. Swipe up for the next
one; anything he taps into — a like, a double-tap, a long press, ✨ — leads to a mini lesson, a graded
reader, a podcast or more clips on the same idea.

A clip is **not an MP4**. It is a JSON script (spec v1) the apps PLAY like a video: full-screen scenes on
a timeline, TTS voice-over, big animated text, optional generated pictures and the soft lesson music loop
underneath. Captions (hanzi · pinyin · English) are always there, so it works muted.

## The format

`shared/clips/doc.ts` — `CLIP_SPEC_DOC` — is the authoring text every clip-writing Claude reads (the
worker's generator and the MCP `create_clip` description). Summary:

```jsonc
{
  "v": 1,
  "title": "刚 vs 刚才 — the 5-second rule",   // ≤ 60 chars
  "hook": "You've been using 刚才 wrong 👀",   // ≤ 60 chars, big on screen in the first scene
  "topic": "刚 vs 刚才",                        // optional (added): what "More clips like this" asks for
  "style": { "theme": "neon", "accent": "#FF3B6B" }, // neon | paper | chalk | comic | sunset | mono | ink | retro
  "words": [{ "hanzi": "刚才", "pinyin": "gāngcái", "english": "just now" }],   // 1–6 focus words
  "tags": ["grammar"],                          // ≤ 6
  "scenes": [                                   // 4–10, each 1500–9000 ms
    { "layout": "title", "duration_ms": 2500,
      "voice": { "text": "刚和刚才，有什么不一样？", "lang": "zh", "voice": "teacher" },
      "image_prompt": "…", "emoji": "⏱️",
      "title": { "headline_zh": "刚 vs 刚才", "headline_en": "just vs just now", "sub": "…" } }
    // big_word { hanzi, pinyin, english, breakdown?[{char, meaning}] }
    // sentence { hanzi, pinyin, english, highlight? }
    // compare  { left, right: { hanzi, pinyin, english, example? }, rule_en? }
    // quiz     { prompt_zh?, prompt_en?, options[2–4], answer_index, explain? }
    // story    { lines[≤ 6]: { speaker?, hanzi, pinyin, english } }
    // list     { title?, items[≤ 6]: { hanzi, pinyin, english } }
    // fact     { text_en, hanzi?, pinyin? (added) }
  ],
  "ending": { "question_en": "…", "cta": "Double-tap to learn more" }
}
```

Field names never change; fields may only be **added** (optional): so far `topic` and `fact.pinyin`.

`validateClipSpec` (`shared/clips/validate.ts`) checks every machine-checkable rule and returns readable
problems: v = 1; title / hook 1–60 chars; the theme; a hex accent; 1–6 words each with hanzi + tone-marked
pinyin + english; ≤ 6 tags; 4–10 scenes of 1500–9000 ms with the body their layout names; the scenes add
up to 15–75 s (aim 20–60); ≤ 3 image prompts; quiz 2–4 distinct options with a valid answer_index; story ≤
6 lines, list ≤ 6 items; compare exactly left + right (+ rule_en); a sentence's highlight occurs in it; a
breakdown's characters are in the word; voice lines without brackets / blanks / ellipses (TTS reads them),
"zh" lines with Chinese. On import the pinyin checker corrects impossible syllables (`fixSpecPinyin`, like
lessons) and the reply lists them as `pinyin_fixes`.

## Player (web `/clips`, Lab `/clips`)

- **Feed**: full-screen vertical snap scroll; only the clip on screen plays; the next clip's voice lines
  and pictures are fetched ahead. Order from the server: unseen first, then seen-not-finished, then
  finished; inside a tier by fit (`rankClipFeed`: his struggling words 4, studied words 3, a shared
  character 1, liked tags 2, −2 per skip) then newest. The order on screen never changes while he watches.
- **The clock** (`shared/clips/playback.ts`, the same state machine in both apps): a scene runs for its
  duration, then HOLDS while its audio is still playing; a quiz stops the clock until answered (or its
  duration runs out → the answer shows) and then shows the explanation for 2.5 s; then the end card
  (the ending question, the words, ✨ Learn more · ↻ Watch again · Next ↓).
- **Speech** (`sceneUtterances`): a scene WITH `voice` says only that line. Without: a story reads every
  line (each distinct speaker its own voice — female, male, …; 旁白 / Narrator the narrator voice), a list
  its items, a sentence / big word its hanzi. Voices: teacher = the app voice, female / male = the first
  default lesson voices, narrator = the audiobook narrator. Every line is a practice-TTS clip
  (`POST /api/practice/tts`, speed 0.6, cached on the device), made ahead on the server on import /
  generation (`clip-queue` `{ kind: 'audio' }` → R2 `tts-cache/`), so playback is instant and works
  offline once fetched. " / " in a line is read as a pause (`clipTtsText`).
- **Story bubbles** (`storyCast`): the first speaker on the left, the second on the right, narrator labels
  centred; lines appear across the first 70 % of the scene, the one being read always shown.
- **Gestures**: tap = pause / play; double-tap = ❤️ burst + like + the Learn more sheet; long press (550 ms)
  = Learn more; tapping any Chinese opens the language explorer and pauses until it closes.
- **Right rail**: ❤️ Like · 🔖 Save · ✨ More · 拼 pinyin · EN English · 🔇 sound — each with a label and
  a pressed state (never colour alone). Hanzi with no pinyin field (compare examples, quiz prompts /
  options, headlines, list titles, captions) gets device pinyin when 拼 is on. Per-device prefs.
- **Themes**: eight looks, each clearly different (palette, type, texture, card shape): neon (night glow),
  paper (ruled notebook + tape), chalk (blackboard), comic (halftone, ink lines, hard shadows), sunset (warm
  gradient, glass cards), mono (Swiss minimal), ink (rice paper, ink wash, a red seal), retro (CRT scanlines,
  pixel borders). `prefers-reduced-motion` turns the motion off.
- **Music**: the lesson music loop (`shared/audio-lesson/music.ts`) quietly under a playing clip with sound.
- **Offline**: the feed is kept on the device (web: its own IndexedDB `clips`; Lab: the JSON cache), with
  an outbox of events (views, completes, likes, saves, skips, quiz answers, Learn more) uploaded when online
  (`POST /api/clips/events`, idempotent by id).

## Learn more ("Keep going with <topic>")

All of it lands in the learner's OWN account; nothing is sent to anyone.

| Offer | What happens |
|---|---|
| ✨ Mini lesson | ONE per clip, written on `clip-queue` (`{ kind: 'lesson' }`) by the lesson writer (forced tool, thinking off, validateLessonSpec + 2 repair rounds, the 一 / 不 rule) from the clip's words and idea; opens in the lesson player when ready. Its state is on the clip row. |
| 📖 Graded reader | The reader generator (story-generation-queue, due-words mode) with the clip's words + a few he is studying, topic = the clip's topic. |
| 🎧 Podcast | An audio lesson, dialogue format, whose situation uses the clip's words and idea. |
| ⚡ Study these words today | The words he already has go into today's ⚡ pocket (bump). |
| ＋ Add as cards | The words he doesn't have → AddChunkModal. |
| 🎬 More clips like this | Two more clips generated on the same topic and words. |

## Generation

`POST /api/clips/generate { topic?, words?, count? (1–3) }` inserts `generating` rows and queues
`{ kind: 'generate' }` on **`clip-queue`**. The writer (`services/clips/writer.ts`) gets `CLIP_SPEC_DOC`, the
topic, the focus words, his struggling words and the words he studied in the last two weeks, his newest
decks and the titles of the clips he already has; one forced-tool call (thinking off), the 一 / 不 tone
changes, `validateClipSpec`, up to two repair rounds with the problems; then the pinyin checker; then the
pictures and voice lines are made ahead. Each clip of a request takes a different angle. At most 6 being
written per account; stale rows (15 min) are reported failed (Retry). E2E_TEST_MODE / no key: a
deterministic stand-in (`fakeClipSpec`). Cost-guarded (`jobs`): generate, retry, learn-more.

## API (`worker/src/routes/clips.ts`)

- `GET /api/clips` → `{ clips: ClipRecord[] }` (spec, ready picture keys by prompt, his state, the lesson)
- `GET /api/clips/:id` → `{ clip }` · `DELETE /api/clips/:id`
- `POST /api/clips { spec, source? }` → 201 `{ clip, pinyin_fixes }` | 400 `{ problems }`
- `POST /api/clips/generate { topic?, words?, count? }` → 202 `{ clips }` · `POST /api/clips/:id/retry` → 202
- `POST /api/clips/events { events: [{ id, clip_id, kind, value?, created_at? }] }` → `{ accepted, stored, rejected }`
- `POST /api/clips/:id/learn-more { action: lesson | reader | podcast | more }`

Tables (migration 0137): `clips` (owner, status, source agent | generated | manual, title / topic / theme,
spec JSON, the generation request + progress / error / tokens, the mini lesson's state) and `clip_events`.

## MCP (`mcp-server/src/tools/clips.ts`)

`create_clip` (spec → import; the description is CLIP_SPEC_DOC; pre-checked), `list_clips`, `get_clip`,
`generate_clips { topic?, words?, count? }`. All in the signed-in user's own account.

## Analytics

`clips.open`, `clips.view`, `clips.complete`, `clips.like`, `clips.save`, `clips.learn_more { action, via,
status }`, `clips.quiz_answer { right, timeout }`, `clips.explore`, `clips.caption_toggle`, and the server's
`clips.generate { count, via }`.
