import { describe, it, expect } from 'vitest';
import {
  guardSentenceGrade, namesProblem, normalizeSentenceFeedback, normalizeSentenceFix, pickSentenceCheckInput, problemClause,
  sentenceCheckCacheText, sentenceCheckView, needsWorkHeadline, legacyGrade, SENTENCE_RIGHT_HEADLINE, SENTENCE_MISSING_WORD_HEADLINE,
  moreIncludesReason, sentenceFixProblem, cleanSentenceFixProblem, SentenceFixRejected, SENTENCE_FIX_PROBLEM_MAX,
} from './sentenceCheck';
import { normalizeAnswerCheck, pickAnswerCheckInput, punctuationComplaint } from './answerCheck';
import { scrubSpokenTranscript, spokenCheckAnswer } from '../cards/answer';

const BENLAI = { words: ['本来', '要'], sentence: '我本来要去健身馆，但是我学中文。' };
/** What the old check said about Jerome's sentence (Nov 2026), word for word. */
const JEROME_COMMENT = 'Good use of 本来…要 to set up the original plan; but the second clause just states another plan rather than an actual interrupting event, so it should show what really happened, e.g. with 结果 or 可是…了. Also 健身馆 is usually 健身房.';

describe('the coherence guard', () => {
  it('Jerome\'s 本来…要: "✓ Natural and correct" over that explanation is needs_work (v1 shape)', () => {
    const fb = normalizeSentenceFeedback({ verdict: 'correct', uses_all_words: true, comment: JEROME_COMMENT }, BENLAI);
    expect(fb.grade).toBe('needs_work');
    expect(fb.verdict).toBe('minor');
    expect(fb.headline).toBe('本来 and 要 used right — one thing to fix');
    expect(fb.reason).toBe('The second clause just states another plan rather than an actual interrupting event…');
    expect(fb.more).toBe(JEROME_COMMENT);
    expect(fb.fixable).toBe(true);
  });

  it('… and in the v2 shape', () => {
    const fb = normalizeSentenceFeedback({ grade: 'right', headline: 'Natural and correct', reason: JEROME_COMMENT, fixable: false, uses_all_words: true }, BENLAI);
    expect(fb.grade).toBe('needs_work');
    expect(fb.fixable).toBe(false); // Claude said it can't be fixed by small edits — respected
  });

  it('a correct sentence stays right', () => {
    const fb = normalizeSentenceFeedback(
      { grade: 'right', headline: '本来…要 used naturally', reason: 'It sets up the plan, and 可是 shows what changed.', fixable: false, uses_all_words: true },
      { words: ['本来', '要'], sentence: '我本来要去健身房，可是下雨了。' },
    );
    expect(fb).toMatchObject({ grade: 'right', verdict: 'correct', headline: '本来…要 used naturally', fixable: false });
    expect(normalizeSentenceFeedback({ grade: 'right', headline: 'Natural and correct — no mistakes, nothing to fix.', fixable: false, uses_all_words: true }, BENLAI).grade).toBe('right');
  });

  it('names a problem: but / should / usually / unnatural; praise that only looks like one does not', () => {
    for (const t of ['Good, but 健身馆 is usually 健身房.', 'It should say what happened.', 'A little unnatural.', 'The second half doesn’t follow.']) expect(namesProblem(t)).toBe(true);
    for (const t of ['Natural and correct.', 'Nothing to fix — nicely done.', 'No mistakes here.', 'Good use of 本来…要 to set up the plan.', '']) expect(namesProblem(t)).toBe(false);
  });

  it('a missing word is wrong; needs_work / wrong are never upgraded', () => {
    expect(guardSentenceGrade('right', ['Natural'], false)).toBe('wrong');
    expect(guardSentenceGrade('needs_work', ['Natural'], true)).toBe('needs_work');
    expect(guardSentenceGrade('wrong', [], true)).toBe('wrong');
    expect(guardSentenceGrade('right', ['Nice.', 'Also 健身馆 is usually 健身房.'], true)).toBe('needs_work');
  });

  it('the problem clause, its "but" dropped', () => {
    expect(problemClause(JEROME_COMMENT)).toMatch(/^The second clause/);
    expect(problemClause('All good.')).toBeNull();
  });

  it('views: idempotent on a normalised check; v1 checks read in place', () => {
    const fb = normalizeSentenceFeedback({ verdict: 'correct', uses_all_words: true, comment: JEROME_COMMENT }, BENLAI);
    const v = sentenceCheckView(fb, BENLAI.words);
    expect(v).toMatchObject({ grade: 'needs_work', icon: '≈', tone: 'warn', headline: fb.headline, reason: fb.reason, right: false, fixable: true, downgraded: false });
    expect(sentenceCheckView({ verdict: 'correct', uses_all_words: true, comment: 'Nice — that sentence works.' }, []).headline).toBe(SENTENCE_RIGHT_HEADLINE);
    expect(sentenceCheckView({ verdict: 'minor', uses_all_words: false, comment: 'Add 所以.' }, ['所以'])).toMatchObject({ grade: 'wrong', headline: SENTENCE_MISSING_WORD_HEADLINE });
    expect(legacyGrade('minor', true)).toBe('needs_work');
    expect(needsWorkHeadline(['a', 'b', 'c', 'd'])).toBe('The target words used right — one thing to fix');
  });

  it('a spoken sentence: the model decides whether a misheard word was used', () => {
    const said = { words: ['不知道', '有没有'], sentence: '我不知道我妹妹有不有新电脑', input: 'spoken' };
    expect(normalizeSentenceFeedback({ grade: 'needs_work', headline: '有没有 came out as 有不有', fixable: true, uses_all_words: true }, said).grade).toBe('needs_work');
    expect(normalizeSentenceFeedback({ grade: 'needs_work', headline: '有没有 came out as 有不有', fixable: true, uses_all_words: true }, { ...said, input: 'typed' }).grade).toBe('wrong');
  });
});

describe('the reason is read once (More ▸ in place of a cut line)', () => {
  const ANGLE = { words: ['角度'], sentence: '从我妈妈的角度来看我和我妹妹住在很远的地方', input: 'spoken' };
  const REASON = 'From your mother’s point of view should lead to what she thinks or feels, but 我和我妹妹住在很远的地方 only states where you live.';
  const raw = { grade: 'needs_work', headline: '从…的角度 used right — unclear what the angle reveals', reason: REASON, more: 'Add her view, e.g. 她觉得我们住得太远了.', fixable: true, uses_all_words: true };

  it('Jerome\'s 从…的角度 check: the line is cut, More holds all of it → More opens in its place', () => {
    const fb = normalizeSentenceFeedback(raw, ANGLE);
    expect(fb.reason).toBe('From your mother’s point of view should lead to what she thinks or feels…');
    const v = sentenceCheckView(fb, ANGLE.words);
    expect(v.more.startsWith(REASON)).toBe(true);
    expect(v.moreIncludesReason).toBe(true);
    // Idempotent: the stored check reads the same.
    expect(sentenceCheckView(fb, ANGLE.words)).toEqual(v);
  });

  it('a reason More doesn\'t hold stays where it is', () => {
    const v = sentenceCheckView(normalizeSentenceFeedback({ ...raw, reason: 'Say what she thinks.' }, ANGLE), ANGLE.words);
    expect(v.reason).toBe('Say what she thinks.');
    expect(v.moreIncludesReason).toBe(false);
  });

  it('moreIncludesReason: the "…", spacing and case aside; an empty line never', () => {
    expect(moreIncludesReason('The second clause just states another plan.', 'the second   clause…')).toBe(true);
    expect(moreIncludesReason('abc', '')).toBe(false);
    expect(moreIncludesReason('abc', '…')).toBe(false);
    expect(moreIncludesReason('abc', 'xyz')).toBe(false);
  });

  it('the fix is told the problem, each line once', () => {
    const fb = normalizeSentenceFeedback(raw, ANGLE);
    const problem = sentenceFixProblem(fb, ANGLE.words);
    expect(problem.startsWith('从…的角度 used right — unclear what the angle reveals From your mother’s point of view')).toBe(true);
    expect(problem.split('should lead to what she thinks').length).toBe(2); // once
    expect(problem).toContain('她觉得我们住得太远了');
    expect(sentenceFixProblem({ verdict: 'correct', grade: 'right', headline: 'Natural and correct', uses_all_words: true, comment: '' }, [])).toBe('');
    expect(cleanSentenceFixProblem(' a \n b ')).toBe('a b');
    expect([...cleanSentenceFixProblem('从'.repeat(700))]).toHaveLength(SENTENCE_FIX_PROBLEM_MAX);
    expect(cleanSentenceFixProblem(42)).toBe('');
  });
});

describe('the fix, the input, the cache', () => {
  it('a fix is Chinese and not his own sentence', () => {
    expect(normalizeSentenceFix({ hanzi: '我本来要去健身房，可是后来去学中文了。', english: 'x' }, BENLAI.sentence).hanzi).toBe('我本来要去健身房，可是后来去学中文了。');
    expect(() => normalizeSentenceFix({ hanzi: '我本来要去健身馆 但是我学中文' }, BENLAI.sentence)).toThrow(SentenceFixRejected);
    expect(() => normalizeSentenceFix({ hanzi: 'hello' }, BENLAI.sentence)).toThrow(SentenceFixRejected);
  });

  it('re-punctuating his sentence is not a fix (Jerome\'s 从…的角度, Nov 2026)', () => {
    const said = '从我妈妈的角度来看我和我妹妹住在很远的地方';
    try {
      normalizeSentenceFix({ hanzi: '从我妈妈的角度来看，我和我妹妹住在很远的地方。' }, said);
      throw new Error('accepted');
    } catch (e) {
      expect(e).toBeInstanceOf(SentenceFixRejected);
      expect((e as SentenceFixRejected).kind).toBe('same');
    }
    expect(normalizeSentenceFix({ hanzi: '从我妈妈的角度来看，我和我妹妹住得太远了。' }, said).hanzi).toBe('从我妈妈的角度来看，我和我妹妹住得太远了。');
  });

  it('input + cache text (punctuation aside, versioned)', () => {
    expect(pickSentenceCheckInput({ words: [], sentence: '' })).toEqual({ problems: ['words are required', 'sentence is required'] });
    const a = sentenceCheckCacheText({ words: ['本来', '要'], sentence: '我本来要去健身馆，但是我学中文。' }, 'check');
    expect(a).toBe(sentenceCheckCacheText({ words: ['本来', '要'], sentence: '我本来要去健身馆 但是我学中文' }, 'check'));
    expect(a.startsWith('sentence_making:check:v2')).toBe(true);
    expect(a).not.toBe(sentenceCheckCacheText({ words: ['本来', '要'], sentence: BENLAI.sentence }, 'fix'));
  });
});

describe('a pause is never grammar (spoken answers)', () => {
  const PAUSED = '我不知道。 我妹妹有，不有新电脑。';
  it('Jerome\'s paused take is checked as one utterance', () => {
    expect(scrubSpokenTranscript(PAUSED)).toBe('我不知道我妹妹有不有新电脑');
    expect(spokenCheckAnswer(PAUSED, 'spoken')).toBe('我不知道我妹妹有不有新电脑');
    expect(spokenCheckAnswer(PAUSED, 'typed')).toBe(PAUSED); // typed answers keep their punctuation
    expect(scrubSpokenTranscript('我有 3.5 块，好吗？')).toBe('我有3.5块好吗');
    expect(scrubSpokenTranscript('我喜欢 coffee，你呢？')).toBe('我喜欢 coffee 你呢');
    expect(scrubSpokenTranscript("I don't know, maybe.")).toBe("I don't know, maybe.");
  });

  it('the lesson answer check reads (and caches) the scrubbed take', () => {
    const r = pickAnswerCheckInput({ prompt_en: "I don't know if my sister has a new computer.", model_answer: '我不知道我妹妹有没有新电脑。', answer: PAUSED, exercise_type: 'translate', input: 'spoken' });
    if ('problems' in r) throw new Error(r.problems.join());
    expect(r.input.answer).toBe('我不知道我妹妹有不有新电脑');
    const typed = pickAnswerCheckInput({ prompt_en: 'x', model_answer: '我很好。', answer: '我很好。', exercise_type: 'translate', input: 'typed' });
    if ('problems' in typed) throw new Error(typed.problems.join());
    expect(typed.input.answer).toBe('我很好。');
  });

  it('a line that only blames the split / punctuation is dropped on a spoken answer, kept on a typed one', () => {
    const raw = {
      verdict: 'almost', headline: 'Don\'t split it into separate sentences.', corrected: '我不知道我妹妹有没有新电脑。',
      tips: [{ text: 'Splitting into separate sentences breaks the question.' }, { text: '有不有 is not a question form — use 有没有.', quote: '有不有' }],
    };
    const said = scrubSpokenTranscript(PAUSED);
    const spoken = normalizeAnswerCheck(raw, said, '我不知道我妹妹有没有新电脑。', true);
    expect(spoken.headline).toBe('Nearly — compare with the corrected version.');
    expect(spoken.tips.map((t) => t.text)).toEqual(['有不有 is not a question form — use 有没有.']);
    const typed = normalizeAnswerCheck(raw, PAUSED, '我不知道我妹妹有没有新电脑。');
    expect(typed.tips).toHaveLength(2);
    expect(punctuationComplaint('A run-on sentence.')).toBe(true);
    expect(punctuationComplaint('有不有 → 有没有')).toBe(false);
  });
});
