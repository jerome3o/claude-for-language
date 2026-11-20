/**
 * A recogniser's punctuation never counts against a spoken answer (docs/STUDY_SESSION.md "A pause is never grammar"):
 * every prompt that grades a SPOKEN or DICTATED answer tells the model the text is a speech-recognition transcript —
 * ignore punctuation / spacing / sentence breaks, read homophones and digits as what was said — and every spoken
 * answer reaches the model (and its cache key) scrubbed of the recogniser's punctuation.
 */
import { describe, it, expect } from 'vitest';
import { ANSWER_CHECK_SYSTEM, MEANING_CHECK_SYSTEM, READ_ALOUD_CHECK_SYSTEM, SPEAKING_CHECK_SYSTEM } from '../answer-check';
import { DICTATED_TEXT_RULE, SENTENCE_CHECK_SYSTEM, SPOKEN_SENTENCE_RULE } from '../sentence-making';
import { AUTO_CHECK_SYSTEM } from '../chat/auto-check';
import { SENTENCE_COACH_SYSTEM_PROMPT } from '../sentence-coach';
import { answerCheckCacheText, pickAnswerCheckInput } from '@shared/lesson/answerCheck';

describe('spoken-answer grading prompts', () => {
  it('every spoken check says the transcript is speech recognition and to ignore its punctuation', () => {
    for (const [name, prompt] of Object.entries({ ANSWER_CHECK_SYSTEM, READ_ALOUD_CHECK_SYSTEM, SPEAKING_CHECK_SYSTEM, MEANING_CHECK_SYSTEM, SPOKEN_SENTENCE_RULE })) {
      expect(prompt, name).toMatch(/speech-recognition/i);
      expect(prompt, name).toMatch(/punctuation/i);
    }
  });

  it('the spoken checks read homophones and digits as what was said', () => {
    for (const [name, prompt] of Object.entries({ ANSWER_CHECK_SYSTEM, READ_ALOUD_CHECK_SYSTEM, SPEAKING_CHECK_SYSTEM, SPOKEN_SENTENCE_RULE })) {
      expect(prompt, name).toMatch(/homophone|sounds like|sound-alike/i);
      expect(prompt, name).toMatch(/digits/i);
    }
  });

  it('the sentence-making check carries the spoken rule', () => {
    expect(SENTENCE_CHECK_SYSTEM).toContain(SPOKEN_SENTENCE_RULE);
  });

  it('the chat auto-check (incl. Ask Claude questions) and the Coach check know a dictated text', () => {
    expect(DICTATED_TEXT_RULE).toMatch(/speech-recognition transcript/);
    expect(DICTATED_TEXT_RULE).toMatch(/punctuation/);
    expect(AUTO_CHECK_SYSTEM).toContain(DICTATED_TEXT_RULE);
    expect(SENTENCE_COACH_SYSTEM_PROMPT).toContain(DICTATED_TEXT_RULE);
  });
});

describe('the lesson answer check reads a spoken answer without its punctuation', () => {
  const base = { prompt_en: 'I am going', model_answer: '我去', exercise_type: 'translate', input: 'spoken' };
  const pick = (answer: string, extra: Record<string, unknown> = {}) => {
    const r = pickAnswerCheckInput({ ...base, answer, ...extra });
    if (!('input' in r)) throw new Error(r.problems.join(', '));
    return r.input;
  };

  it('scrubs the recogniser’s marks, ASCII or full-width, quotes and dashes', () => {
    for (const said of ['我去。', '我去', '“我去”', '我去！', '我去!', '我，去', '我 去', '我去～', '我去——', '我去⋯']) {
      expect(pick(said).answer, said).toBe('我去');
    }
  });

  it('answers differing only in punctuation share one cached verdict', () => {
    const key = answerCheckCacheText(pick('我去'));
    for (const said of ['我去。', '“我去”？', '我，去!', '我去～']) expect(answerCheckCacheText(pick(said)), said).toBe(key);
  });

  it('a typed answer keeps its own punctuation (the cache key still ignores it)', () => {
    const typed = pick('我去。', { input: 'typed' });
    expect(typed.answer).toBe('我去。');
    expect(answerCheckCacheText(typed)).toBe(answerCheckCacheText(pick('我去', { input: 'typed' })));
  });
});
