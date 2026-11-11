import { describe, it, expect } from 'vitest';
import {
  roundSentences, pickRoundExercises, sentenceRoundOpens, sentenceRoundProgress, sentenceRoundCounter,
  sentenceRoundIntro, sentenceRoundCheer, roundRowMarks, orderKeysForRound, exercisesFromLog, roundEnglishShown, type RoundSentence,
  pickListenRoundExercises, listenRoundSentenceCount, listenRoundIntro, canListenTo, listenActiveId, exerciseAsRead, listenCheckBy,
  listenCheckInput, listenVerdictResult, listenSelfResult, parseSentencesByEar, SENTENCE_ROUND_PROMPT,
  SENTENCE_ROUND_SKIP, SENTENCE_ROUND_SKIP_CONFIRM, SENTENCE_ROUND_SKIP_CONFIRM_YES, SENTENCE_ROUND_SKIP_CONFIRM_NO,
  isCardHanziSentence, roundSentenceCount,
} from './sentenceRound';
import { sentenceGate } from './sentencePractise';
import { sentenceStats, wantsMoreSentences, type SentencePracticeEvent } from './sentenceHistory';

const s = (key: string, translation: string | null = `${key} en`): RoundSentence => ({ key, hanzi: `${key}汉字`, translation });
const brief = (ex: ReturnType<typeof pickRoundExercises>) => ex.map((e) => e.id);

describe('roundSentences', () => {
  it('puts the card sentence first unless the set has it', () => {
    const set = [s('a'), s('b')];
    expect(roundSentences({ clue: { key: 'clue:n', hanzi: '我去银行。', translation: null }, set }).map((r) => r.key)).toEqual(['clue:n', 'a', 'b']);
    expect(roundSentences({ clue: { key: 'clue:n', hanzi: 'a汉字', translation: null }, set }).map((r) => r.key)).toEqual(['a', 'b']);
    expect(roundSentences({ clue: null, set: [] })).toEqual([]);
    expect(roundSentences({ clue: { key: 'clue:n', hanzi: '  ', translation: 'x' }, set: [] })).toEqual([]);
  });
});

describe('pickRoundExercises', () => {
  it('spreads four different sentences easiest → hardest, read / translate alternating', () => {
    expect(brief(pickRoundExercises([s('a'), s('b'), s('c'), s('d')]))).toEqual(['read:a', 'translate:b', 'read:c', 'translate:d']);
    expect(brief(pickRoundExercises(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k) => s(k))))).toEqual(['read:a', 'translate:c', 'read:e', 'translate:g']);
  });
  it('a translate sentence without English swaps with the nearest read that has one', () => {
    expect(brief(pickRoundExercises([s('a'), s('b', null), s('c'), s('d')]))).toEqual(['read:a', 'read:b', 'translate:c', 'translate:d']);
    // The clue (no English) leads and is read.
    expect(brief(pickRoundExercises([s('clue', null), s('b'), s('c'), s('d')]))).toEqual(['read:clue', 'translate:b', 'read:c', 'translate:d']);
    // No English anywhere: four reads.
    expect(brief(pickRoundExercises(['a', 'b', 'c', 'd'].map((k) => s(k, null))))).toEqual(['read:a', 'read:b', 'read:c', 'read:d']);
  });
  it('a sentence is in at most one exercise: fewer sentences, fewer exercises', () => {
    expect(brief(pickRoundExercises([s('a'), s('b'), s('c')]))).toEqual(['read:a', 'translate:b', 'read:c']);
    expect(brief(pickRoundExercises([s('a'), s('b')]))).toEqual(['read:a', 'translate:b']);
    expect(brief(pickRoundExercises([s('a')]))).toEqual(['read:a']);
    expect(brief(pickRoundExercises([s('a', null)]))).toEqual(['read:a']);
    expect(pickRoundExercises([])).toEqual([]);
    for (let n = 1; n <= 8; n++) {
      const ex = pickRoundExercises(Array.from({ length: n }, (_, i) => s(`k${i}`, i % 3 === 0 ? null : 'x')));
      expect(new Set(ex.map((e) => e.key)).size).toBe(ex.length);
      expect(ex.length).toBe(Math.min(4, n));
    }
  });
  it('two sentences, one with English: one per mode (the one with English is translated)', () => {
    expect(brief(pickRoundExercises([s('a'), s('b', null)]))).toEqual(['translate:a', 'read:b']);
    expect(brief(pickRoundExercises([s('clue', null), s('b')]))).toEqual(['read:clue', 'translate:b']);
    expect(brief(pickRoundExercises([s('a', null), s('b', null)]))).toEqual(['read:a', 'read:b']);
  });
  it('needs min(2, exercises) right; fewer than four visible asks for more (few)', () => {
    expect(sentenceRoundProgress(pickRoundExercises([s('a'), s('b'), s('c')]), [])).toEqual({ needed: 2, got: 0, done: false });
    expect(sentenceRoundProgress(pickRoundExercises([s('a'), s('b')]), ['read:a'])).toEqual({ needed: 2, got: 1, done: false });
    expect(sentenceRoundProgress(pickRoundExercises([s('a')]), ['read:a'])).toEqual({ needed: 1, got: 1, done: true });
    expect(wantsMoreSentences([s('a'), s('b'), s('c')], new Map())).toBe(true);
    expect(wantsMoreSentences(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => s(k)), new Map())).toBe(false);
  });
});

describe('progress + the gate', () => {
  const ex = pickRoundExercises([s('a'), s('b'), s('c'), s('d')]);
  it('any two right; ids outside the round never count', () => {
    expect(sentenceRoundProgress(ex, [])).toEqual({ needed: 2, got: 0, done: false });
    expect(sentenceRoundProgress(ex, ['translate:d', 'translate:d', 'read:zzz'])).toEqual({ needed: 2, got: 1, done: false });
    expect(sentenceRoundProgress(ex, ['read:c', 'translate:b'])).toEqual({ needed: 2, got: 2, done: true });
  });
  it('one sentence needs one', () => {
    expect(sentenceRoundProgress(pickRoundExercises([s('a')]), ['read:a'])).toEqual({ needed: 1, got: 1, done: true });
  });
  it('the round right ids unlock the answer side gate', () => {
    expect(sentenceGate({ enabled: true, cardType: 'meaning_to_hanzi', sentenceCount: 4, rightKeys: ['read:a', 'translate:b'] }).locked).toBe(false);
  });
  it('opens on the gated card types only, not when there are no sentences', () => {
    expect(sentenceRoundOpens({ enabled: true, cardType: 'hanzi_to_meaning', sentenceCount: null })).toBe(true);
    expect(sentenceRoundOpens({ enabled: true, cardType: 'meaning_to_hanzi', sentenceCount: 0 })).toBe(false);
    expect(sentenceRoundOpens({ enabled: true, cardType: 'audio_to_hanzi', sentenceCount: 3 })).toBe(true);
    expect(sentenceRoundOpens({ enabled: true, cardType: 'other', sentenceCount: 3 })).toBe(false);
    expect(sentenceRoundOpens({ enabled: false, cardType: 'hanzi_to_meaning', sentenceCount: 3 })).toBe(false);
  });
  it('words', () => {
    const p = sentenceRoundProgress(ex, ['read:a']);
    expect(sentenceRoundCounter(p)).toBe('1 / 2');
    expect(sentenceRoundIntro(p, 4)).toBe('Get any 2 of these 4 right');
    expect(sentenceRoundCheer(p)).toBe('🎉 Nice — 1 / 2');
    expect(sentenceRoundCheer(sentenceRoundProgress(ex, ['read:a', 'read:c']))).toBe('🎉 2 / 2 — Good and Easy unlocked');
    expect(sentenceRoundIntro({ needed: 1, got: 0, done: false }, 1)).toBe('Get this one right');
    // Skip is quiet and asks first (no line under it explaining the gate).
    expect(SENTENCE_ROUND_SKIP).toBe('Skip to the answer');
    expect([SENTENCE_ROUND_SKIP_CONFIRM, SENTENCE_ROUND_SKIP_CONFIRM_YES, SENTENCE_ROUND_SKIP_CONFIRM_NO]).toEqual(['Skip this exercise?', 'Skip', 'Keep going']);
  });
});

describe('the round on the answer side', () => {
  it('marks the round sentences in order, right sticking, skipped ones untried', () => {
    const marks = roundRowMarks(
      [{ id: 'read:a', result: 'wrong' }, { id: 'translate:b', result: 'close' }, { id: 'read:c' }, { id: 'translate:d', result: 'right' }],
      ['read:a'],
    );
    expect(marks.map((m) => [m.key, m.outcome, m.label])).toEqual([
      ['a', 'right', 'In the round · ✓ Right'],
      ['b', 'close', 'In the round · ≈ Nearly'],
      ['c', 'untried', 'In the round'],
      ['d', 'right', 'In the round · ✓ Right'],
    ]);
    expect(roundRowMarks([{ id: 'bogus' }, { id: 'read:clue:n1', result: 'wrong' }], [])[0]).toMatchObject({ key: 'clue:n1', outcome: 'wrong', label: 'In the round · ✗ Not quite' });
  });
  it('puts them at the top in the round order', () => {
    const marks = roundRowMarks([{ id: 'read:c' }, { id: 'translate:a' }, { id: 'read:zzz' }], []);
    expect(orderKeysForRound(['a', 'b', 'c', 'd'], marks)).toEqual(['c', 'a', 'b', 'd']);
  });
  it('brings the same exercises back from the log', () => {
    const list = [s('a'), s('b'), s('c')];
    expect(exercisesFromLog(list, ['translate:c', 'read:a', 'read:zzz'])?.map((e) => e.id)).toEqual(['read:a', 'translate:c']);
    expect(exercisesFromLog(list, ['read:a'], (k) => k === 'a')).toBeNull();
    expect(exercisesFromLog(list, [])).toBeNull();
  });
});

describe('roundEnglishShown', () => {
  it('hides a read exercise\'s English until it is judged — right, nearly or not quite — and EN toggles it', () => {
    expect(roundEnglishShown('read', null, false, null)).toBe(false);
    expect(roundEnglishShown('read', null, false, true)).toBe(true); // EN before answering
    expect(roundEnglishShown('read', 'right', true, null)).toBe(true);
    expect(roundEnglishShown('read', 'right', true, false)).toBe(false); // EN hides it again
    expect(roundEnglishShown('read', 'close', true, null)).toBe(true);
    expect(roundEnglishShown('read', 'wrong', true, null)).toBe(true);
    expect(roundEnglishShown('read', 'wrong', true, false)).toBe(false);
    expect(roundEnglishShown('read', null, true, null)).toBe(false); // still being checked
  });
  it('a translate exercise\'s English is its question', () => {
    expect(roundEnglishShown('translate', null, false, null)).toBe(true);
  });
});

describe("the listening card's round: say it in Chinese", () => {
  const list: RoundSentence[] = [
    { key: 'clue:n1', hanzi: '我去银行。', translation: 'I go to the bank.' },
    { key: 's1', hanzi: '银行几点开门？', translation: 'When does the bank open?' },
    { key: 's2', hanzi: '他在 银行 工作。', translation: 'He works at a bank.' },
    { key: 's3', hanzi: '我们去吃饭吧。', translation: 'Let’s eat.' },
    { key: 's4', hanzi: '银行旁边有饭馆。', translation: null },
    { key: 's5', hanzi: '你知道附近有银行吗？', translation: 'Is there a bank nearby?' },
  ];
  it('English sentences that carry the word, the card sentence first, at most three, all translate', () => {
    const ex = pickListenRoundExercises(list, '银行');
    expect(brief(ex)).toEqual(['translate:clue:n1', 'translate:s1', 'translate:s2']);
    expect(ex.every((e) => e.mode === 'translate')).toBe(true);
    expect(listenRoundSentenceCount(list, '银行')).toBe(4); // s3 lacks the word, s4 lacks English
  });
  it('least practised first, shown easiest → harder; hidden ones never', () => {
    const at = '2026-10-02T00:00:00.000Z';
    const events: SentencePracticeEvent[] = [
      { id: 'e1', note_id: 'n1', sentence_key: 'clue', kind: 'attempt', mode: 'translate', result: 'right', at },
      { id: 'e2', note_id: 'n1', sentence_key: 's1', kind: 'attempt', mode: 'translate', result: 'right', at },
      { id: 'e3', note_id: 'n1', sentence_key: 's2', kind: 'hide', reason: 'weird', at },
    ];
    const stats = sentenceStats(events, 'n1');
    expect(brief(pickListenRoundExercises(list, '银行', stats))).toEqual(['translate:clue:n1', 'translate:s1', 'translate:s5']);
    expect(listenRoundSentenceCount(list, '银行', stats)).toBe(3);
  });
  it('no English sentences with the word: no round', () => {
    expect(pickListenRoundExercises([list[3], list[4]], '银行')).toEqual([]);
  });
  it('words', () => {
    expect(listenRoundIntro({ needed: 2, got: 0, done: false }, 3)).toBe('You heard it — now say these in Chinese. Get any 2 of these 3 right');
  });
});

describe('Sentences by ear (listen exercises in the read slots)', () => {
  const heard = (key: string, translation: string | null = `${key} en`, audio = true): RoundSentence => ({ key, hanzi: `${key}汉字`, translation, audio });
  const ear = { byEar: true, online: true };

  it('a read slot is a listen exercise when its sentence can be heard; translate slots stay', () => {
    expect(brief(pickRoundExercises([heard('a'), heard('b'), heard('c'), heard('d')], undefined, ear))).toEqual(['listen:a', 'translate:b', 'listen:c', 'translate:d']);
    // Off: today's read / translate.
    expect(brief(pickRoundExercises([heard('a'), heard('b'), heard('c'), heard('d')], undefined, { byEar: false, online: true }))).toEqual(['read:a', 'translate:b', 'read:c', 'translate:d']);
    expect(brief(pickRoundExercises([heard('a'), heard('b'), heard('c'), heard('d')]))).toEqual(['read:a', 'translate:b', 'read:c', 'translate:d']);
  });

  it('prefers a sentence with a clip for the read slot; one with no clip keeps read', () => {
    expect(brief(pickRoundExercises([heard('a', 'a en', false), heard('b'), heard('c'), heard('d')], undefined, ear))).toEqual(['translate:a', 'listen:b', 'listen:c', 'translate:d']);
    expect(brief(pickRoundExercises(['a', 'b', 'c', 'd'].map((k) => heard(k, `${k} en`, false)), undefined, ear))).toEqual(['read:a', 'translate:b', 'read:c', 'translate:d']);
  });

  it('online it needs English to check against; offline he checks himself, so a clip is enough', () => {
    expect(brief(pickRoundExercises([heard('a', null)], undefined, ear))).toEqual(['read:a']);
    expect(brief(pickRoundExercises([heard('a', null)], undefined, { byEar: true, online: false }))).toEqual(['listen:a']);
    expect(canListenTo({ translation: '', audio: true }, { byEar: true, online: false })).toBe(true);
    expect(canListenTo({ translation: 'x', audio: false }, ear)).toBe(false);
    expect(canListenTo({ translation: 'x', audio: true }, undefined)).toBe(false);
  });

  it('fresh first, then the one he understands least by ear', () => {
    const at = (m: number) => `2026-11-0${m}T08:00:00.000Z`;
    const ev = (id: string, key: string, mode: 'read' | 'listen', result: 'right' | 'wrong', d: number): SentencePracticeEvent =>
      ({ id, note_id: 'n', sentence_key: key, kind: 'attempt', mode, result, at: at(d) });
    const events = [
      ...['a', 'b', 'c', 'd'].map((k, i) => ev(`r${k}`, k, 'read', 'right', 1 + i)),
      ev('la1', 'a', 'listen', 'right', 5), ev('la2', 'a', 'listen', 'right', 6), ev('lc1', 'c', 'listen', 'right', 7),
    ];
    const stats = sentenceStats(events, 'n');
    expect(brief(pickRoundExercises(['a', 'b', 'c', 'd'].map((k) => heard(k)), stats, ear))).toEqual(['translate:a', 'listen:b', 'translate:c', 'listen:d']);
    // A fresh sentence still comes first.
    expect(brief(pickRoundExercises([...['a', 'b', 'c', 'd'].map((k) => heard(k)), heard('e')], stats, ear))[0]).toBe('translate:a');
    expect(pickRoundExercises([...['a', 'b', 'c', 'd'].map((k) => heard(k)), heard('e')], stats, ear).some((e) => e.id === 'listen:e')).toBe(true);
  });

  it('counts, resumes and marks listen exercises like the others', () => {
    const exs = pickRoundExercises([heard('a'), heard('b')], undefined, ear);
    expect(brief(exs)).toEqual(['listen:a', 'translate:b']);
    expect(sentenceRoundProgress(exs, ['listen:a', 'translate:b'])).toEqual({ needed: 2, got: 2, done: true });
    expect(sentenceRoundProgress(exs, ['listen:c'], ['a', 'b', 'c']).got).toBe(1);
    expect(exercisesFromLog([heard('a'), heard('b')], ['listen:b'])).toEqual([{ id: 'listen:b', key: 'b', mode: 'listen', index: 1 }]);
    expect(roundRowMarks([{ id: 'listen:a', result: 'close' }], [])).toEqual([{ key: 'a', mode: 'listen', outcome: 'close', label: 'In the round · ≈ Nearly' }]);
    expect(roundEnglishShown('listen', null, false, true)).toBe(false);
    expect(roundEnglishShown('listen', 'wrong', true, null)).toBe(true);
    expect(SENTENCE_ROUND_PROMPT.listen).toBe('👂 What does it mean?');
  });

  it('the exercise with the floor: chosen while unanswered, else the first unanswered listen one', () => {
    const exs = pickRoundExercises([heard('a'), heard('b'), heard('c'), heard('d')], undefined, ear);
    expect(listenActiveId(exs, [])).toBe('listen:a');
    expect(listenActiveId(exs, ['listen:a'])).toBe('listen:c');
    expect(listenActiveId(exs, [], 'listen:c')).toBe('listen:c');
    expect(listenActiveId(exs, ['listen:c'], 'listen:c')).toBe('listen:a');
    expect(listenActiveId(exs, [], 'translate:b')).toBe('listen:a');
    expect(listenActiveId(exs, ['listen:a', 'listen:c'])).toBeNull();
    expect(exerciseAsRead(exs[0])).toEqual({ id: 'read:a', key: 'a', mode: 'read', index: 0 });
    expect(exerciseAsRead(exs[1])).toBe(exs[1]);
  });

  it('checks: Claude online with English, else himself; the meaning check input; verdict → result', () => {
    expect(listenCheckBy(true, 'x')).toBe('claude');
    expect(listenCheckBy(true, '  ')).toBe('self');
    expect(listenCheckBy(false, 'x')).toBe('self');
    expect(listenCheckInput({ hanzi: ' 我去银行。', pinyin: 'Wǒ qù yínháng.', translation: 'I go to the bank. ' }, ' I go to the bank ', 'spoken')).toEqual({
      prompt_en: '我去银行。', model_answer: 'I go to the bank.', model_pinyin: 'Wǒ qù yínháng.', answer: 'I go to the bank', exercise_type: 'listen_translate', input: 'spoken',
    });
    expect(listenCheckInput({ hanzi: '好', translation: 'Good' }, 'good', 'typed').model_pinyin).toBeUndefined();
    expect(['correct', 'acceptable', 'almost', 'wrong'].map((v) => listenVerdictResult(v as 'correct'))).toEqual(['right', 'right', 'close', 'wrong']);
    expect([listenSelfResult(true), listenSelfResult(false)]).toEqual(['right', 'wrong']);
  });

  it('the setting: on unless switched off', () => {
    expect([null, undefined, '', '1', 'true', '0', 'false', 'x'].map((v) => parseSentencesByEar(v))).toEqual([true, true, true, true, true, false, false, true]);
  });
});

describe("the card's own sentence never comes in the round", () => {
  const card = '你和你妈妈除了聊这个，还聊什么了？';
  const list: RoundSentence[] = [
    { key: 'clue:n1', hanzi: card, translation: 'Apart from this, what else did you and your mum talk about?' },
    { key: 's1', hanzi: '你们还聊什么了？', translation: 'What else did you talk about?' },
    { key: 's2', hanzi: '除了中文，他还会说日语。', translation: 'Besides Chinese, he also speaks Japanese.' },
    { key: 's3', hanzi: '我和妈妈聊了很久。', translation: 'Mum and I chatted for a long time.' },
    { key: 's4', hanzi: '除了这个，你还想要什么？', translation: 'What else do you want besides this?' },
  ];
  it('isCardHanziSentence: punctuation, spaces and case aside; empty never matches', () => {
    expect(isCardHanziSentence(card, card)).toBe(true);
    expect(isCardHanziSentence('你和你妈妈除了聊这个 还聊什么了', card)).toBe(true);
    expect(isCardHanziSentence('「你和你妈妈除了聊这个,还聊什么了?」', card)).toBe(true);
    expect(isCardHanziSentence('你和你妈妈除了聊这个，还聊什么了吗？', card)).toBe(false);
    expect(isCardHanziSentence('Wi-Fi 密码是多少？', 'wifi密码是多少')).toBe(true);
    expect(isCardHanziSentence('银行', '')).toBe(false);
    expect(isCardHanziSentence('', '')).toBe(false);
    expect(isCardHanziSentence('。', '？')).toBe(false);
    expect(isCardHanziSentence('银行', null)).toBe(false);
  });
  it('pickRoundExercises leaves it out (row 1 was "Read it aloud" of the question itself)', () => {
    expect(brief(pickRoundExercises(list))[0]).toBe('read:clue:n1');
    const ex = pickRoundExercises(list, undefined, { cardHanzi: card });
    expect(ex.map((e) => e.key)).not.toContain('clue:n1');
    expect(brief(ex)).toEqual(['read:s1', 'translate:s2', 'read:s3', 'translate:s4']);
    // the index is still the sentence's place in the card's list
    expect(ex.map((e) => e.index)).toEqual([1, 2, 3, 4]);
    // a word card is unaffected
    expect(brief(pickRoundExercises(list, undefined, { cardHanzi: '妈妈' }))).toEqual(brief(pickRoundExercises(list)));
  });
  it('fewer sentences: fewer exercises; only the card itself → no round', () => {
    expect(brief(pickRoundExercises(list.slice(0, 2), undefined, { cardHanzi: card }))).toEqual(['read:s1']);
    expect(pickRoundExercises(list.slice(0, 1), undefined, { cardHanzi: card })).toEqual([]);
    expect(roundSentenceCount(list.slice(0, 1), undefined, card)).toBe(0);
    expect(sentenceRoundOpens({ enabled: true, cardType: 'hanzi_to_meaning', sentenceCount: roundSentenceCount(list.slice(0, 1), undefined, card) })).toBe(false);
  });
  it('roundSentenceCount: not hidden, not the card itself', () => {
    expect(roundSentenceCount(list)).toBe(5);
    expect(roundSentenceCount(list, undefined, card)).toBe(4);
    const stats = sentenceStats([{ id: 'h', note_id: 'n1', sentence_key: 's2', kind: 'hide', reason: 'weird', at: '2026-10-02T00:00:00.000Z' }], 'n1');
    expect(roundSentenceCount(list, stats, card)).toBe(3);
  });
  it('the listening card: the sentence it read out is not one to say back', () => {
    expect(listenRoundCandidatesKeys(card)).not.toContain('clue:n1');
    expect(listenRoundSentenceCount(list, card)).toBe(0);
    expect(pickListenRoundExercises(list, card)).toEqual([]);
    // a word: its card sentence still comes
    expect(brief(pickListenRoundExercises(list, '还'))[0]).toBe('translate:clue:n1');
  });
  function listenRoundCandidatesKeys(word: string) {
    return pickListenRoundExercises(list, word).map((e) => e.key);
  }
});
