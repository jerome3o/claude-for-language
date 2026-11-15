import { describe, it, expect } from 'vitest';
import { compareTranscription } from '../recordings/transcript';
import { hardModeQuestionResult } from './hardMode';
import { passSuggestion } from '../homework/pass-card';
import {
  READ_TAKE_CHIP, hanCount, readTakeCheckApplies, readTakeCheckInput, readTakeChecked, readTakeClaudeState,
  readTakeDeviceState, readTakeReason,
} from './readTakeCheck';
import type { AnswerCheck } from '../lesson/answerCheck';

// Jerome, Nov 2026: the read card 我越学中文，越觉得英文很繁琐。 — "✕ Didn't match" for 我越学中文，越觉得英语很"繁琐"。
const CARD = '我越学中文，越觉得英文很繁琐。';
const SAID = '我越学中文，越觉得英语很"繁琐"。';
const check = (verdict: AnswerCheck['verdict'], headline = 'x', tips: AnswerCheck['tips'] = []): AnswerCheck => ({
  verdict, headline, corrected: '', corrected_pinyin: '', tips, suggested: verdict === 'correct' ? 'got_it' : 'missed_it',
});

describe('read takes checked by Claude', () => {
  it('only the quotes differ: the device says ✓ — no Claude call', () => {
    const c = compareTranscription('我越学中文，越觉得英文很"繁琐"。', CARD, '');
    expect(readTakeDeviceState(c)).toBe('match');
    expect(readTakeCheckApplies({ cardType: 'hanzi_to_meaning', hanzi: CARD, transcript: c.transcribedHanzi, comparison: c })).toBe(false);
  });

  it('英语 for 英文: the device says ✗, so it goes to Claude (a read card, a sentence, online)', () => {
    const c = compareTranscription(SAID, CARD, '');
    expect(readTakeDeviceState(c)).toBe('miss');
    expect(readTakeCheckApplies({ cardType: 'hanzi_to_meaning', hanzi: CARD, transcript: SAID, comparison: c })).toBe(true);
  });

  it('never another card type, a one-character card, a match / contains / tones off, nothing Chinese heard', () => {
    const miss = { isMatch: false, containsExpected: false, tonesOff: false };
    expect(readTakeCheckApplies({ cardType: 'meaning_to_hanzi', hanzi: CARD, transcript: SAID, comparison: miss })).toBe(false);
    expect(readTakeCheckApplies({ cardType: 'hanzi_to_meaning', hanzi: '好', transcript: '号', comparison: miss })).toBe(false);
    expect(readTakeCheckApplies({ cardType: 'hanzi_to_meaning', hanzi: '银行', transcript: '音响', comparison: miss })).toBe(true);
    expect(readTakeCheckApplies({ cardType: 'hanzi_to_meaning', hanzi: CARD, transcript: SAID, comparison: { ...miss, tonesOff: true } })).toBe(false);
    expect(readTakeCheckApplies({ cardType: 'hanzi_to_meaning', hanzi: CARD, transcript: SAID, comparison: { ...miss, containsExpected: true } })).toBe(false);
    expect(readTakeCheckApplies({ cardType: 'hanzi_to_meaning', hanzi: CARD, transcript: 'hello', comparison: miss })).toBe(false);
    expect(readTakeCheckApplies({ cardType: 'hanzi_to_meaning', hanzi: CARD, transcript: SAID, comparison: null })).toBe(false);
    expect(hanCount('我越学中文，越觉得')).toBe(8);
  });

  it('the request: read_aloud, spoken, the card as the model, the transcript tidied (quotes gone)', () => {
    expect(readTakeCheckInput({ hanzi: CARD, pinyin: 'wǒ yuè xué', english: 'The more I study Chinese…', transcript: SAID })).toEqual({
      prompt_en: 'The more I study Chinese…',
      model_answer: CARD,
      model_pinyin: 'wǒ yuè xué',
      answer: '我越学中文，越觉得英语很繁琐。',
      exercise_type: 'read_aloud',
      input: 'spoken',
    });
    expect(readTakeCheckInput({ hanzi: '银行', transcript: '音响' }).prompt_en).toBe('银行');
  });

  it('Claude\'s verdict: correct = ✓, acceptable / almost = ≈ Close (a same-meaning word is never ✗), wrong = ✗', () => {
    expect(readTakeClaudeState('correct')).toBe('match');
    expect(readTakeClaudeState('acceptable')).toBe('close');
    expect(readTakeClaudeState('almost')).toBe('close');
    expect(readTakeClaudeState('wrong')).toBe('miss');
    expect(READ_TAKE_CHIP.close).toBe('Close');
  });

  it('every rule downstream reads the checked take: Hard mode ≈ Nearly / ✓, the pass Got it', () => {
    const c = compareTranscription(SAID, CARD, '');
    const close = readTakeChecked(c, 'almost');
    expect(readTakeDeviceState(close)).toBe('close');
    expect(hardModeQuestionResult({ take: { status: 'done', isMatch: close.isMatch, containsExpected: close.containsExpected, tonesOff: !!close.tonesOff } })).toBe('close');
    const right = readTakeChecked(c, 'correct');
    expect(hardModeQuestionResult({ take: { status: 'done', isMatch: right.isMatch, containsExpected: right.containsExpected, tonesOff: !!right.tonesOff } })).toBe('right');
    expect(passSuggestion({ take: right })).toBe('right');
    expect(readTakeDeviceState(readTakeChecked(c, 'wrong'))).toBe('miss');
    // No check (offline / failed / still running): the device's verdict stands.
    expect(readTakeChecked(c, null)).toBe(c);
    // A device verdict that isn't ✗ is never overridden.
    const match = compareTranscription(CARD, CARD, '');
    expect(readTakeChecked(match, 'wrong')).toBe(match);
  });

  it('the reason under the take: Claude\'s headline; for ✗ its first tip too', () => {
    expect(readTakeReason(check('almost', 'You said 英语 — the card has 英文 (same meaning).', [{ text: 'tip' }]))).toEqual({ reason: 'You said 英语 — the card has 英文 (same meaning).', tip: null });
    expect(readTakeReason(check('wrong', 'That isn’t what the card says.', [{ text: 'Read 繁琐 again.' }]))).toEqual({ reason: 'That isn’t what the card says.', tip: 'Read 繁琐 again.' });
    expect(readTakeReason(check('wrong', 'Same.', [{ text: 'Same.' }]))).toEqual({ reason: 'Same.', tip: null });
  });
});
