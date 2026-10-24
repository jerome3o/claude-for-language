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

Each clip is a tiny INTERACTIVE experience, not just a video: put 2–3 interactive beats in every clip (quiz, listen,
order, reveal, speak — mix them; never two of the same in a row), each one testing the idea the scenes before it just
taught. The clip stops on them and waits for the learner ("👆 Tap an answer", "🎤 Say it"…), then shows the answer.

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
      "layout": "title",               // title | big_word | sentence | compare | quiz | story | list | fact | listen | order | reveal | speak
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
    // two more layouts (the example has 10 scenes, the most a clip may have):
    //   { "layout": "list", "duration_ms": 5000, "list": { "title": "Also say it like…", "items": [ { "hanzi": "刚刚", "pinyin": "gānggāng", "english": "just (emphatic)" } ] } }
    //   { "layout": "fact", "duration_ms": 4000, "fact": { "text_en": "Native speakers often say 刚刚 for both.", "hanzi": "刚刚", "pinyin": "gānggāng" } }
    // ---- interactive beats (the clip waits for the learner) ----
    { "layout": "listen", "duration_ms": 6000,          // hear it (the text hidden), pick the meaning; then the Chinese shows
      "listen": { "hanzi": "我刚到。", "pinyin": "Wǒ gāng dào.", "english": "I've just arrived.",
                  "prompt_en": "What did she say?", "options": ["I've just arrived.", "I arrived a while ago.", "I'm about to arrive."],
                  "answer_index": 0, "explain": "刚 + verb = just did it." } },
    { "layout": "order", "duration_ms": 7000,           // tap the tiles into order; "tiles" IS the right order (the apps shuffle)
      "order": { "prompt_en": "Build: I was in a meeting just now.", "tiles": ["刚才", "我", "在", "开会"],
                 "pinyin": "Gāngcái wǒ zài kāihuì.", "english": "I was in a meeting just now." } },
    { "layout": "reveal", "duration_ms": 5000,          // a flip card: English → (say it in your head) → tap → the Chinese, heard
      "reveal": { "prompt_en": "I just got home.", "hanzi": "我刚到家。", "pinyin": "Wǒ gāng dào jiā.", "note": "刚 sits right before the verb." } },
    { "layout": "speak", "duration_ms": 6000,           // say it: the app plays it, the learner says it back (🎤), checked like a spoken answer
      "speak": { "hanzi": "你刚才去哪儿了？", "pinyin": "Nǐ gāngcái qù nǎr le?", "english": "Where did you go just now?",
                 "prompt_en": "Ask your friend where they went just now." } }
  ],
  "ending": { "question_en": "Which one would you use: ___我们见过吗？", "cta": "Double-tap to learn more" }
}
\`\`\`

Rules
- Every hanzi with pinyin in tone marks (never numbers), 一/不 tone changes written (yí gè, bú shì), spaces between words.
- Chinese voice lines are what TTS reads: no brackets / slashes / blanks in \`voice.text\`. Quiz prompts may use "___".
- \`story\` ≤ 6 lines, \`list\` ≤ 6 items, \`quiz\` / \`listen\` 2–4 options, \`compare\` exactly two sides.
- \`order\`: 3–7 tiles (a word or two each, ≤ 12 characters) IN THE RIGHT ORDER, not all the same; \`pinyin\` + \`english\` of the
  whole sentence. \`speak\`: one short line (≤ 30 characters) the learner can say back. \`reveal\`: \`prompt_en\` (the
  English side) + \`hanzi\` + \`pinyin\` (+ an optional \`note\`). \`listen\`: the line he hears (hanzi + pinyin + english,
  shown only after he answers) and 2–4 options — usually English meanings, one right; make the wrong ones plausible.
- Pictures: \`image_prompt\` only where a picture adds something (≤ 3 per clip); vertical composition; no text, no real people.
- Keep it true. No invented etymology; if a fact is folk / uncertain, say so ("people say…").
- Make them genuinely watchable: a hook, momentum, humour or surprise, a real-life situation, a payoff.

How the apps play it (so you can write for it)
- A scene WITH \`voice\` says only that line. A scene WITHOUT \`voice\` reads its own Chinese: a \`story\` reads every line
  (each distinct \`speaker\` gets its own voice; the first speaker's bubbles sit left, the second right; 旁白 / Narrator
  is centred, in the narrator's voice), a \`list\` reads its items, a \`sentence\` / \`big_word\` its hanzi; title, compare,
  quiz and fact scenes are silent without \`voice\`.
- A scene stays on screen until its audio has finished (it stretches past duration_ms if it must).
- An interactive scene (quiz, listen, order, reveal, speak) stops the clock until the learner answers — there is no time
  limit; Skip appears after a few seconds — then shows the answer (\`explain\`, the right order, the Chinese side…) for
  ~2.5–3.5 s. \`listen\` and \`speak\` always say their hanzi (after \`voice\`, if it has one); an \`order\` scene says its
  sentence and a \`reveal\` card its hanzi once answered. Give them a \`voice\` only for a short spoken prompt.
- Voice lines show as big karaoke captions (the word being said highlighted), so keep them short and natural.
- \`speaker\` is a short free label: 小王, 老板, 旁白, Narrator, A / B.
- Hanzi with no pinyin field (compare examples, quiz prompts / options, headlines, list titles) gets automatic pinyin
  on the device when the 拼 captions are on — still write natural Chinese there.
- A " / " in a voice line is read as a pause (i人 / e人 → "i人，e人"); brackets, blanks (___) and "…" are refused.
- Optional fields added to v1: \`topic\` (top level), \`fact.pinyin\`, and the layouts listen, order, reveal, speak.

Checked on import (POST /api/clips answers 400 + problems): v = 1; title and hook 1–60 chars; theme one of the eight;
accent a hex colour; 1–6 words, each with hanzi + tone-marked pinyin + english; ≤ 6 tags; 4–10 scenes, each 1500–9000 ms
with the body named by its layout; the scenes add up to 15–75 s (aim for 20–60); ≤ 3 image_prompts; quiz 2–4
different options with a valid answer_index; story ≤ 6 lines and list ≤ 6 items, each with hanzi + pinyin + english;
compare has left + right (+ rule_en) only; a sentence's highlight occurs in it; a breakdown's chars are in the word;
listen 2–4 different options with a valid answer_index; order 3–7 tiles (≤ 12 characters each, not all the same) with
the sentence's pinyin + english; reveal prompt_en + hanzi + pinyin; speak hanzi (≤ 30 characters) + pinyin + english.
Impossible pinyin (a syllable its character never has) is corrected on import, like lessons.`;
