import { describe, expect, it } from 'vitest';
import {
  forgiveUnheard, heardMeaningKey, marksTense, hasTaPronoun, taKey, unheardPronounLine, unheardTenseLine, tenseStem, isHeardOnlyCheck,
  HEARD_BOTH_HEADLINE, HEARD_PRONOUN_HEADLINE, HEARD_TA_HEADLINE, HEARD_TENSE_HEADLINE,
} from './heardCheck';
import { normalizeAnswerCheck, type AnswerCheck, type AnswerCheckInput } from './answerCheck';
import { listenCheckInput } from '../study/sentenceRound';

const ROW = { hanzi: '她责怪我。', pinyin: 'Tā zéguài wǒ.', translation: 'She blamed me.' };
/** The check Jerome got (Nov 2026), as the model returned it. */
const JEROME_RAW = {
  verdict: 'almost',
  headline: 'Wrong subject: "he" instead of "she"',
  corrected: '',
  tips: [{ text: '她 (tā) means "she"; 他 (tā) is "he" — same sound, different character.', quote: '她' }],
};
const meaning = (answer: string, row = ROW, input: 'spoken' | 'typed' = 'spoken'): AnswerCheckInput => listenCheckInput(row, answer, input);
const check = (raw: Record<string, unknown>, input: AnswerCheckInput): AnswerCheck =>
  forgiveUnheard(normalizeAnswerCheck(raw, input.answer, input.model_answer), input);

describe('forgiveUnheard: Jerome\'s 她责怪我', () => {
  it('"He blames me" is right — gender and tense are not heard', () => {
    const c = check(JEROME_RAW, meaning('He blames me.'));
    expect(c.verdict).toBe('correct');
    expect(c.suggested).toBe('got_it');
    expect(c.tips).toEqual([]);
    expect(c.headline).toBe(HEARD_BOTH_HEADLINE);
  });

  it('he / she alone, blames / blamed alone, it, and spoken / typed', () => {
    expect(check(JEROME_RAW, meaning('He blamed me')).headline).toBe(HEARD_PRONOUN_HEADLINE);
    expect(check({ ...JEROME_RAW, headline: 'Tense: "blames", not "blamed"', tips: [] }, meaning('She blames me', ROW, 'typed')))
      .toMatchObject({ verdict: 'correct', headline: HEARD_TENSE_HEADLINE, tips: [] });
    for (const said of ['It blamed me.', 'She is blaming me', "She's blaming me", 'She has blamed me', 'She will blame me', 'he blame me']) {
      expect(check(JEROME_RAW, meaning(said)).verdict, said).toBe('correct');
    }
  });

  it('a wrong verdict whose answer is the reference by ear is right too', () => {
    expect(check({ verdict: 'wrong', headline: 'Wrong person.', corrected: '', tips: [] }, meaning('He blames me')).verdict).toBe('correct');
  });

  it('counter-cases stay wrong: roles swapped, I / you, negation', () => {
    const swapped = check({ verdict: 'wrong', headline: 'Reversed: she blamed you, not you her.', corrected: '', tips: [] }, meaning('I blamed her'));
    expect(swapped.verdict).toBe('wrong');
    const swapped2 = check({ verdict: 'almost', headline: 'Who blamed whom is swapped.', corrected: '', tips: [] }, meaning('I blamed her'));
    expect(swapped2.verdict).toBe('almost');
    const neg = check({ verdict: 'almost', headline: 'There is no negation — she DID blame you.', corrected: '', tips: [] }, meaning("She didn't blame me"));
    expect(neg.verdict).toBe('almost');
    // Even a check that only mentions he / she can't hide a lost "not" or a "you" for "me".
    expect(check(JEROME_RAW, meaning("He didn't blame me")).verdict).toBe('almost');
    expect(check(JEROME_RAW, meaning('He blamed you')).verdict).toBe('almost');
    expect(check(JEROME_RAW, meaning('He blames me a lot')).verdict).toBe('correct');
    const you = check({ verdict: 'almost', headline: 'Wrong person: "you" instead of "she"', corrected: '', tips: [] }, meaning('You blamed me'));
    expect(you.verdict).toBe('almost');
  });

  it('a tense the Chinese marks still counts', () => {
    const row = { hanzi: '她明天会责怪我。', translation: 'She will blame me tomorrow.' };
    const c = check({ verdict: 'almost', headline: 'Tense: it is future (明天会).', corrected: '', tips: [] }, meaning('She blamed me', row));
    expect(c.verdict).toBe('almost');
    const row2 = { hanzi: '她责怪了我。', translation: 'She blamed me.' };
    expect(check({ verdict: 'almost', headline: 'Past tense, not present.', corrected: '', tips: [] }, meaning('She blames me', row2)).verdict).toBe('almost');
    // …while he / she is still forgiven there.
    expect(check(JEROME_RAW, meaning('He blamed me', row2)).verdict).toBe('correct');
  });

  it('no tā in the Chinese: he / she is a real mistake', () => {
    const row = { hanzi: '我责怪你。', translation: 'I blamed you.' };
    expect(check({ verdict: 'almost', headline: 'Wrong subject: "he" instead of "I"', corrected: '', tips: [] }, meaning('He blamed you', row)).verdict).toBe('almost');
  });

  it('right verdicts lose the tips that only nitpick gender / tense', () => {
    const c = check({ verdict: 'acceptable', headline: 'Got it.', corrected: '', tips: [{ text: '她 is "she", not "he".', quote: '她' }, { text: 'Note 责怪 is a strong word.', quote: '责怪' }] }, meaning('He blames me'));
    expect(c.verdict).toBe('acceptable');
    expect(c.tips.map((t) => t.quote)).toEqual(['责怪']);
    const d = check({ verdict: 'acceptable', headline: 'Right, but "she", not "he".', corrected: '', tips: [] }, meaning('He blames me'));
    expect(d).toMatchObject({ verdict: 'correct', tips: [], headline: HEARD_PRONOUN_HEADLINE });
  });
});

describe('forgiveUnheard: answered in Chinese', () => {
  const zh = (answer: string): AnswerCheckInput => listenCheckInput(ROW, answer, 'typed');

  it('他 for 她 is right', () => {
    const c = check({ verdict: 'almost', headline: 'Use 她, not 他.', corrected: '她责怪我', tips: [{ text: '她 is "she"; 他 is "he".', quote: '他' }] }, zh('他责怪我'));
    expect(c).toMatchObject({ verdict: 'correct', headline: HEARD_TA_HEADLINE, tips: [], corrected: '' });
  });

  it('a correction that only swaps 他 / 她 is right; any other fix stays', () => {
    const lesson: AnswerCheckInput = { exercise_type: 'listen_translate', prompt_en: 'She blamed me yesterday.', model_answer: '她昨天责怪了我。', answer: '他昨天责怪我了。', input: 'typed' };
    expect(check({ verdict: 'almost', headline: 'Wrong pronoun.', corrected: '她昨天责怪我了。', tips: [{ text: '她 = she', quote: '她' }] }, lesson).verdict).toBe('correct');
    const other: AnswerCheckInput = { ...lesson, answer: '他昨天不责怪我。' };
    expect(check({ verdict: 'almost', headline: 'Wrong negation.', corrected: '她昨天没责怪我。', tips: [] }, other).verdict).toBe('almost');
    expect(check({ verdict: 'wrong', headline: 'I and you swapped.', corrected: '', tips: [] }, zh('我责怪她')).verdict).toBe('wrong');
  });
});

describe('seen checks stay strict', () => {
  it('translate (he SAW / read the English → wrote Chinese) keeps 他 vs 她', () => {
    const input: AnswerCheckInput = { exercise_type: 'translate', prompt_en: 'She blamed me.', model_answer: '她责怪我。', answer: '他责怪我。', input: 'typed' };
    expect(isHeardOnlyCheck(input)).toBe(false);
    expect(check({ verdict: 'almost', headline: 'Use 她 for "she".', corrected: '她责怪我。', tips: [] }, input).verdict).toBe('almost');
    const read: AnswerCheckInput = { exercise_type: 'read_aloud', prompt_en: 'She blamed me.', model_answer: '她责怪我。', answer: '他责怪我。', input: 'spoken' };
    expect(check({ verdict: 'almost', headline: 'You read 他.', corrected: '', tips: [] }, read).verdict).toBe('almost');
  });
});

describe('the pieces', () => {
  it('heardMeaningKey', () => {
    const k = (s: string) => heardMeaningKey(s, { pronouns: true, tense: true });
    expect(k('He blames me.')).toBe(k('She blamed me.'));
    expect(k('She went to the bank')).toBe(k('He goes to a bank'));
    expect(k('She is going to the bank')).toBe(k('She went to the bank'));
    expect(k("She didn't blame me")).toBe(k('She does not blame me'));
    expect(k("She didn't blame me")).not.toBe(k('She blamed me'));
    expect(k("She won't blame me")).not.toBe(k('She will blame me'));
    expect(k('I blamed her')).not.toBe(k('She blamed me'));
    expect(k('She has a dog')).not.toBe(k('She is a dog'));
    expect(k('She bought books')).toBe(k('He buys a book'));
    expect(heardMeaningKey('She blames me', { pronouns: true, tense: false })).not.toBe(heardMeaningKey('She blamed me', { pronouns: true, tense: false }));
    expect(heardMeaningKey('He blamed me', { pronouns: false, tense: true })).not.toBe(heardMeaningKey('She blamed me', { pronouns: false, tense: true }));
  });

  it('tenseStem', () => {
    expect(['blame', 'blames', 'blamed', 'blaming'].map(tenseStem)).toEqual(['blam', 'blam', 'blam', 'blam']);
    expect(['stop', 'stopped', 'stopping', 'stops'].map(tenseStem)).toEqual(['stop', 'stop', 'stop', 'stop']);
    expect(['make', 'made', 'making'].map(tenseStem)).toEqual(['mak', 'mak', 'mak']);
    expect(['try', 'tried', 'tries'].map(tenseStem)).toEqual(['try', 'try', 'try']);
    expect(['call', 'called'].map(tenseStem)).toEqual(['call', 'call']);
  });

  it('marksTense / hasTaPronoun / taKey', () => {
    expect(marksTense('她责怪我')).toBe(false);
    expect(['她责怪了我', '她明天会责怪我', '她没责怪我', '她在责怪我', '她昨天责怪我'].every(marksTense)).toBe(true);
    expect(hasTaPronoun('她们来')).toBe(true);
    expect(hasTaPronoun('我来')).toBe(false);
    expect(taKey('她责怪它。')).toBe('他责怪他');
  });

  it('the line rules', () => {
    expect(unheardPronounLine('Wrong subject: "he" instead of "she"')).toBe(true);
    expect(unheardPronounLine('她 (tā) means "she"; 他 (tā) is "he".', '她')).toBe(true);
    expect(unheardPronounLine('Wrong gender.')).toBe(true);
    expect(unheardPronounLine('Wrong person: "you" instead of "she"')).toBe(false);
    expect(unheardPronounLine('Wrong subject: you said I instead of she')).toBe(false);
    expect(unheardPronounLine('She did not blame — he did', null)).toBe(false);
    expect(unheardPronounLine('没 makes it negative.', '没')).toBe(false);
    expect(unheardPronounLine('Wrong person.')).toBe(false);
    expect(unheardTenseLine('Tense: "blames", not "blamed"')).toBe(true);
    expect(unheardTenseLine('Past tense, not present.')).toBe(true);
    expect(unheardTenseLine('Wrong verb: "praised", not "blamed"')).toBe(false);
    expect(unheardTenseLine('"praised" vs "blamed" — past tense')).toBe(false);
    expect(unheardTenseLine('Wrong time: tomorrow, not yesterday')).toBe(false);
    expect(unheardTenseLine('明天 makes it future.', '明天')).toBe(false);
  });
});
