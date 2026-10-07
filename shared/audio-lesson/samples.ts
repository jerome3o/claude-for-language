/**
 * One small plan per format: the unit tests' fixtures and the fake model's
 * answer in E2E_TEST_MODE (worker services/audio-lessons/fake.ts).
 */
import type { DialoguePlan, SleepPlan } from './types';

export const SAMPLE_DIALOGUE_PLAN: DialoguePlan = {
  title: 'Ordering at a Lanzhou noodle shop',
  intro_en:
    "You're at a busy Lanzhou beef noodle shop, a 兰州拉面 place. You order at the counter: the kind of noodle, how spicy, and whether you want an egg. Listen for how the staff ask about thickness.",
  speakers: [
    { id: 'A', name: 'Customer', gender: 'male' },
    { id: 'B', name: 'Cook', gender: 'female' },
  ],
  dialogue: [
    { speaker: 'B', hanzi: '你好，吃什么？', pinyin: 'nǐ hǎo, chī shénme?', english: 'Hi, what are you having?' },
    { speaker: 'A', hanzi: '我要一碗牛肉面。', pinyin: 'wǒ yào yì wǎn niúròu miàn.', english: "I'd like a bowl of beef noodles." },
    { speaker: 'B', hanzi: '要粗的还是细的？', pinyin: 'yào cū de háishi xì de?', english: 'Thick or thin?' },
    { speaker: 'A', hanzi: '细的，少放点辣椒。', pinyin: 'xì de, shǎo fàng diǎn làjiāo.', english: 'Thin, and go easy on the chilli.' },
    { speaker: 'B', hanzi: '加个鸡蛋吗？', pinyin: 'jiā ge jīdàn ma?', english: 'Add an egg?' },
    { speaker: 'A', hanzi: '加一个，谢谢。', pinyin: 'jiā yí gè, xièxie.', english: 'Yes, one, thanks.' },
  ],
  points: [
    {
      kind: 'word',
      status: 'new',
      hanzi: '粗',
      pinyin: 'cū',
      english: 'thick',
      explanation_en: 'This means thick, for noodles or rope. Its opposite is 细, thin. Together they make the question 粗的还是细的.',
      line: 2,
      example: { hanzi: '这根绳子很粗。', pinyin: 'zhè gēn shéngzi hěn cū.', english: 'This rope is thick.' },
    },
    {
      kind: 'structure',
      status: 'learning',
      hanzi: '少放点',
      pinyin: 'shǎo fàng diǎn',
      english: 'put in a bit less',
      explanation_en: 'You know 少, few, and 放, to put. 少放点 means put in a little less. Say it before the ingredient.',
      line: 3,
    },
    {
      kind: 'word',
      status: 'known',
      hanzi: '加',
      pinyin: 'jiā',
      english: 'to add',
      explanation_en: 'You already know this from 加油. Here it simply means add.',
      line: 4,
    },
  ],
  outro_en: "That's it. Next time you're in a noodle shop, ask for 细的.",
};

export const SAMPLE_SLEEP_PLAN: SleepPlan = {
  title: '银行和邮局',
  intro_zh: '你好。今天我们慢慢地学三个新词。',
  words: [
    {
      hanzi: '邮局',
      pinyin: 'yóujú',
      english: 'post office',
      meaning_zh: ['邮局是一个地方。', '在邮局，你可以寄信。'],
      char_tones: [
        { char: '邮', pinyin: 'yóu', tone: 2 },
        { char: '局', pinyin: 'jú', tone: 2 },
      ],
      characters_zh: ['‘邮’是‘邮件’的‘邮’。'],
      recap_en: 'post office, the place where you send letters and parcels.',
      related_known: ['地方', '信'],
      sentences: [
        { hanzi: '邮局在银行旁边。', pinyin: 'yóujú zài yínháng pángbiān.', english: 'The post office is next to the bank.' },
        { hanzi: '我去邮局寄信。', pinyin: 'wǒ qù yóujú jì xìn.', english: "I'm going to the post office to send a letter." },
        { hanzi: '邮局几点开门？', pinyin: 'yóujú jǐ diǎn kāimén?', english: 'When does the post office open?' },
      ],
    },
    {
      hanzi: '寄',
      pinyin: 'jì',
      english: 'to send by post',
      meaning_zh: ['寄就是送东西给别人。', '可是不是你自己去送。'],
      char_tones: [{ char: '寄', pinyin: 'jì', tone: 4 }],
      characters_zh: [],
      recap_en: 'to send by post, as in posting a letter, not sending a text message.',
      related_known: ['送', '东西'],
      sentences: [
        { hanzi: '我想寄一封信。', pinyin: 'wǒ xiǎng jì yì fēng xìn.', english: 'I want to send a letter.' },
        { hanzi: '妈妈给我寄了一本书。', pinyin: 'māma gěi wǒ jì le yì běn shū.', english: 'Mum posted me a book.' },
        { hanzi: '寄到北京要几天？', pinyin: 'jì dào Běijīng yào jǐ tiān?', english: 'How many days to send it to Beijing?' },
      ],
    },
  ],
  outro_zh: '今天就到这里。晚安。',
};

export const SAMPLE_SLEEP_SOURCE = '我家旁边有一个邮局，邮局在银行旁边。我常常去邮局给妈妈寄信。';
