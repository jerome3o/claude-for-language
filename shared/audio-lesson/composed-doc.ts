/**
 * The block reference of a composed audio lesson (composed.ts) — the ONE text the MCP
 * `compose_audio_lesson` tool's description carries and docs/AUDIO_LESSONS.md "Composed lessons"
 * repeats. Keep it in step with the validator.
 */
import { COMPOSED_DEFAULTS as D, COMPOSED_LIMITS as L, COMPOSED_RATES as R, COMPOSED_SCRIPT_LIMITS as SCRIPT_LIMITS } from './composed-limits';

export const COMPOSED_SPEC_DOC = `A COMPOSED audio lesson is a JSON plan of BLOCKS that compiles, deterministically, into one MP3 with chapters and a transcript (hanzi + pinyin + English per line). No model rewrites it: what you write is what is said.

Plan: { "version": 1, "title": "…", "speakers"?: { "A"?: { "name"?, "gender"?: "female"|"male" }, "B"?: {…} } (A female, B male by default), "english_voice"?: "narrator" (default, the English host) | "recap" (a calmer English voice), "blocks": [ … ] }

Voices — Chinese: "teacher" (default, the app's voice), "speaker_a" / "speaker_b" (two dialogue voices), "sleep" (very calm). English: "narrator" | "recap".
Speeds ("rate") — "sleep" ${R.sleep} (slowest), "slow" ${R.slow} (default for Chinese), "normal" ${R.normal}, "natural" ${R.natural}, or a number ${L.minRate}–${L.maxRate}.
Lines — { "hanzi", "pinyin"?, "english"? }: hanzi = clean Chinese the voice reads (no Latin letters, slashes, brackets, ellipses or blanks; ≤ ${L.maxZhChars} characters — one or two sentences); pinyin with tone marks (made automatically when left out; shown, never spoken); english is spoken only where a block says so.
Every block takes "after_ms" (the pause after it). Pauses are whole ms, ≤ ${L.maxPauseMs}.

LOW-LEVEL
- { "type": "chapter", "title" } — starts a chapter in the player (≤ 80 characters). Speech before any chapter goes into one named after the lesson.
- { "type": "zh", "hanzi", "pinyin"?, "english"?, "voice"?, "rate"?, "repeat"? (1–${L.maxRepeat}, default 1), "gap_ms"? (between repeats, ${D.zhGap}) } — Chinese only; english is for the transcript, not spoken. after_ms ${D.zhAfter}.
- { "type": "en", "text", "voice"? } — English; Chinese inside it in Han characters is spoken by the teacher voice ("周末 means the weekend."). Never pinyin. ≤ ${L.maxEnChars} characters. after_ms ${D.enAfter}.
- { "type": "pause", "ms" } (100–${L.maxPauseMs}).
- { "type": "sequence", "hanzi", "pinyin"?, "english"?, "pattern": ["zh","zh","en",2000,"zh"], "rate"?, "voice"?, "en_voice"?, "gap_ms"? (${D.drillGap}), "en_gap_ms"? (${D.drillEnGap}) } — one line in your own pattern: "zh" = the Chinese, "en" = its english, a number = a pause; between two steps without a number: gap_ms (en_gap_ms next to the English). ≤ ${L.maxPatternSteps} steps. after_ms ${D.drillAfter}.

HIGH-LEVEL (expand to the blocks above; every default can be overridden)
- drill — { "type": "drill", "hanzi", "pinyin"?, "english", + any sequence option } = a sequence with pattern ["zh","zh","zh","en","zh","zh"]: three times slowly, the English once, twice more. The transcript shows it as one row "×3 +2".
- word_focus — { "type": "word_focus", "hanzi" (a word, ≤ 12 characters), "pinyin"?, "english", "meaning_zh"?: [0–${L.maxMeaningSentences} very short simple Chinese sentences], "examples"?: [≤ ${L.maxExamples} lines with english — the line from the lesson first], "repeat"? (${D.wordRepeat}), "tones"? (true), "chapter"? (true), "rate"?, "drill"?: { sequence options for the examples } } → chapter "周末 — weekend"; the word ×3 (slow); each character's tone by the English host ("周, first tone.", from the pinyin — give the word's pinyin as it is said); the meaning_zh sentences; "周末 means weekend." once; each example as a drill; the word once more.
- structure — { "type": "structure", "pattern" (as shown, e.g. "要是…就…", ≤ 40; the chapter title, never spoken), "explanation_en" (one short English line, Chinese inside in characters), "examples": [1–${L.maxExamples} lines with english], "chapter"? (true), "drill"? } → chapter, the explanation, each example as a drill.
- exchange — { "type": "exchange", "lines": [2–${L.maxExchangeLines} { "speaker": "A"|"B", "hanzi", "pinyin"?, "english" }], "title"? (a chapter), "slow_plays"? (${D.exchangeSlowPlays}), "slow_rate"? ("slow"), "gist_en"?, "natural_plays"? (${D.exchangeNaturalPlays}), "natural_rate"? ("natural"), "line_gap_ms"? (${D.exchangeLineGap}), "play_gap_ms"? (${D.exchangePlayGap}) } → the dialogue slowly ×2 in two voices, the English gist (gist_en, else each line's english in turn), then at natural speed ×1.
- retell — { "type": "retell", "sentences": [lines] | "text": "a paragraph", "title"?, "repeat"? (${D.retellRepeat}), "rate"? ("slow"), "voice"?, "sentence_gap_ms"? (${D.retellSentenceGap}), "repeat_gap_ms"? (${D.retellRepeatGap}) } → a paragraph in simple Chinese, sentence by sentence, slowly, NO English; the whole paragraph repeat times (≤ ${L.maxRetellSentences} sentences).
- recall — { "type": "recall", "english" (the prompt, spoken: "How would you say: I'm going hiking this weekend?"), "hanzi", "pinyin"?, "think_ms"? (${D.recallThink}), "answer_repeats"? (${D.recallRepeats}), "rate"?, "voice"?, "en_voice"? } → the prompt, silence to answer in, the Chinese answer ×2.
- clip — RESERVED (real audio cut from the lesson recording): not supported yet; refused.

Limits: ≤ ${L.maxBlocks} blocks, about ${L.maxMinutes} minutes (estimated), ≤ ${SCRIPT_LIMITS.maxUniqueSpeech} DIFFERENT clips (a line said again reuses its clip — repetition is free, new lines are not), ≤ ${SCRIPT_LIMITS.maxSegments} segments, ≤ ${SCRIPT_LIMITS.maxChapters} chapters.

Flow: always dry-run first (dry_run: true — nothing is stored): it returns problems, the estimated length, the chapters with their estimated start times and the transcript as the player will show it. Fix the problems, then make it (dry_run: false). It is recorded in the background (minutes); poll get_audio_lesson.`;
