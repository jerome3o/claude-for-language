import { describe, expect, it } from 'vitest';
import {
  isSentenceAnswer, sentenceAnswerCheckApplies, sentenceAnswerCheckInput, sentenceCheckDifference, sentenceCheckedVerdict,
  sentenceCheckOutcome, sentenceCheckView,
} from './sentenceAnswerCheck';
import { checkSpokenAnswer } from '../cards/answer';
import { answerCheckCacheText } from '../lesson/answerCheck';

const MODEL = '我早上喝咖啡是为了上班不困。';
const SAID = '我早上喝咖啡，因为工作不困。';

describe('sentence answers checked by Claude', () => {
  it('only sentences', () => {
    expect(isSentenceAnswer(MODEL)).toBe(true);
    expect(isSentenceAnswer('早上喝咖啡')).toBe(true);
    expect(isSentenceAnswer('银行')).toBe(false);
    expect(isSentenceAnswer('一举两得')).toBe(false);
    expect(isSentenceAnswer('你好！')).toBe(true);
  });

  it('applies to a meaning → hanzi sentence the device did not accept', () => {
    const verdict = checkSpokenAnswer(SAID, MODEL);
    expect(verdict).toBe('wrong');
    expect(sentenceAnswerCheckApplies({ cardType: 'meaning_to_hanzi', hanzi: MODEL, answer: SAID, verdict })).toBe(true);
    expect(sentenceAnswerCheckApplies({ cardType: 'meaning_to_hanzi', hanzi: MODEL, answer: SAID, verdict: 'close' })).toBe(true);
    // Accepted by the device: no call.
    for (const v of ['exact', 'punctuation_only', 'equivalent', 'alternative', 'sound', 'contains'] as const) {
      expect(sentenceAnswerCheckApplies({ cardType: 'meaning_to_hanzi', hanzi: MODEL, answer: SAID, verdict: v })).toBe(false);
    }
    // Not a sentence, dictation, a read card, a grid, no Chinese, nothing.
    expect(sentenceAnswerCheckApplies({ cardType: 'meaning_to_hanzi', hanzi: '银行', answer: '很行', verdict: 'wrong' })).toBe(false);
    expect(sentenceAnswerCheckApplies({ cardType: 'audio_to_hanzi', hanzi: MODEL, answer: SAID, verdict: 'wrong' })).toBe(false);
    expect(sentenceAnswerCheckApplies({ cardType: 'hanzi_to_meaning', hanzi: MODEL, answer: SAID, verdict: 'wrong' })).toBe(false);
    expect(sentenceAnswerCheckApplies({ cardType: 'meaning_to_hanzi', hanzi: MODEL, answer: SAID, verdict: 'wrong', multipleChoice: true })).toBe(false);
    expect(sentenceAnswerCheckApplies({ cardType: 'meaning_to_hanzi', hanzi: MODEL, answer: 'coffee', verdict: 'wrong' })).toBe(false);
    expect(sentenceAnswerCheckApplies({ cardType: 'meaning_to_hanzi', hanzi: MODEL, answer: '  ', verdict: 'wrong' })).toBe(false);
    expect(sentenceAnswerCheckApplies({ cardType: 'meaning_to_hanzi', hanzi: MODEL, answer: SAID, verdict: null })).toBe(false);
  });

  it('builds the lesson check request (translate, spoken or typed)', () => {
    const input = sentenceAnswerCheckInput({ english: " I drink coffee in the morning so I'm not sleepy at work. ", hanzi: MODEL, pinyin: 'Wǒ zǎoshang hē kāfēi shì wèile shàngbān bú kùn.', answer: ` ${SAID} `, spoken: true });
    expect(input).toEqual({
      prompt_en: "I drink coffee in the morning so I'm not sleepy at work.",
      model_answer: MODEL,
      model_pinyin: 'Wǒ zǎoshang hē kāfēi shì wèile shàngbān bú kùn.',
      answer: SAID,
      exercise_type: 'translate',
      input: 'spoken',
    });
    const typed = sentenceAnswerCheckInput({ english: 'x', hanzi: MODEL, pinyin: '', answer: SAID, spoken: false });
    expect(typed.input).toBe('typed');
    expect(typed.model_pinyin).toBeUndefined();
    // The same answer again is the same cache key (one call, then the cache).
    expect(answerCheckCacheText(input)).toBe(answerCheckCacheText(sentenceAnswerCheckInput({ english: "I drink coffee in the morning so I'm not sleepy at work.", hanzi: MODEL, pinyin: null, answer: '我早上喝咖啡 因为工作不困', spoken: true })));
  });

  it('maps the verdict: correct / acceptable = right, almost = nearly, wrong = wrong', () => {
    expect(sentenceCheckOutcome('correct')).toEqual({ answerVerdict: 'equivalent', question: 'right', pass: 'right', right: true });
    expect(sentenceCheckOutcome('acceptable')).toEqual({ answerVerdict: 'equivalent', question: 'right', pass: 'right', right: true });
    expect(sentenceCheckOutcome('almost')).toEqual({ answerVerdict: 'close', question: 'close', pass: 'wrong', right: false });
    expect(sentenceCheckOutcome('wrong')).toEqual({ answerVerdict: 'wrong', question: 'wrong', pass: 'wrong', right: false });
  });

  it('never overrides an answer the device accepted; no check = the device', () => {
    expect(sentenceCheckedVerdict('sound', 'wrong')).toBe('sound');
    expect(sentenceCheckedVerdict('exact', 'almost')).toBe('exact');
    expect(sentenceCheckedVerdict('wrong', null)).toBe('wrong');
    expect(sentenceCheckedVerdict('close', undefined)).toBe('close');
    expect(sentenceCheckedVerdict('close', 'acceptable')).toBe('equivalent');
    expect(sentenceCheckedVerdict('close', 'wrong')).toBe('wrong');
  });

  it('holds a right answer said differently', () => {
    expect(sentenceCheckDifference(SAID, MODEL, 'acceptable')).toBe('acceptable');
    expect(sentenceCheckDifference(SAID, MODEL, 'correct')).toBe('reworded');
    expect(sentenceCheckDifference(MODEL, MODEL, 'correct')).toBeNull();
    expect(sentenceCheckDifference(SAID, MODEL, 'almost')).toBeNull();
    expect(sentenceCheckDifference(SAID, MODEL, null)).toBeNull();
  });
});

describe('the answer first, the verdict after (sentenceCheckView)', () => {
  const base = { said: SAID, model: MODEL };
  it('not a sentence Claude checks: nothing changes', () => {
    expect(sentenceCheckView({ ...base, applies: false, checking: true, claude: null })).toEqual({ answerFirst: false, accepted: false, checking: false, corrected: null, readAgain: false });
  });
  it('while checking: the answer + diff at once, red marks, the inline checking row', () => {
    expect(sentenceCheckView({ ...base, applies: true, checking: true, claude: null })).toEqual({ answerFirst: true, accepted: false, checking: true, corrected: null, readAgain: true });
  });
  it('offline / failed: the answer + diff stay, no checking row', () => {
    expect(sentenceCheckView({ ...base, applies: true, checking: false, claude: null })).toEqual({ answerFirst: true, accepted: false, checking: false, corrected: null, readAgain: true });
  });
  it('correct / acceptable: accepted marks', () => {
    expect(sentenceCheckView({ ...base, applies: true, checking: false, claude: 'acceptable' }).accepted).toBe(true);
    expect(sentenceCheckView({ ...base, applies: true, checking: false, claude: 'correct' }).accepted).toBe(true);
    expect(sentenceCheckView({ ...base, applies: true, checking: false, claude: 'wrong' }).accepted).toBe(false);
  });
  it("Claude's fix of his wording: a small line for ≈ Nearly only, never the card's answer or what he said", () => {
    const fix = '我早上喝咖啡，所以上班不困。';
    expect(sentenceCheckView({ ...base, applies: true, checking: false, claude: 'almost', corrected: fix }).corrected).toBe(fix);
    expect(sentenceCheckView({ ...base, applies: true, checking: false, claude: 'almost', corrected: ` ${fix} ` }).corrected).toBe(fix);
    expect(sentenceCheckView({ ...base, applies: true, checking: false, claude: 'almost', corrected: MODEL }).corrected).toBeNull();
    expect(sentenceCheckView({ ...base, applies: true, checking: false, claude: 'almost', corrected: '我早上喝咖啡是为了上班不困' }).corrected).toBeNull();
    expect(sentenceCheckView({ ...base, applies: true, checking: false, claude: 'almost', corrected: SAID }).corrected).toBeNull();
    expect(sentenceCheckView({ ...base, applies: true, checking: false, claude: 'wrong', corrected: fix }).corrected).toBeNull();
    expect(sentenceCheckView({ ...base, applies: true, checking: false, claude: 'almost', corrected: '' }).corrected).toBeNull();
    expect(sentenceCheckView({ ...base, applies: true, checking: true, claude: 'almost', corrected: fix }).corrected).toBeNull();
  });
});

describe('🎤 Read it again under the answer (sentenceCheckView.readAgain)', () => {
  const base = { said: SAID, model: MODEL, applies: true };
  it('offered while checking, offline and on a miss; gone once Claude says right', () => {
    expect(sentenceCheckView({ ...base, checking: true, claude: null }).readAgain).toBe(true);
    expect(sentenceCheckView({ ...base, checking: false, claude: null }).readAgain).toBe(true);
    expect(sentenceCheckView({ ...base, checking: false, claude: 'almost' }).readAgain).toBe(true);
    expect(sentenceCheckView({ ...base, checking: false, claude: 'wrong' }).readAgain).toBe(true);
    expect(sentenceCheckView({ ...base, checking: false, claude: 'acceptable' }).readAgain).toBe(false);
    expect(sentenceCheckView({ ...base, checking: false, claude: 'correct' }).readAgain).toBe(false);
    // A verdict still arriving never hides it early.
    expect(sentenceCheckView({ ...base, checking: true, claude: 'correct' }).readAgain).toBe(true);
    expect(sentenceCheckView({ ...base, applies: false, checking: false, claude: null }).readAgain).toBe(false);
  });
});
