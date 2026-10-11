import { describe, expect, it } from 'vitest';
import { answerInputLabel, lessonAnswerCorrect, lessonSpokenCheck } from './spoken-check';
import { diffHanzi } from './answer-check';
import { sanitizeAttemptData } from './attempt';

describe('spoken answers in lessons', () => {
  it('only an unchanged spoken answer gets the spoken rule', () => {
    expect(lessonSpokenCheck('在见', '再见', [], 'typed')).toEqual({ verdict: null, accepted: false, note: null });
    expect(lessonSpokenCheck('在见', '再见', [], 'edited').accepted).toBe(false);
    const s = lessonSpokenCheck('在见', '再见', [], 'spoken');
    expect(s.verdict).toBe('sound');
    expect(s.accepted).toBe(true);
    expect(s.note).toBe('Sounded right ✓ — written 再见');
  });

  it('a homophone is right by sound; the word inside a sentence counts; other tones do not', () => {
    const strict = diffHanzi('在见', '再见').correct;
    expect(strict).toBe(false);
    expect(lessonAnswerCorrect(strict, lessonSpokenCheck('在见', '再见', [], 'spoken'))).toBe(true);
    const inside = lessonSpokenCheck('他长得很好。', '长得', [], 'spoken');
    expect(inside.verdict).toBe('contains');
    expect(inside.note).toBe('Said inside a sentence ✓ — 长得');
    expect(lessonSpokenCheck('买', '卖', [], 'spoken').accepted).toBe(false);
    expect(lessonSpokenCheck('猫', '狗', [], 'spoken').accepted).toBe(false);
    expect(lessonSpokenCheck('  ', '狗', [], 'spoken').verdict).toBeNull();
  });

  it('labels and keeps how the answer was given', () => {
    expect(answerInputLabel('spoken')).toBe('🎤 Said');
    expect(answerInputLabel('edited')).toBe('🎤 Said, then edited');
    expect(answerInputLabel(undefined, 'Wrote')).toBe('Wrote');
  });
});

describe('attempt sanitizer', () => {
  it('keeps a valid input and drops anything else', () => {
    const make = (input: unknown) => sanitizeAttemptData({
      started_at: '2026-10-11T10:00:00Z', duration_ms: 1000,
      exercises: [{ section: 0, index: 0, type: 'write_typed', correct: true, points: 1, max_points: 1, duration_ms: 500, answer: { text: '再见', input } }],
    });
    expect(make('spoken')?.exercises[0].answer?.input).toBe('spoken');
    expect(make('shouted')?.exercises[0].answer?.input).toBeUndefined();
  });
});
