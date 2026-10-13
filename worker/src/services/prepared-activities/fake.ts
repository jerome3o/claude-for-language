/**
 * E2E_TEST_MODE only: a stand-in for the model in the prepared-activities
 * generator, so the end-to-end tests and screenshots run the whole flow
 * (briefing → tool reply → parse / validate → store → call menu). It reads the
 * briefing's "New vocabulary" and "Corrections" lines, so what it writes
 * follows the seeded lesson like the real thing would.
 */
import type Anthropic from '@anthropic-ai/sdk';

const FALLBACK_WORDS = [
  { hanzi: '头疼', pinyin: 'tóuténg', english: 'headache' },
  { hanzi: '发烧', pinyin: 'fāshāo', english: 'to have a fever' },
  { hanzi: '感冒', pinyin: 'gǎnmào', english: 'a cold' },
  { hanzi: '咳嗽', pinyin: 'késou', english: 'to cough' },
  { hanzi: '医生', pinyin: 'yīshēng', english: 'doctor' },
  { hanzi: '休息', pinyin: 'xiūxi', english: 'to rest' },
];
const EMOJI = ['🤕', '🤒', '🤧', '😷', '👩‍⚕️', '🛌', '💊', '🏥'];

export function fakePrepareClient(): Pick<Anthropic, 'messages'> {
  return {
    messages: {
      create: async (params: { messages: Array<{ content: unknown }> }) => {
        const text = String(params.messages[0]?.content ?? '');
        const count = Number(/Write (\d+) activities/.exec(text)?.[1] ?? 5);
        const vocab: { hanzi: string; pinyin: string; english: string }[] = [];
        const corrections: { said: string; better: string }[] = [];
        let section = '';
        for (const line of text.split('\n')) {
          if (line.startsWith('New vocabulary')) section = 'vocab';
          else if (line.startsWith('Corrections')) section = 'corr';
          else if (!line.startsWith('- ')) section = line.startsWith('# ') || line === '' ? '' : section;
          const v = section === 'vocab' ? /^- (\S+) \(([^)]*)\) (.+?)( — said:.*)?$/.exec(line) : null;
          if (v) vocab.push({ hanzi: v[1], pinyin: v[2], english: v[3] });
          const c = section === 'corr' ? /^- (.+?) → ([^(]+?)( \(.*\))?$/.exec(line) : null;
          if (c) corrections.push({ said: c[1].trim(), better: c[2].trim() });
        }
        const words = vocab.length >= 4 ? vocab.slice(0, 8) : FALLBACK_WORDS;
        const sentences = (corrections.length >= 2 ? corrections.map((c) => c.better) : ['我头疼，想休息一下。', '医生让我多喝水。', '我昨天发烧了。']).slice(0, 5);
        const all = [
          {
            kind: 'dictation',
            title: "Dictation: last lesson's new words",
            title_zh: '听写：上次课的生词',
            why: `New words from the last lesson: ${words.slice(0, 3).map((w) => w.hanzi).join(', ')}…`,
            level: 'elementary',
            topic: 'Last lesson',
            summary: 'The tutor says a word; the student types it in characters.',
            items: words.slice(0, 6),
          },
          {
            kind: 'build',
            title: 'Build the corrected sentences',
            title_zh: '连词成句',
            why: `Last lesson's corrections — ${sentences.length} sentences said the better way`,
            level: 'elementary',
            topic: 'Corrections',
            summary: 'Put the words in order together, then each says it aloud.',
            items: sentences.map((s) => {
              const chars = Array.from(s.replace(/[。，！？、]/g, ''));
              const tiles: string[] = [];
              for (let i = 0; i < chars.length; i += 2) tiles.push(chars.slice(i, i + 2).join(''));
              return { tiles, pinyin: '', english: s };
            }),
          },
          {
            kind: 'describe',
            title: 'Describe & guess: new words',
            title_zh: '猜一猜',
            why: 'Say the new words without naming them',
            level: 'elementary',
            topic: 'Last lesson',
            summary: 'The student describes a word in Chinese without saying it; the tutor guesses.',
            items: words.slice(0, 6).map((w, i) => ({ ...w, emoji: EMOJI[i % EMOJI.length], hints: ['很难受', '要休息'] })),
            distractors: [
              { hanzi: '牙疼', pinyin: 'yáténg', english: 'toothache' },
              { hanzi: '肚子疼', pinyin: 'dùzi téng', english: 'stomach ache' },
            ],
            glossary: [
              { hanzi: '很难受', pinyin: 'hěn nánshòu', english: 'feels awful' },
              { hanzi: '要休息', pinyin: 'yào xiūxi', english: 'needs rest' },
            ],
          },
          {
            kind: 'quiz',
            title: 'Quick quiz: which is right?',
            title_zh: '哪个对？',
            why: 'The mistakes from the last lesson, as choices',
            level: 'elementary',
            topic: 'Corrections',
            summary: 'The tutor asks; the student picks the right one.',
            questions: (corrections.length >= 3 ? corrections : [
              { said: '我很头疼', better: '我头很疼' },
              { said: '我有发烧', better: '我发烧了' },
              { said: '我去看医院', better: '我去看病' },
            ]).slice(0, 5).map((c, i) => ({ prompt: 'Which is right?', options: i % 2 ? [c.said, c.better] : [c.better, c.said], answer: i % 2 ? 1 : 0, explanation: `Say: ${c.better}` })),
          },
          {
            kind: 'roleplay',
            title: 'Role-play: at the doctor’s',
            title_zh: '看病',
            why: "The last lesson's situation, with its new words",
            level: 'elementary',
            topic: 'Health',
            summary: 'A doctor and a patient — read your part, then swap.',
            role_names: { a: '医生 Doctor', b: '病人 Patient' },
            setting: 'A small clinic, morning.',
            speakers: { a: '医生', b: '病人' },
            lines: [
              { speaker: 'a', hanzi: '你哪儿不舒服？', pinyin: 'Nǐ nǎr bù shūfu?', english: 'What’s wrong?' },
              { speaker: 'b', hanzi: '我头疼，还有点儿发烧。', pinyin: 'Wǒ tóuténg, hái yǒudiǎnr fāshāo.', english: 'I have a headache and a bit of a fever.' },
              { speaker: 'a', hanzi: '多长时间了？', pinyin: 'Duō cháng shíjiān le?', english: 'For how long?' },
              { speaker: 'b', hanzi: '两天了。', pinyin: 'Liǎng tiān le.', english: 'Two days.' },
              { speaker: 'a', hanzi: '你感冒了，要多休息。', pinyin: 'Nǐ gǎnmào le, yào duō xiūxi.', english: 'You have a cold — rest a lot.' },
              { speaker: 'b', hanzi: '好的，谢谢医生。', pinyin: 'Hǎo de, xièxie yīshēng.', english: 'OK, thank you, doctor.' },
            ],
          },
          {
            kind: 'info_gap',
            title: 'Information gap: who is ill?',
            title_zh: '谁不舒服？',
            why: 'Asking about symptoms — 他怎么了？',
            level: 'elementary',
            topic: 'Health',
            summary: 'Each of you sees half the table — ask to fill the rest.',
            prompt: 'Ask: 小明星期一怎么了？',
            columns: ['小明', '小红'],
            rows: [
              { label: '星期一', cells: [{ value: '头疼', owner: 'a' }, { value: '发烧', owner: 'b' }] },
              { label: '星期二', cells: [{ value: '咳嗽', owner: 'b' }, { value: '感冒', owner: 'a' }] },
            ],
            choices: [
              { hanzi: '头疼', pinyin: 'tóuténg', english: 'headache' },
              { hanzi: '发烧', pinyin: 'fāshāo', english: 'fever' },
              { hanzi: '咳嗽', pinyin: 'késou', english: 'cough' },
              { hanzi: '感冒', pinyin: 'gǎnmào', english: 'a cold' },
              { hanzi: '牙疼', pinyin: 'yáténg', english: 'toothache' },
            ],
          },
        ];
        const activities = all.slice(0, Math.max(1, Math.min(count, all.length)));
        return {
          stop_reason: 'tool_use',
          usage: { input_tokens: 2000 + text.length, output_tokens: 400 * activities.length },
          content: [{ type: 'tool_use', id: 'fake', name: 'prepare_activities', input: { activities } }],
        };
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
}
