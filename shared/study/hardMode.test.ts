import { describe, it, expect } from 'vitest';
import {
  parseHardMode, nextHardMode, isRedCard, hardModeApplies, hardModeQuestionResult, hardModeRoundFollows, goodEasyGate,
  ratingNeedsOverride, suggestedRating, overrideTap, overridePrompt, hardModeQuestionFeel, roundTakeFeel,
  hardModeChipLabel, hardModeNextLabel, hardModeSaidLine, HARD_MODE_GAVE_UP_LINE, HARD_MODE_CHIP, HARD_MODE_OVERRIDE_MS,
  STUDY_FEEL_VIBRATION, hardModeGiveUpInPlace, hardModeRevealedNextLabel, hardModeGaveUpCheer,
} from './hardMode';
import { sentenceGate, sentenceGateLabel } from './sentencePractise';

describe('the setting', () => {
  it('reads the old switch as All cards / Off, and cycles Off → Red → All', () => {
    expect(parseHardMode(null)).toBe('off');
    expect(parseHardMode('1')).toBe('all');
    expect(parseHardMode('0')).toBe('off');
    expect(parseHardMode('red')).toBe('red');
    expect(parseHardMode('garbage')).toBe('off');
    expect(nextHardMode('off')).toBe('red');
    expect(nextHardMode('red')).toBe('all');
    expect(nextHardMode('all')).toBe('off');
    expect(HARD_MODE_CHIP.red).toBe('🎯 Red');
    expect(hardModeChipLabel('red')).toBe('Hard mode: Red cards only');
  });
});

describe('which cards', () => {
  it('red = learning / relearning', () => {
    expect([0, 1, 2, 3].map(isRedCard)).toEqual([false, true, false, true]);
    expect(isRedCard(undefined)).toBe(false);
  });
  it('off never; all = reading + meaning + listening cards; red = only the red ones', () => {
    expect(hardModeApplies({ mode: 'off', cardType: 'hanzi_to_meaning', queue: 1 })).toBe(false);
    expect(hardModeApplies({ mode: 'all', cardType: 'meaning_to_hanzi', queue: 2 })).toBe(true);
    expect(hardModeApplies({ mode: 'red', cardType: 'audio_to_hanzi', queue: 1 })).toBe(true);
    expect(hardModeApplies({ mode: 'red', cardType: 'audio_to_hanzi', queue: 2 })).toBe(false);
    expect(hardModeApplies({ mode: 'all', cardType: 'other', queue: 1 })).toBe(false);
    expect(hardModeApplies({ mode: 'red', cardType: 'hanzi_to_meaning', queue: 3 })).toBe(true);
    expect(hardModeApplies({ mode: 'red', cardType: 'hanzi_to_meaning', queue: 2 })).toBe(false);
    expect(hardModeApplies({ mode: 'red', cardType: 'meaning_to_hanzi', queue: 0 })).toBe(false);
  });
});

describe('the question, checked at once', () => {
  it('a typed / spoken / picked answer by its verdict', () => {
    expect(hardModeQuestionResult({ answerVerdict: 'exact' })).toBe('right');
    expect(hardModeQuestionResult({ answerVerdict: 'sound' })).toBe('right');
    expect(hardModeQuestionResult({ answerVerdict: 'contains' })).toBe('right');
    expect(hardModeQuestionResult({ answerVerdict: 'close' })).toBe('close');
    expect(hardModeQuestionResult({ answerVerdict: 'wrong' })).toBe('wrong');
  });
  it('a read card take by its "You said"', () => {
    expect(hardModeQuestionResult({ take: { status: 'done', isMatch: true, containsExpected: false } })).toBe('right');
    expect(hardModeQuestionResult({ take: { status: 'done', isMatch: false, containsExpected: true } })).toBe('right');
    expect(hardModeQuestionResult({ take: { status: 'done', isMatch: false, containsExpected: false } })).toBe('wrong');
    expect(hardModeQuestionResult({ take: { status: 'done', isMatch: false, containsExpected: false, tonesOff: true } })).toBe('close'); // 老伴 for 老板: ≈ Nearly
    expect(hardModeQuestionResult({ take: { status: 'checking' } })).toBe('checking');
    expect(hardModeQuestionResult({ take: { status: 'unknown' } })).toBe('unknown');
  });
  it('nothing tried = giving up', () => {
    expect(hardModeQuestionResult({})).toBeNull();
    expect(hardModeQuestionResult({ answerVerdict: null, take: null })).toBeNull();
  });
  it('right (or not checkable) goes on to the round when there are sentences', () => {
    expect(hardModeRoundFollows('right', 3)).toBe(true);
    expect(hardModeRoundFollows('right', null)).toBe(true);
    expect(hardModeRoundFollows('right', 0)).toBe(false);
    expect(hardModeRoundFollows('unknown', 2)).toBe(true);
    expect(hardModeRoundFollows('wrong', 3)).toBe(false);
    expect(hardModeNextLabel(true)).toBe('Next: harder questions');
    expect(hardModeNextLabel(false)).toBe('See the answer');
    expect(hardModeSaidLine('银航', true)).toBe('You said: 银航');
    expect(hardModeSaidLine('银', false)).toBe('Your answer: 银');
  });
});

describe('Good / Easy: greyed, never locked', () => {
  const gate = (rightKeys: string[]) => sentenceGate({ enabled: true, cardType: 'hanzi_to_meaning', sentenceCount: 4, rightKeys });
  it('gave up: Again or Hard suggested whatever the sentences say', () => {
    const g = goodEasyGate(gate(['read:a', 'read:b']), true, null);
    expect(g).toEqual({ state: 'suggest_lower', reason: 'gave_up', label: HARD_MODE_GAVE_UP_LINE, gaveUp: true });
    expect([0, 1, 2, 3].map((r) => ratingNeedsOverride(r, g))).toEqual([false, false, true, true]);
    expect(suggestedRating(g)).toBe(1);
  });
  it('otherwise the sentence gate', () => {
    const g2 = gate(['read:a', 'read:b']);
    const open = goodEasyGate(g2, false, sentenceGateLabel(g2));
    expect(open.state).toBe('open');
    expect([0, 1, 2, 3].map((r) => ratingNeedsOverride(r, open))).toEqual([false, false, false, false]);
    expect(suggestedRating(open)).toBeNull();
    const g1 = gate(['read:a']);
    expect(goodEasyGate(g1, false, sentenceGateLabel(g1))).toEqual({ state: 'suggest_lower', reason: 'sentences', gaveUp: false, label: '🎤 Try the sentences first · 1/2 right' });
  });
  it('a second tap on the same greyed rating within 3 s rates it anyway', () => {
    const first = overrideTap({ needsOverride: true, rating: 2, armed: null, now: 1000 });
    expect(first).toEqual({ rate: false, override: false, armed: { rating: 2, at: 1000 } });
    expect(overrideTap({ needsOverride: true, rating: 2, armed: first.armed, now: 1000 + HARD_MODE_OVERRIDE_MS })).toEqual({ rate: true, override: true, armed: null });
    // too late, or another rating: armed afresh
    expect(overrideTap({ needsOverride: true, rating: 2, armed: first.armed, now: 1001 + HARD_MODE_OVERRIDE_MS })).toEqual({ rate: false, override: false, armed: { rating: 2, at: 1001 + HARD_MODE_OVERRIDE_MS } });
    expect(overrideTap({ needsOverride: true, rating: 3, armed: first.armed, now: 1500 }).armed).toEqual({ rating: 3, at: 1500 });
    // not greyed: straight through
    expect(overrideTap({ needsOverride: false, rating: 1, armed: first.armed, now: 1500 })).toEqual({ rate: true, override: false, armed: null });
    expect(overridePrompt(2)).toBe('Tap again to rate Good anyway');
    expect(overridePrompt(3)).toBe('Tap again to rate Easy anyway');
  });
});

describe('the feel', () => {
  it('a right answer is a success; the round counts and finishes', () => {
    expect(hardModeQuestionFeel('right')).toBe('success');
    expect(hardModeQuestionFeel('close')).toBe('nearly');
    expect(hardModeQuestionFeel('wrong')).toBe('miss');
    expect(hardModeQuestionFeel('checking')).toBeNull();
    expect(hardModeQuestionFeel(null)).toBeNull();
    expect(roundTakeFeel('right', false)).toBe('round_right');
    expect(roundTakeFeel('right', true)).toBe('round_done');
    expect(roundTakeFeel('failed', true)).toBeNull();
  });
  it('vibrates firmly enough to feel (≥ 35 ms pulses for a right answer)', () => {
    for (const f of ['success', 'round_right', 'round_done'] as const) {
      const on = STUDY_FEEL_VIBRATION[f].filter((_, i) => i % 2 === 0);
      expect(Math.min(...on)).toBeGreaterThanOrEqual(35);
    }
  });
});

describe('👁 Show answer on the question', () => {
  it('shows the answer in place, then on to the sentences — unless there are none', () => {
    expect(hardModeGiveUpInPlace(null)).toBe(true);
    expect(hardModeGiveUpInPlace(3)).toBe(true);
    expect(hardModeGiveUpInPlace(0)).toBe(false);
    expect(hardModeRevealedNextLabel(true)).toBe('Continue to the sentences');
    expect(hardModeRevealedNextLabel(false)).toBe('See the full answer');
    expect(hardModeGaveUpCheer(2, 2)).toBe('🎉 2 / 2 — nice recovery');
  });
});
