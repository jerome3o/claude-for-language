/**
 * CLIP_SPEC_DOC: the clip spec (v1) every Claude that writes clips reads — the worker's clip
 * generator (services/clips/writer.ts) and the MCP `create_clip` tool's description. One text,
 * the same as docs/CLIPS.md "The format". Field names never change; fields may only be added.
 */

export const CLIP_SPEC_DOC = `# Clip spec v1 — short, vertical, learning-first "TikTok" clips

A clip is NOT an MP4. It is a JSON script the apps PLAY like a video: full-screen vertical scenes that advance on a
timeline, with TTS voice-over (MiniMax via the practice-TTS path, cached on the device), big animated text, optional
generated pictures (Gemini, one per \`image_prompt\`, shared by prompt hash like lesson pictures) and the soft lesson
music loop underneath. Captions (hanzi + pinyin + English, toggleable) are always available — it must work muted.

Target: 20–60 s total, 4–10 scenes, ONE idea per clip, a hook in the first 2 s, a payoff/twist, an ending that asks
something. Language at the learner's level (HSK 2–4-ish), built around words he is actually learning.

\`\`\`jsonc
{
  "v": 1,
  "title": "刚 vs 刚才 — the 5-second rule",          // ≤ 60 chars, shown in the feed / lists
  "hook": "You've been using 刚才 wrong 👀",          // ≤ 60 chars, big on screen for the first scene
  "topic": "刚 vs 刚才",                               // optional: what "More clips like this" asks for
  "style": {
    "theme": "neon",        // one of: neon | paper | chalk | comic | sunset | mono | ink | retro  (each looks clearly different)
    "accent": "#FF3B6B"     // optional hex
  },
  "words": [                // 1–6 focus words (the double-tap "learn more" + "add as card" use these)
    { "hanzi": "刚才", "pinyin": "gāngcái", "english": "just now (a moment ago)" }
  ],
  "tags": ["grammar", "confusables"],   // free, ≤ 6
  "scenes": [               // 4–10 scenes; each 1500–9000 ms (a quiz scene waits for a tap up to its duration)
    {
      "layout": "title",               // title | big_word | sentence | compare | quiz | story | list | fact
      "duration_ms": 2500,
      "voice": { "text": "刚和刚才，有什么不一样？", "lang": "zh", "voice": "teacher" },  // optional; lang zh|en; voice teacher|female|male|narrator
      "image_prompt": "…",             // optional: a vertical illustration for the background (no text in the picture)
      "emoji": "⏱️",                   // optional big decoration
      "title": { "headline_zh": "刚 vs 刚才", "headline_en": "just vs just now", "sub": "one small difference" }
    },
    { "layout": "big_word", "duration_ms": 4000,
      "big_word": { "hanzi": "刚才", "pinyin": "gāngcái", "english": "just now — a moment ago (a time word)",
                    "breakdown": [ { "char": "刚", "meaning": "just" }, { "char": "才", "meaning": "only then" } ] } },
    { "layout": "sentence", "duration_ms": 4500,
      "sentence": { "hanzi": "我刚才吃了饭。", "pinyin": "Wǒ gāngcái chīle fàn.", "english": "I ate a moment ago.", "highlight": "刚才" } },
    { "layout": "compare", "duration_ms": 6000,
      "compare": {
        "left":  { "hanzi": "刚", "pinyin": "gāng", "english": "just (adverb, right before the verb)", "example": "我刚到。" },
        "right": { "hanzi": "刚才", "pinyin": "gāngcái", "english": "just now (a time word, can go before the subject)", "example": "刚才我在开会。" },
        "rule_en": "刚才 can start the sentence; 刚 can't." } },
    { "layout": "quiz", "duration_ms": 8000,
      "quiz": { "prompt_zh": "___我在洗澡，没听到电话。", "prompt_en": "I was in the shower just now…",
                "options": ["刚", "刚才"], "answer_index": 1, "explain": "Before the subject → 刚才." } },
    { "layout": "story", "duration_ms": 7000,
      "story": { "lines": [ { "speaker": "A", "hanzi": "你刚才去哪儿了？", "pinyin": "Nǐ gāngcái qù nǎr le?", "english": "Where did you go just now?" },
                            { "speaker": "B", "hanzi": "我刚下楼。", "pinyin": "Wǒ gāng xià lóu.", "english": "I just went downstairs." } ] } },
    { "layout": "list", "duration_ms": 5000,
      "list": { "title": "Also say it like…", "items": [ { "hanzi": "刚刚", "pinyin": "gānggāng", "english": "just (emphatic)" } ] } },
    { "layout": "fact", "duration_ms": 4000,
      "fact": { "text_en": "Native speakers often say 刚刚 for both.", "hanzi": "刚刚" } }
  ],
  "ending": { "question_en": "Which one would you use: ___我们见过吗？", "cta": "Double-tap to learn more" }
}
\`\`\`

Rules
- Every hanzi with pinyin in tone marks (never numbers), 一/不 tone changes written (yí gè, bú shì), spaces between words.
- Chinese voice lines are what TTS reads: no brackets / slashes / blanks in \`voice.text\`. Quiz prompts may use "___".
- \`story\` ≤ 6 lines, \`list\` ≤ 6 items, \`quiz\` 2–4 options, \`compare\` exactly two sides.
- Pictures: \`image_prompt\` only where a picture adds something (≤ 3 per clip); vertical composition; no text, no real people.
- Keep it true. No invented etymology; if a fact is folk / uncertain, say so ("people say…").
- Make them genuinely watchable: a hook, momentum, humour or surprise, a real-life situation, a payoff.

How the apps play it (so you can write for it)
- A scene WITH \`voice\` says only that line. A scene WITHOUT \`voice\` reads its own Chinese: a \`story\` reads every line
  (each distinct \`speaker\` gets its own voice; the first speaker's bubbles sit left, the second right; 旁白 / Narrator
  is centred, in the narrator's voice), a \`list\` reads its items, a \`sentence\` / \`big_word\` its hanzi; title, compare,
  quiz and fact scenes are silent without \`voice\`.
- A scene stays on screen until its audio has finished (it stretches past duration_ms if it must).
- A quiz stops the clock until the learner taps an option (or its duration runs out), then shows \`explain\` for ~2.5 s.
- \`speaker\` is a short free label: 小王, 老板, 旁白, Narrator, A / B.
- Hanzi with no pinyin field (compare examples, quiz prompts / options, headlines, list titles) gets automatic pinyin
  on the device when the 拼 captions are on — still write natural Chinese there.
- A " / " in a voice line is read as a pause (i人 / e人 → "i人，e人"); brackets, blanks (___) and "…" are refused.
- Optional fields added to v1: \`topic\` (top level), \`fact.pinyin\`.

Checked on import (POST /api/clips answers 400 + problems): v = 1; title and hook 1–60 chars; theme one of the eight;
accent a hex colour; 1–6 words, each with hanzi + tone-marked pinyin + english; ≤ 6 tags; 4–10 scenes, each 1500–9000 ms
with the body named by its layout; the scenes add up to 15–75 s (aim for 20–60); ≤ 3 image_prompts; quiz 2–4
different options with a valid answer_index; story ≤ 6 lines and list ≤ 6 items, each with hanzi + pinyin + english;
compare has left + right (+ rule_en) only; a sentence's highlight occurs in it; a breakdown's chars are in the word.
Impossible pinyin (a syllable its character never has) is corrected on import, like lessons.`;
