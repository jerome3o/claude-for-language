/**
 * E2E_TEST_MODE only (and the unit tests): a stand-in for Haiku in the lesson answer check
 * (services/answer-check.ts), so end-to-end tests and screenshots exercise the whole flow. It
 * knows Jerome's three real answers (docs/STUDY_SESSION.md "Claude checks your answer") and
 * answers the way the check_answer / reply tools would; anything else is "correct" when it equals
 * the model answer and "acceptable" otherwise.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { normalizeHanziAnswer } from '@shared/lesson/answer-check';

export const ANSWER_CHECK_FIXTURES: Array<{ answer: string; model: string; english: string; result: Record<string, unknown> }> = [
  {
    english: "Even if it's cheap, I won't buy it.",
    model: '即使很便宜，我也不买。',
    answer: '即使便宜，我也不买。',
    result: {
      verdict: 'correct',
      headline: 'Correct and natural — 很 is optional here.',
      corrected: '',
      tips: [{ text: '很 is optional inside a 即使 clause; 即使再便宜 ("however cheap") is an idiomatic way to stress it.', quote: '即使便宜' }],
      alternative: { hanzi: '即使再便宜，我也不买。', english: 'However cheap it is, I won\'t buy it.' },
    },
  },
  {
    english: "Even if you don't remember these words, don't worry — just practise more.",
    model: '即使你不记得这些词，也别着急，多练习就好了。',
    answer: '即使你不记得这些词，也不着急，就多练习。',
    result: {
      verdict: 'almost',
      headline: 'The 即使…也 is right — make "don\'t worry" a command.',
      corrected: '即使你不记得这些词，也别着急，你就多练习吧。',
      tips: [
        { text: '也不着急 is a statement ("you\'re also not anxious"); a command needs 别 or 不要 → 也别着急.', quote: '也不着急' },
        { text: 'Bare 就多练习 sounds clipped — add a subject and 吧: 你就多练习吧.', quote: '就多练习' },
      ],
      alternative: { hanzi: '多练习就好了。', english: 'Just practise more and it\'ll be fine.' },
    },
  },
  {
    english: 'The doctor told me to take medicine and rest well.',
    model: '医生让我吃药，好好休息。',
    answer: '医生让我吃药和好好休息。',
    result: {
      verdict: 'almost',
      headline: '和 can\'t join two actions — use a comma.',
      corrected: '医生让我吃药，好好休息。',
      tips: [{ text: '和 links nouns (药和水), not two verb phrases — use a comma, or 并且 / 然后.', quote: '和' }],
    },
  },
  {
    // A homework card's sentence said in Hard mode (docs/STUDY_SESSION.md "Sentence answers checked by Claude").
    english: "I drink coffee in the morning so I'm not sleepy at work.",
    model: '我早上喝咖啡是为了上班不困。',
    answer: '我早上喝咖啡，因为工作不困。',
    result: {
      verdict: 'almost',
      headline: 'Clear meaning — but 因为 gives a reason, not a purpose.',
      corrected: '我早上喝咖啡，是为了上班不困。',
      tips: [
        { text: 'Use 是为了 for "so that / in order to" — 因为 means "because".', quote: '因为' },
        { text: '上班 is being at work; 工作 is the job itself.', quote: '工作' },
      ],
      alternative: { hanzi: '我早上喝咖啡，这样上班就不困了。', english: "I drink coffee in the morning, so I'm not sleepy at work." },
    },
  },
  {
    // 他 for 她 (shared/lesson/heardCheck.ts): what the model says — right for a translate he READ, but in a
    // "Listen and translate" he only heard tā, so `forgiveUnheard` turns it into "correct".
    english: 'She blamed me.',
    model: '她责怪我。',
    answer: '他责怪我。',
    result: {
      verdict: 'almost',
      headline: 'Use 她, not 他.',
      corrected: '她责怪我。',
      tips: [{ text: '他 is "he"; 她 is "she".', quote: '他' }],
    },
  },
  {
    // The SELF-CONTRADICTORY check Jerome got (Nov 2026, v3), as the model returned it: the headline forbids "both" 块 and 钱
    // while the corrected line uses both, and the tip offers his own 块多元 as a fix. The coherence rules
    // (normalizeAnswerCheck) give a neutral headline and drop the tip; the "You said" marks read 3 as 三.
    english: 'This croissant was just over three yuan.',
    model: '这个牛角包三块多钱。',
    answer: '这个牛角包 3块多元。',
    result: {
      verdict: 'almost',
      headline: 'Use 钱 or 块 alone, not both together',
      corrected: '这个牛角包3块多钱',
      tips: [{ text: '3块多元: 块 and 元 are both money units; use 钱 instead (块多钱) or just 元 alone (块多元)', quote: '3块多元' }],
    },
  },
  {
    // The CONTRADICTORY check Jerome got (Nov 2026), word for word as the model returned it: it mixed up his answer
    // and the model answer, and its tip compares a text with itself. The sanity rules (normalizeAnswerCheck) drop the
    // tip and give the "but" headline a plain positive one — this fixture proves they do, end to end.
    english: "I can't sleep because of this problem.",
    model: '我因为这个问题睡不着觉。',
    answer: '因为这个问题，我睡不着觉。',
    result: {
      verdict: 'acceptable',
      headline: 'Correct meaning, but 因为 clause should come before the subject in formal style.',
      corrected: '',
      tips: [{
        text: '因为 (reason) typically comes before the subject, then the consequence. 因为这个问题 我睡不着觉 reads more naturally than 因为这个问题 我睡不着觉.',
        quote: '因为',
      }],
    },
  },
];

/**
 * Meaning checks the real model got wrong by ear (shared/lesson/heardCheck.ts): Jerome heard 她责怪我 ("She blamed me."),
 * said "He blames me." and got "≈ Nearly · Wrong subject" (Nov 2026). The fake answers the way the model did —
 * `forgiveUnheard` turns it into "correct" — and the way it answers what the ear CAN tell: roles swapped (I / you),
 * a negation added.
 */
export const MEANING_FIXTURES: Array<{ heard: string; respond: (said: string) => Record<string, unknown> | null }> = [
  {
    heard: '她责怪我。',
    respond: (said) => {
      const s = said.toLowerCase();
      if (/n't|(?<![a-z])(?:not|never)(?![a-z])/.test(s)) {
        return { verdict: 'almost', headline: 'Close — but it isn’t negative: she DID blame you.', corrected: '', tips: [] };
      }
      if (/^(?:i|you|we)(?![a-z])/.test(s)) {
        return { verdict: 'wrong', headline: 'Reversed — she blamed you, not you her.', corrected: '', tips: [{ text: '我 is the one being blamed.', quote: '我' }] };
      }
      if (/^(?:he|it)(?![a-z])/.test(s)) {
        return {
          verdict: 'almost',
          headline: 'Wrong subject: "he" instead of "she"',
          corrected: '',
          tips: [{ text: '她 (tā) means "she"; 他 (tā) is "he" — same sound, different character.', quote: '她' }],
        };
      }
      if (/^she (?:blames|is blaming|will blame)/.test(s)) {
        return { verdict: 'almost', headline: 'Tense: "blamed", not "blames"', corrected: '', tips: [] };
      }
      return null;
    },
  },
];

/** A read card's take checked by Claude (shared/study/readTakeCheck.ts): Jerome's real 英语 / 英文 reading. */
export const READ_ALOUD_FIXTURES: Array<{ card: string; said: string; result: Record<string, unknown> }> = [
  {
    card: '我越学中文，越觉得英文很繁琐。',
    said: '我越学中文，越觉得英语很繁琐。',
    result: {
      verdict: 'almost',
      headline: 'You said 英语 — the card has 英文 (same meaning).',
      corrected: '',
      tips: [{ text: '英文 is English as a subject or written language; 英语 is the same in speech.', quote: '英文' }],
    },
  },
];

/**
 * A word order (scramble) built in an order the lesson didn't list (shared/lesson/scrambleCheck.ts). The rule: the
 * expected order's FIRST tile (its subject) moved later, landing right before 就 / 也 / 都 / 才 / 还 / 又, is right
 * (Jerome's 一看见蛋糕孩子就高兴起来了 — the subject only in the second clause of 一…就); any other order is wrong.
 */
export function fakeScrambleCheck(expectedTiles: string[], learnerTiles: string[]): Record<string, unknown> {
  const [subject, ...rest] = expectedTiles;
  const at = learnerTiles.indexOf(subject);
  const without = learnerTiles.filter((_, i) => i !== at);
  const movedSubject = at > 0 && without.join('|') === rest.join('|') && /^[就也都才还又]/.test(learnerTiles[at + 1] ?? '');
  return movedSubject
    ? { verdict: 'correct', headline: `Also natural — ${subject} can come later, right before ${learnerTiles[at + 1].slice(0, 1)}.`, corrected: '', tips: [] }
    : { verdict: 'wrong', headline: `That order doesn't read naturally — start with ${subject}.`, corrected: '', tips: [] };
}

/** Jerome's "Annie" speaking task (docs/STUDY_SESSION.md "Claude checks your speaking"): a realistic transcript. */
export const SPEAKING_FIXTURE = {
  prompt: "A new colleague, Annie, arrives at your office. Guess who she is (① 就是…吧), tell her where two places are (② 就在), what today's meeting is about (③ 是关于…的), and how busy the team is (④ 形容词 + 到…).",
  transcript: '嗯，你好，你就是……sorry，你就是新来的Annie吧？欢迎欢迎！洗手间在……wait，洗手间就在电梯的旁边，打印机就在我的办公桌后面。今天的会议是关于下个月的活动。我们团队最近忙到……忙到没有时间吃午饭了。',
  result: {
    verdict: 'acceptable',
    headline: 'All four parts are there — just close 是关于…的 with 的.',
    cleaned: '你好，你就是新来的Annie吧？欢迎欢迎！洗手间就在电梯的旁边，打印机就在我的办公桌后面。今天的会议是关于下个月的活动。我们团队最近忙到没有时间吃午饭了。',
    corrected: '你好，你就是新来的Annie吧？欢迎欢迎！洗手间就在电梯旁边，打印机就在我的办公桌后面。今天的会议是关于下个月的活动的。我们团队最近忙到没有时间吃午饭了。',
    parts: [
      { label: '① 就是…吧', status: 'used', note: '你就是新来的Annie吧 — a perfect friendly guess.' },
      { label: '② 就在', status: 'used', note: 'Two places: 洗手间就在… and 打印机就在….' },
      { label: '③ 是关于…的', status: 'used_with_issue', note: 'The closing 的 is missing.' },
      { label: '④ 形容词 + 到…', status: 'used', note: '忙到没有时间吃午饭 — great use.' },
    ],
    tips: [
      { text: '是关于…的 needs its closing 的: 是关于下个月的活动的 (shì guānyú xià ge yuè de huódòng de).', quote: '是关于下个月的活动', fix: '是关于下个月的活动的' },
      { text: 'With 旁边 the 的 is usually dropped: 电梯旁边 (diàntī pángbiān) sounds more natural.', quote: '电梯的旁边', fix: '电梯旁边' },
    ],
  },
};

function lineValue(text: string, label: RegExp): string {
  const m = text.match(label);
  return m ? m[1].trim() : '';
}

/** A fake Anthropic client for the check_answer and reply tools. */
/** "Which is wrong?" choices the E2E specs and screenshots use (services/choice-correction.ts). */
export const CHOICE_CORRECTION_FIXTURES: Array<{ wrong: string; fixed: string; english: string }> = [
  { wrong: '他了去北京。', fixed: '他去北京了。', english: 'He went to Beijing.' },
  { wrong: '我昨天了买一本书。', fixed: '我昨天买了一本书。', english: 'I bought a book yesterday.' },
];

export function fakeAnswerCheckClient(): Pick<Anthropic, 'messages'> {
  return {
    messages: {
      create: async (params: { messages: Array<{ content: unknown }>; tool_choice?: { name?: string } }) => {
        const text = String(params.messages[0]?.content ?? '');
        if (params.tool_choice?.name === 'reply') {
          return {
            stop_reason: 'tool_use',
            usage: { input_tokens: 300 + text.length, output_tokens: 40 },
            content: [{ type: 'tool_use', id: 'fake', name: 'reply', input: { text: '别 makes it a command ("don\'t…"); 不 only describes. So 也别着急 tells them not to worry, while 也不着急 says they aren\'t worried.' } }],
          };
        }
        if (params.tool_choice?.name === 'give_correction') {
          // A "which is wrong?" choice's correction (services/choice-correction.ts).
          const wrong = lineValue(text, /<wrong>([^<]+)<\/wrong>/);
          const fixture = CHOICE_CORRECTION_FIXTURES.find((f) => normalizeHanziAnswer(f.wrong) === normalizeHanziAnswer(wrong));
          const fixed = fixture?.fixed ?? wrong.replace('了', '');
          const input = fixed === wrong
            ? { hanzi: wrong, english: '', already_correct: true }
            : { hanzi: fixed, english: fixture?.english ?? '', already_correct: false };
          return {
            stop_reason: 'tool_use',
            usage: { input_tokens: 200 + text.length, output_tokens: 30 },
            content: [{ type: 'tool_use', id: 'fake', name: 'give_correction', input }],
          };
        }
        if (params.tool_choice?.name === 'check_speaking') {
          const said = lineValue(text, /Transcript of their recording[^:]*: (.+)/);
          const known = normalizeHanziAnswer(said) === normalizeHanziAnswer(SPEAKING_FIXTURE.transcript);
          const result = known ? SPEAKING_FIXTURE.result : {
            verdict: 'acceptable',
            headline: 'Clear and on task — nicely done.',
            cleaned: said.replace(/(sorry|wait|嗯)[，,]?/gi, ''),
            corrected: '',
            parts: [],
            tips: [],
          };
          return {
            stop_reason: 'tool_use',
            usage: { input_tokens: 900 + text.length, output_tokens: 400 },
            content: [{ type: 'tool_use', id: 'fake', name: 'check_speaking', input: result }],
          };
        }
        if (text.includes('(what they READ ALOUD)')) {
          // A read card's take (shared/study/readTakeCheck.ts): Jerome's 英语 / 英文 reading → almost with the reason;
          // the card read with only recogniser slips → correct; most characters there → almost; else wrong.
          const card = lineValue(text, /The card's Chinese \(what they READ ALOUD\): ([^(\n]+)/);
          const said = lineValue(text, /Transcript of their reading[^:]*\): (.+)/);
          const fixture = READ_ALOUD_FIXTURES.find((f) => normalizeHanziAnswer(f.card) === normalizeHanziAnswer(card) && normalizeHanziAnswer(f.said) === normalizeHanziAnswer(said));
          const cardChars = [...normalizeHanziAnswer(card)];
          const saidChars = new Set(normalizeHanziAnswer(said));
          const share = cardChars.length ? cardChars.filter((ch) => saidChars.has(ch)).length / cardChars.length : 0;
          const result = fixture?.result ?? (normalizeHanziAnswer(said) === normalizeHanziAnswer(card)
            ? { verdict: 'correct', headline: 'Read right — the recogniser just wrote it differently.', corrected: '', tips: [] }
            : share >= 0.7
              ? { verdict: 'almost', headline: 'Nearly — one word came out differently.', corrected: '', tips: [] }
              : { verdict: 'wrong', headline: 'That isn’t what the card says.', corrected: '', tips: [{ text: 'Read it again slowly, word by word.', quote: card.slice(0, 2) }] });
          return {
            stop_reason: 'tool_use',
            usage: { input_tokens: 350 + text.length, output_tokens: 50 },
            content: [{ type: 'tool_use', id: 'fake', name: 'check_answer', input: result }],
          };
        }
        if (text.includes('<learner_order>')) {
          const tiles = (label: RegExp) => lineValue(text, label).split('/').map((t) => t.trim()).filter(Boolean);
          const result = fakeScrambleCheck(tiles(/Expected order tiles: (.+)/), tiles(/Learner order tiles: (.+)/));
          return {
            stop_reason: 'tool_use',
            usage: { input_tokens: 450 + text.length, output_tokens: 50 },
            content: [{ type: 'tool_use', id: 'fake', name: 'check_answer', input: result }],
          };
        }
        if (text.includes('Chinese sentence they heard:')) {
          // A meaning check (Sentences by ear): most of the reference's words = understood; a missed 没 / 不 = almost.
          const heard = lineValue(text, /Chinese sentence they heard: ([^(\n]+)/);
          const reference = lineValue(text, /Reference English: (.+)/);
          const said = lineValue(text, /What they said it means[^:]*: (.+)/);
          const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2);
          const ref = new Set(words(reference));
          const got = words(said).filter((w) => ref.has(w)).length;
          const negated = /[没不别]/.test(heard) && !/\b(not|no|never|didn't|don't|doesn't|isn't|wasn't|won't|can't)\b|n't/i.test(said);
          const share = ref.size ? got / ref.size : 0;
          const known = MEANING_FIXTURES.find((f) => normalizeHanziAnswer(f.heard) === normalizeHanziAnswer(heard))?.respond(said);
          const result = known ?? (negated && share >= 0.4
            ? { verdict: 'almost', headline: 'Close — but you missed the negative.', corrected: '', tips: [{ text: `${heard.match(/[没不别]/)![0]} makes it negative.`, quote: heard.match(/[没不别]/)![0] }] }
            : share >= 0.6
              ? { verdict: 'correct', headline: 'You understood it.', corrected: '', tips: [] }
              : share >= 0.3
                ? { verdict: 'acceptable', headline: 'You got the gist.', corrected: '', tips: [] }
                : { verdict: 'wrong', headline: 'Listen again with the text in front of you.', corrected: '', tips: [] });
          return {
            stop_reason: 'tool_use',
            usage: { input_tokens: 400 + text.length, output_tokens: 60 },
            content: [{ type: 'tool_use', id: 'fake', name: 'check_answer', input: result }],
          };
        }
        const answer = lineValue(text, /<learner_answer>([^<]*)<\/learner_answer>/);
        const model = lineValue(text, /<model_answer>([^<]*)<\/model_answer>/);
        const known = ANSWER_CHECK_FIXTURES.find((f) => normalizeHanziAnswer(f.answer) === normalizeHanziAnswer(answer));
        const result = known?.result ?? (normalizeHanziAnswer(answer) === normalizeHanziAnswer(model)
          ? { verdict: 'correct', headline: 'Correct — exactly the model answer.', corrected: '', tips: [] }
          : { verdict: 'acceptable', headline: 'Different wording, same meaning — that works.', corrected: '', tips: [] });
        return {
          stop_reason: 'tool_use',
          usage: { input_tokens: 600 + text.length, output_tokens: 120 },
          content: [{ type: 'tool_use', id: 'fake', name: 'check_answer', input: result }],
        };
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
}
