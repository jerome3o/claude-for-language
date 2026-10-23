import { describe, it, expect } from 'vitest';
import {
  answerCheckApplies, answerCheckCacheText, answerCheckChip, exactAnswerCheck, normalizeAnswerCheck, parseAnswerCheck, pickAnswerCheckInput,
  suggestedFor, tipSegments, EXACT_ANSWER_HEADLINE,
} from './answerCheck';
import { isExactHanziMatch } from './answer-check';
import { sanitizeAttemptData } from './attempt';

describe('answerCheckApplies', () => {
  it('only Chinese answers to translate / listen_translate', () => {
    expect(answerCheckApplies('translate', '即使便宜，我也不买。')).toBe(true);
    expect(answerCheckApplies('listen_translate', '我也不买')).toBe(true);
    expect(answerCheckApplies('listen_translate', "I won't buy it")).toBe(false);
    expect(answerCheckApplies('translate', '  ')).toBe(false);
    expect(answerCheckApplies('translate', null)).toBe(false);
    expect(answerCheckApplies('sentence_making', '我也不买')).toBe(false);
    expect(answerCheckApplies('dictation', '我也不买')).toBe(false);
  });
});

describe('answerCheckCacheText', () => {
  const base = { prompt_en: "Even if it's cheap,  I won't buy it.", model_answer: '即使很便宜，我也不买。', answer: '即使便宜，我也不买。', exercise_type: 'translate' };
  it('ignores punctuation / spacing of the answers, keeps the mode', () => {
    expect(answerCheckCacheText(base)).toBe(answerCheckCacheText({ ...base, answer: '即使便宜 我也不买', prompt_en: "even if it's cheap, i won't buy it." }));
    expect(answerCheckCacheText({ ...base, input: 'spoken' })).not.toBe(answerCheckCacheText(base));
    expect(answerCheckCacheText({ ...base, input: 'edited' })).toBe(answerCheckCacheText(base));
    expect(answerCheckCacheText({ ...base, answer: '即使很便宜，我也不买。' })).not.toBe(answerCheckCacheText(base));
  });
});

describe('pickAnswerCheckInput', () => {
  it('needs a prompt, a model answer and a Chinese answer', () => {
    expect(pickAnswerCheckInput({})).toEqual({ problems: ['prompt_en is required', 'model_answer is required', 'answer is required'] });
    expect(pickAnswerCheckInput({ prompt_en: 'x', model_answer: '你好', answer: 'hello' })).toEqual({ problems: ['answer has no Chinese to check'] });
    const ok = pickAnswerCheckInput({ prompt_en: ' x ', model_answer: '你好', answer: '您好', input: 'spoken', focus: '', exercise_type: 'listen_translate' });
    expect(ok).toEqual({ input: { prompt_en: 'x', model_answer: '你好', model_pinyin: undefined, answer: '您好', exercise_type: 'listen_translate', input: 'spoken', focus: undefined } });
  });
});

describe('normalizeAnswerCheck', () => {
  const answer = '即使你不记得这些词，也不着急，就多练习。';
  it('keeps an almost with its fix and up to three Chinese-quoting tips', () => {
    const c = normalizeAnswerCheck({
      verdict: 'almost', headline: ' Make it a command. ', corrected: '即使你不记得这些词，也别着急，你就多练习吧。', corrected_pinyin: 'x',
      tips: [{ text: 'a', quote: '也不着急' }, { text: 'b', quote: 'abc' }, 'c', { text: 'd' }, { text: '' }],
      alternative: { hanzi: '多练习就好了。', english: 'Just practise more.' },
    }, answer);
    expect(c).toEqual({
      verdict: 'almost', headline: 'Make it a command.', corrected: '即使你不记得这些词，也别着急，你就多练习吧。', corrected_pinyin: 'x',
      tips: [{ text: 'a', quote: '也不着急' }, { text: 'b' }, { text: 'c' }],
      alternative: { hanzi: '多练习就好了。', english: 'Just practise more.' },
      suggested: 'missed_it',
    });
  });
  it('drops a correction on a correct answer, a no-op correction and an alternative that says nothing new', () => {
    expect(normalizeAnswerCheck({ verdict: 'correct', headline: 'ok', corrected: '我也不买', tips: [] }, '我也不买。').corrected).toBe('');
    const noop = normalizeAnswerCheck({ verdict: 'wrong', headline: 'x', corrected: '我也不买！', corrected_pinyin: 'wǒ', alternative: { hanzi: '我也不买' } }, '我也不买。');
    expect(noop.corrected).toBe('');
    expect(noop.corrected_pinyin).toBe('');
    expect(noop.alternative).toBeUndefined();
  });
  it('throws without a verdict or headline; parse returns null', () => {
    expect(() => normalizeAnswerCheck({ verdict: 'great', headline: 'x' }, '')).toThrow();
    expect(() => normalizeAnswerCheck({ verdict: 'correct', headline: '' }, '')).toThrow();
    expect(parseAnswerCheck(null, '')).toBeNull();
  });
});

describe('chips and suggestion', () => {
  it('maps verdicts', () => {
    expect(answerCheckChip('correct')).toEqual({ label: '✓ Correct', tone: 'good' });
    expect(answerCheckChip('acceptable')).toEqual({ label: '✓ Also right', tone: 'good' });
    expect(answerCheckChip('almost')).toEqual({ label: '~ Almost', tone: 'warn' });
    expect(answerCheckChip('wrong')).toEqual({ label: '✗ Not quite', tone: 'bad' });
    expect(suggestedFor('acceptable')).toBe('got_it');
    expect(suggestedFor('almost')).toBe('missed_it');
  });
});

describe('tipSegments', () => {
  it('keeps the quote as one segment, other Chinese by character', () => {
    expect(tipSegments({ text: '也不着急 is a statement; use 别.', quote: '也不着急' })).toEqual({
      quoteInText: true,
      segments: [
        { text: '也不着急', han: true, quote: true },
        { text: ' is a statement; use ', han: false, quote: false },
        { text: '别', han: true, quote: false },
        { text: '.', han: false, quote: false },
      ],
    });
    const two = tipSegments({ text: '和 links nouns, not 和 actions', quote: '和' });
    expect(two.segments.filter((s) => s.quote)).toHaveLength(2);
    expect(two.segments.map((s) => s.text).join('')).toBe('和 links nouns, not 和 actions');
    expect(tipSegments({ text: 'Use a comma.', quote: '和' })).toEqual({ quoteInText: false, segments: [{ text: 'Use a comma.', han: false, quote: false }] });
    expect(tipSegments({ text: '' }).segments).toEqual([]);
  });
});

describe('attempt data keeps the check and every try', () => {
  it('sanitizes check + tries', () => {
    const check = { verdict: 'almost', headline: 'x', corrected: '医生让我吃药，好好休息。', corrected_pinyin: 'yīshēng', tips: [{ text: 't', quote: '和' }] };
    const data = sanitizeAttemptData({
      started_at: 's', duration_ms: 1,
      exercises: [{ section: 0, index: 0, type: 'translate', correct: false, points: 0, max_points: 1, duration_ms: 1, answer: {
        text: '医生让我吃药和好好休息。', input: 'spoken', self_assessed: true, check,
        tries: [{ text: '医生让我吃药和休息', input: 'typed', check: { verdict: 'nope' } }, { text: '' }, 'x'],
      } }],
    });
    const a = data!.exercises[0].answer!;
    expect(a.check?.verdict).toBe('almost');
    expect(a.check?.suggested).toBe('missed_it');
    expect(a.tries).toEqual([{ text: '医生让我吃药和休息', input: 'typed' }]);
  });
});

<<<<<<< HEAD
// ============ Free speaking ============

import {
  speakingTaskParts, isSpeakingCheckType, cleanerVersion, speakingPartMark, askQuickQuestions, answerLimitFor,
} from './answerCheck';
import { speakingClock, speakingTakeLine, SPEAKING_LIVE_KEY_MARGIN_MS, SPEAKING_MAX_SECONDS } from './speakingTake';

const ANNIE = "A new colleague, Annie, arrives at your office. Guess who she is (① 就是…吧), tell her where two places are (② 就在), what today's meeting is about (③ 是关于…的), and how busy the team is (④ 形容词 + 到…).";
const SAID = '嗯，你好，你就是……sorry，你就是新来的Annie吧？洗手间在……wait，洗手间就在电梯的旁边。今天的会议是关于新项目。';

describe('speaking: which answers', () => {
  it('oral_expression and speak are checked when the transcript has Chinese', () => {
    expect(isSpeakingCheckType('oral_expression')).toBe(true);
    expect(isSpeakingCheckType('speak')).toBe(true);
    expect(isSpeakingCheckType('translate')).toBe(false);
    expect(answerCheckApplies('oral_expression', SAID)).toBe(true);
    expect(answerCheckApplies('speak', 'sorry, wait')).toBe(false);
    expect(answerLimitFor('oral_expression')).toBe(1500);
    expect(answerLimitFor('translate')).toBe(300);
  });

  it('a long transcript is kept (1500), no model answer needed, hints and the question picked', () => {
    const long = '我们团队最近忙到没有时间吃午饭。'.repeat(100);
    const r = pickAnswerCheckInput({ prompt_en: ANNIE, answer: long, exercise_type: 'oral_expression', input: 'spoken', hints: ['就是', 7, '就在'], question_audio: '她是谁？' });
    if ('problems' in r) throw new Error(r.problems.join());
    expect(r.input.answer.length).toBe(1500);
    expect(r.input.model_answer).toBe('');
    expect(r.input.hints).toEqual(['就是', '就在']);
    expect(r.input.question_audio).toBe('她是谁？');
    expect(pickAnswerCheckInput({ prompt_en: 'x', answer: '你好', exercise_type: 'translate' })).toEqual({ problems: ['model_answer is required'] });
  });

  it('cache text: its own version, hints and question count, punctuation does not', () => {
    const base = { prompt_en: ANNIE, model_answer: '', answer: SAID, exercise_type: 'oral_expression', input: 'spoken' as const };
    const t = answerCheckCacheText(base);
    expect(t.startsWith('s1|oral_expression|')).toBe(true);
    expect(answerCheckCacheText({ ...base, answer: SAID.replace(/[，。？]/g, ' ') })).toBe(t);
    expect(answerCheckCacheText({ ...base, hints: ['就是'] })).not.toBe(t);
  });
});

describe('speakingTaskParts', () => {
  it('reads ① ② ③ ④ in brackets after each ask', () => {
    expect(speakingTaskParts(ANNIE)).toEqual([
      { marker: '①', structure: '就是…吧', description: 'Guess who she is' },
      { marker: '②', structure: '就在', description: 'tell her where two places are' },
      { marker: '③', structure: '是关于…的', description: "what today's meeting is about" },
      { marker: '④', structure: '形容词 + 到…', description: 'how busy the team is' },
    ]);
  });
  it('reads plain markers and nothing from an unnumbered task', () => {
    expect(speakingTaskParts('Talk about your weekend: ① 先…然后… ② 因为…所以… and ③ 一边…一边…').map((p) => p.structure)).toEqual(['先…然后…', '因为…所以…', '一边…一边…']);
    expect(speakingTaskParts('Describe your favourite restaurant.')).toEqual([]);
    expect(speakingTaskParts(null)).toEqual([]);
  });
});

describe('normalizeAnswerCheck: speaking', () => {
  const raw = {
    verdict: 'acceptable', headline: 'All four parts — close 是关于…的 with 的.',
    cleaned: '你好，你就是新来的Annie吧？洗手间就在电梯的旁边。今天的会议是关于新项目。',
    corrected: '你好，你就是新来的Annie吧？洗手间就在电梯旁边。今天的会议是关于新项目的。',
    parts: [{ label: '① 就是…吧', status: 'used' }, { label: '③ 是关于…的', status: 'used_with_issue', note: 'missing 的' }, { label: 'x', status: 'great' }, { status: 'missing' }],
    tips: [1, 2, 3, 4, 5].map((n) => ({ text: `tip ${n}`, quote: '是关于新项目', fix: n === 1 ? '是关于新项目的' : '是关于新项目' })),
  };
  it('keeps the cleaned text, the parts, ≤ 4 tips with their fix, and the fix on an acceptable answer', () => {
    const c = normalizeAnswerCheck(raw, SAID);
    expect(c.cleaned).toBe(raw.cleaned);
    expect(c.corrected).toBe(raw.corrected);
    expect(c.suggested).toBe('got_it');
    expect(c.parts).toEqual([{ label: '① 就是…吧', status: 'used' }, { label: '③ 是关于…的', status: 'used_with_issue', note: 'missing 的' }]);
    expect(c.tips).toHaveLength(4);
    expect(c.tips[0].fix).toBe('是关于新项目的');
    expect(c.tips[1].fix).toBeUndefined(); // the same as the quote
    expect(cleanerVersion(c)).toEqual({ hanzi: raw.corrected, pinyin: '', diffFrom: raw.cleaned });
  });
  it('a "correction" equal to what they meant is dropped; correct never carries one', () => {
    expect(normalizeAnswerCheck({ ...raw, corrected: raw.cleaned }, SAID).corrected).toBe('');
    const c = normalizeAnswerCheck({ ...raw, verdict: 'correct' }, SAID);
    expect(c.corrected).toBe('');
    expect(cleanerVersion(c)).toEqual({ hanzi: raw.cleaned, pinyin: '', diffFrom: null });
  });
  it('without `cleaned` it is a translate check (no parts, acceptable has no fix)', () => {
    const c = normalizeAnswerCheck({ ...raw, cleaned: '' }, SAID);
    expect(c.parts).toBeUndefined();
    expect(c.corrected).toBe('');
    expect(c.tips).toHaveLength(3);
  });
  it('round-trips through the attempt sanitizer', () => {
    const check = normalizeAnswerCheck(raw, SAID);
    const data = sanitizeAttemptData({ started_at: '', duration_ms: 1, exercises: [{ section: 0, index: 0, type: 'oral_expression', correct: true, points: 1, max_points: 1, duration_ms: 1, answer: { text: SAID, input: 'spoken', check } }] });
    expect(data?.exercises[0].answer?.check).toEqual(check);
  });
});

describe('speaking: marks, quick questions, take numbers', () => {
  it('marks and questions', () => {
    expect(speakingPartMark('used')).toEqual({ icon: '✓', tone: 'good' });
    expect(speakingPartMark('used_with_issue')).toEqual({ icon: '~', tone: 'warn' });
    expect(speakingPartMark('missing')).toEqual({ icon: '✗', tone: 'bad' });
    expect(askQuickQuestions('almost', 'oral_expression')).toContain('What did I leave out?');
    expect(askQuickQuestions('almost')).toContain('Why is mine wrong?');
  });
  it('a long take: the live key must outlive it; the clock', () => {
    expect(SPEAKING_LIVE_KEY_MARGIN_MS).toBeGreaterThan(SPEAKING_MAX_SECONDS * 1000);
    expect(speakingClock(65)).toBe('1:05');
    expect(speakingClock(-3)).toBe('0:00');
    expect(speakingTakeLine('failed')).toBe('Couldn’t transcribe — tap to retry');
=======
describe('exactAnswerCheck', () => {
  const base = { exercise_type: 'translate', model_answer: '车站就在我家对面。' };
  it('the model answer itself → a local correct check (no call), the same rule as the Exact match chip', () => {
    for (const answer of ['车站就在我家对面。', '车站就在我家对面', ' 车站 就在我家对面 ！', '车站就在我家对面.']) {
      expect(isExactHanziMatch(answer, base.model_answer)).toBe(true);
      expect(exactAnswerCheck({ ...base, answer })).toEqual({
        verdict: 'correct', headline: EXACT_ANSWER_HEADLINE, corrected: '', corrected_pinyin: '', tips: [], suggested: 'got_it',
      });
    }
    expect(exactAnswerCheck({ ...base, exercise_type: 'listen_translate', answer: '车站就在我家对面' })?.verdict).toBe('correct');
  });
  it('anything else is left to Claude (or isn\'t checked at all)', () => {
    expect(exactAnswerCheck({ ...base, answer: '车站在我家对面。' })).toBeNull();
    expect(exactAnswerCheck({ ...base, answer: '车站就在我家对面吗' })).toBeNull();
    expect(exactAnswerCheck({ ...base, answer: '' })).toBeNull();
    expect(exactAnswerCheck({ ...base, exercise_type: 'sentence_making', answer: '车站就在我家对面。' })).toBeNull();
    expect(exactAnswerCheck({ exercise_type: 'listen_translate', model_answer: 'The station', answer: 'The station' })).toBeNull();
>>>>>>> origin/main
  });
});

describe('speaking: never the exact-match short-circuit', () => {
  it('a transcript equal to the model answer still goes to Claude', async () => {
    const { exactAnswerCheck } = await import('./answerCheck');
    expect(exactAnswerCheck({ exercise_type: 'oral_expression', answer: '你就是Annie吧？', model_answer: '你就是Annie吧' })).toBeNull();
    expect(exactAnswerCheck({ exercise_type: 'speak', answer: '你好', model_answer: '你好' })).toBeNull();
    expect(exactAnswerCheck({ exercise_type: 'translate', answer: '你好', model_answer: '你好' })?.verdict).toBe('correct');
  });
});
