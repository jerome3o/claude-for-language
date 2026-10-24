/**
 * Sample clips: the spec's own example (neon) and a story-led one (ink) — the validator's and
 * the players' fixtures, the E2E seed and the stand-in generator's base.
 */
import type { ClipSpec, ClipTheme } from './types';

export const SAMPLE_CLIP: ClipSpec = {
  v: 1,
  title: '刚 vs 刚才 — the 5-second rule',
  hook: "You've been using 刚才 wrong 👀",
  topic: '刚 vs 刚才',
  style: { theme: 'neon', accent: '#FF3B6B' },
  words: [
    { hanzi: '刚才', pinyin: 'gāngcái', english: 'just now (a moment ago)' },
    { hanzi: '刚', pinyin: 'gāng', english: 'just (adverb)' },
  ],
  tags: ['grammar', 'confusables'],
  scenes: [
    {
      layout: 'title',
      duration_ms: 2500,
      voice: { text: '刚和刚才，有什么不一样？', lang: 'zh', voice: 'teacher' },
      emoji: '⏱️',
      title: { headline_zh: '刚 vs 刚才', headline_en: 'just vs just now', sub: 'one small difference' },
    },
    {
      layout: 'big_word',
      duration_ms: 4000,
      big_word: {
        hanzi: '刚才',
        pinyin: 'gāngcái',
        english: 'just now — a moment ago (a time word)',
        breakdown: [
          { char: '刚', meaning: 'just' },
          { char: '才', meaning: 'only then' },
        ],
      },
    },
    {
      layout: 'sentence',
      duration_ms: 4500,
      sentence: { hanzi: '我刚才吃了饭。', pinyin: 'Wǒ gāngcái chīle fàn.', english: 'I ate a moment ago.', highlight: '刚才' },
    },
    {
      layout: 'compare',
      duration_ms: 6000,
      compare: {
        left: { hanzi: '刚', pinyin: 'gāng', english: 'just (adverb, right before the verb)', example: '我刚到。' },
        right: { hanzi: '刚才', pinyin: 'gāngcái', english: 'just now (a time word, can go before the subject)', example: '刚才我在开会。' },
        rule_en: "刚才 can start the sentence; 刚 can't.",
      },
    },
    {
      layout: 'quiz',
      duration_ms: 8000,
      quiz: { prompt_zh: '___我在洗澡，没听到电话。', prompt_en: 'I was in the shower just now…', options: ['刚', '刚才'], answer_index: 1, explain: 'Before the subject → 刚才.' },
    },
    {
      layout: 'story',
      duration_ms: 7000,
      story: {
        lines: [
          { speaker: 'A', hanzi: '你刚才去哪儿了？', pinyin: 'Nǐ gāngcái qù nǎr le?', english: 'Where did you go just now?' },
          { speaker: 'B', hanzi: '我刚下楼。', pinyin: 'Wǒ gāng xià lóu.', english: 'I just went downstairs.' },
        ],
      },
    },
    {
      layout: 'list',
      duration_ms: 5000,
      list: { title: 'Also say it like…', items: [{ hanzi: '刚刚', pinyin: 'gānggāng', english: 'just (emphatic)' }] },
    },
    { layout: 'fact', duration_ms: 4000, fact: { text_en: 'Native speakers often say 刚刚 for both.', hanzi: '刚刚', pinyin: 'gānggāng' } },
  ],
  ending: { question_en: 'Which one would you use: ___我们见过吗？', cta: 'Double-tap to learn more' },
};

export const SAMPLE_STORY_CLIP: ClipSpec = {
  v: 1,
  title: '一会儿 — how long is "a moment"?',
  hook: '"一会儿" can mean five minutes… or an hour',
  topic: '一会儿',
  style: { theme: 'ink' },
  words: [
    { hanzi: '一会儿', pinyin: 'yíhuìr', english: 'a little while' },
    { hanzi: '马上', pinyin: 'mǎshàng', english: 'right away' },
  ],
  tags: ['time words', 'daily life'],
  scenes: [
    {
      layout: 'title',
      duration_ms: 3000,
      voice: { text: 'How long is 一会儿, really?', lang: 'en', voice: 'narrator' },
      emoji: '⏳',
      title: { headline_zh: '一会儿', headline_en: 'a little while… right?', sub: 'a tiny time word with a big range' },
    },
    {
      layout: 'story',
      duration_ms: 8000,
      image_prompt: 'A cosy small Chinese noodle shop at night seen from the street, steam rising from a pot, warm lights, vertical composition, no text',
      story: {
        lines: [
          { speaker: '旁白', hanzi: '晚上七点，小王在面馆等朋友。', pinyin: 'Wǎnshang qī diǎn, Xiǎo Wáng zài miànguǎn děng péngyou.', english: 'Seven in the evening: Xiao Wang waits for a friend at a noodle shop.' },
          { speaker: '小王', hanzi: '你到哪儿了？', pinyin: 'Nǐ dào nǎr le?', english: 'Where are you?' },
          { speaker: '小李', hanzi: '马上到！一会儿就到！', pinyin: 'Mǎshàng dào! Yíhuìr jiù dào!', english: "Almost there! I'll be there in a moment!" },
          { speaker: '旁白', hanzi: '一个小时以后……', pinyin: 'Yí gè xiǎoshí yǐhòu……', english: 'An hour later…' },
        ],
      },
    },
    {
      layout: 'big_word',
      duration_ms: 4500,
      big_word: {
        hanzi: '一会儿',
        pinyin: 'yíhuìr',
        english: 'a little while — anything from a minute to "later"',
        breakdown: [
          { char: '一', meaning: 'one' },
          { char: '会', meaning: 'a moment' },
          { char: '儿', meaning: '(spoken ending)' },
        ],
      },
    },
    {
      layout: 'quiz',
      duration_ms: 8000,
      quiz: { prompt_en: 'Your friend says "我马上到". Compared with "一会儿到", that is…', options: ['sooner', 'later'], answer_index: 0, explain: '马上 = right away; 一会儿 = in a while.' },
    },
    {
      layout: 'fact',
      duration_ms: 4500,
      voice: { text: '马上 literally means on horseback.', lang: 'en', voice: 'narrator' },
      fact: { text_en: '马上 literally means "on horseback" — already on the way.', hanzi: '马上', pinyin: 'mǎshàng' },
    },
  ],
  ending: { question_en: 'When did your friend last say 马上到?', cta: 'Double-tap to learn more' },
};

/** A sample re-themed (screenshots, the theme picker of the stand-in generator). */
export function sampleClipInTheme(theme: ClipTheme, base: ClipSpec = SAMPLE_CLIP): ClipSpec {
  return { ...base, style: { ...base.style, theme } };
}
