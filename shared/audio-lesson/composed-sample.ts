/**
 * A sample composed plan (composed.ts): the recap of an (invented) video lesson about weekend
 * plans — the shape a recap is built in. The unit tests' fixture, the E2E stand-in and the example
 * in docs/AUDIO_LESSONS.md "Composed lessons". Written for this repo: no real lesson's words.
 */
import type { ComposedPlan } from './composed';

export const SAMPLE_COMPOSED_RECAP_PLAN: ComposedPlan = {
  version: 1,
  title: 'Recap: weekend plans',
  speakers: { A: { name: 'Teacher', gender: 'female' }, B: { name: 'Student', gender: 'male' } },
  blocks: [
    { type: 'chapter', title: 'What we talked about' },
    {
      type: 'en',
      text: 'In this lesson you talked about the weekend: what you did last Saturday, and your plan to go hiking, 爬山, with friends on Sunday.',
    },
    {
      type: 'exchange',
      title: 'The conversation',
      lines: [
        { speaker: 'A', hanzi: '你周末打算做什么？', pinyin: 'nǐ zhōumò dǎsuàn zuò shénme?', english: 'What are you planning to do at the weekend?' },
        { speaker: 'B', hanzi: '我打算跟朋友一起去爬山。', pinyin: 'wǒ dǎsuàn gēn péngyou yìqǐ qù páshān.', english: "I'm planning to go hiking with friends." },
        { speaker: 'A', hanzi: '要是下雨怎么办？', pinyin: 'yàoshi xià yǔ zěnme bàn?', english: 'What if it rains?' },
        { speaker: 'B', hanzi: '要是下雨，我们就在家看电影。', pinyin: 'yàoshi xià yǔ, wǒmen jiù zài jiā kàn diànyǐng.', english: "If it rains, we'll watch a film at home." },
      ],
      gist_en: 'The teacher asks about your weekend plans. You want to go hiking with friends — and if it rains, you will watch a film at home instead.',
    },
    {
      type: 'word_focus',
      hanzi: '打算',
      pinyin: 'dǎsuàn',
      english: 'to plan to',
      meaning_zh: ['打算就是你想做的事。', '你还没做，可是你想做。'],
      examples: [{ hanzi: '我打算跟朋友一起去爬山。', pinyin: 'wǒ dǎsuàn gēn péngyou yìqǐ qù páshān.', english: "I'm planning to go hiking with friends." }],
    },
    {
      type: 'word_focus',
      hanzi: '爬山',
      pinyin: 'páshān',
      english: 'to go hiking',
      meaning_zh: ['爬山就是走到山上去。', '爬山很累，可是很好玩。'],
      examples: [{ hanzi: '周末我们去爬山吧。', pinyin: 'zhōumò wǒmen qù páshān ba.', english: "Let's go hiking at the weekend." }],
    },
    {
      type: 'structure',
      pattern: '要是…就…',
      explanation_en: '要是 means if; the result comes after 就. It is the spoken way to say "if this, then that".',
      examples: [
        { hanzi: '要是下雨，我们就在家看电影。', pinyin: 'yàoshi xià yǔ, wǒmen jiù zài jiā kàn diànyǐng.', english: "If it rains, we'll watch a film at home." },
        { hanzi: '要是你有空，我们就一起去。', pinyin: 'yàoshi nǐ yǒu kòng, wǒmen jiù yìqǐ qù.', english: "If you're free, we'll go together." },
      ],
    },
    { type: 'chapter', title: 'Your turn' },
    { type: 'recall', english: 'How would you say: what are you planning to do at the weekend?', hanzi: '你周末打算做什么？', pinyin: 'nǐ zhōumò dǎsuàn zuò shénme?' },
    { type: 'recall', english: "And: if it rains, we'll watch a film at home.", hanzi: '要是下雨，我们就在家看电影。', pinyin: 'yàoshi xià yǔ, wǒmen jiù zài jiā kàn diànyǐng.' },
    { type: 'chapter', title: '复述' },
    {
      type: 'retell',
      sentences: [
        { hanzi: '这个周末我打算去爬山。', pinyin: 'zhège zhōumò wǒ dǎsuàn qù páshān.', english: "This weekend I'm planning to go hiking." },
        { hanzi: '我跟朋友一起去。', pinyin: 'wǒ gēn péngyou yìqǐ qù.', english: "I'm going with friends." },
        { hanzi: '要是下雨，我们就在家看电影。', pinyin: 'yàoshi xià yǔ, wǒmen jiù zài jiā kàn diànyǐng.', english: "If it rains, we'll watch a film at home." },
      ],
    },
    { type: 'en', text: "That's the recap. Now you're ready for the homework." },
  ],
};
