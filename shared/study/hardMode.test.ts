import { describe, it, expect } from 'vitest';
import {
  parseHardMode, nextHardMode, isRedCard, hardModeApplies, hardModeQuestionResult, hardModeRoundFollows, hardModeLock,
  hardModeChipLabel, hardModeNextLabel, hardModeSaidLine, HARD_MODE_GAVE_UP_LINE, HARD_MODE_CHIP,
} from './hardMode';
import { sentenceGate, sentenceGateBlockedNote, sentenceGateLabel } from './sentencePractise';

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
  it('off never; all = reading + meaning cards; red = only the red ones; never the listening card', () => {
    expect(hardModeApplies({ mode: 'off', cardType: 'hanzi_to_meaning', queue: 1 })).toBe(false);
    expect(hardModeApplies({ mode: 'all', cardType: 'meaning_to_hanzi', queue: 2 })).toBe(true);
    expect(hardModeApplies({ mode: 'all', cardType: 'audio_to_hanzi', queue: 1 })).toBe(false);
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

describe('Good / Easy', () => {
  const gate = (rightKeys: string[]) => sentenceGate({ enabled: true, cardType: 'hanzi_to_meaning', sentenceCount: 4, rightKeys });
  it('gave up: locked whatever the sentences say', () => {
    const g = gate(['read:a', 'read:b']);
    const lock = hardModeLock(g, true, sentenceGateLabel(g), sentenceGateBlockedNote(g));
    expect(lock.locked).toBe(true);
    expect(lock.label).toBe(HARD_MODE_GAVE_UP_LINE);
  });
  it('otherwise the sentence gate', () => {
    const g = gate(['read:a', 'read:b']);
    expect(hardModeLock(g, false, sentenceGateLabel(g), sentenceGateBlockedNote(g)).locked).toBe(false);
    const g1 = gate(['read:a']);
    expect(hardModeLock(g1, false, sentenceGateLabel(g1), sentenceGateBlockedNote(g1))).toMatchObject({ locked: true, gaveUp: false, label: '🎤 Get 2 sentences right to unlock Good · 1/2' });
  });
});
