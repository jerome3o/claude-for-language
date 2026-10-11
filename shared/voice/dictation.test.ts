import { describe, expect, it } from 'vitest';
import {
  dictationAnswer,
  dictationControls,
  dictationLanguageHints,
  dictationOutcome,
  dictationSource,
  initialDictationMode,
  joinDictation,
  micErrorBlock,
  typedOutcome,
  voiceBlockReason,
  voiceButtonShown,
  VOICE_BLOCKS,
  type DictationState,
} from './dictation';

const voice = (phase: DictationState['phase'], failure: DictationState['failure'] = null): DictationState =>
  ({ mode: 'voice', phase, failure, blocked: null });

describe('voice-first text input rules', () => {
  it('opens in voice unless asked to type or speaking is off', () => {
    expect(initialDictationMode(undefined, null)).toBe('voice');
    expect(initialDictationMode('voice', null)).toBe('voice');
    expect(initialDictationMode('type', null)).toBe('type');
    expect(initialDictationMode('voice', 'offline')).toBe('type');
    expect(initialDictationMode('voice', 'denied')).toBe('type');
  });

  it('shows the study card row for each phase', () => {
    expect(dictationControls(voice('idle'))).toEqual(['type', 'say']);
    expect(dictationControls(voice('listening'))).toEqual(['cancel', 'stop']);
    expect(dictationControls(voice('finishing'))).toEqual(['cancel', 'finishing']);
    expect(dictationControls(voice('review'))).toEqual(['retake', 'edit', 'submit']);
    expect(dictationControls(voice('failed', 'empty'))).toEqual(['type', 'retake']);
    expect(dictationControls(voice('failed', 'failed'))).toEqual(['retry_upload', 'type', 'retake']);
    expect(dictationControls({ ...voice('idle'), mode: 'type' })).toEqual(['mic', 'submit_typed']);
  });

  it('falls back to typing with a reason, keeping the 🎤 when trying again could help', () => {
    expect(dictationControls({ ...voice('idle'), blocked: 'offline' })).toEqual(['submit_typed']);
    expect(dictationControls({ ...voice('idle'), blocked: 'unsupported' })).toEqual(['submit_typed']);
    expect(dictationControls({ ...voice('idle'), blocked: 'denied' })).toEqual(['mic', 'submit_typed']);
    expect(voiceButtonShown('mic_error')).toBe(true);
    for (const b of VOICE_BLOCKS) expect(voiceBlockReason(b)).toMatch(/type/i);
  });

  it('submits the transcript on review and the box when typing', () => {
    expect(dictationAnswer(voice('review'), ' 我喜欢猫 ', '', null)).toEqual({ text: '我喜欢猫', source: 'spoken' });
    expect(dictationAnswer(voice('listening'), '我喜欢', '', null)).toBeNull();
    expect(dictationAnswer(voice('review'), '  ', '', null)).toBeNull();
    const typing: DictationState = { ...voice('idle'), mode: 'type' };
    expect(dictationAnswer(typing, '', '你好', null)).toEqual({ text: '你好', source: 'typed' });
    expect(dictationAnswer(typing, '', '你好', '你好')).toEqual({ text: '你好', source: 'spoken' });
    expect(dictationAnswer(typing, '', '你们好', '你好')).toEqual({ text: '你们好', source: 'edited' });
    expect(dictationAnswer(typing, '', ' ', null)).toBeNull();
    expect(dictationAnswer({ ...voice('review'), blocked: 'offline' }, '我', '他', null)).toEqual({ text: '他', source: 'typed' });
  });

  it('joins a spoken take onto typed text', () => {
    expect(joinDictation('', '你好')).toBe('你好');
    expect(joinDictation('我想', '喝咖啡')).toBe('我想喝咖啡');
    expect(joinDictation('I would', 'like tea')).toBe('I would like tea');
    expect(joinDictation('我想', ' ')).toBe('我想');
    expect(joinDictation('coffee', '咖啡')).toBe('coffee咖啡');
  });

  it('maps errors, sources, outcomes and hints', () => {
    expect(micErrorBlock('NotAllowedError')).toBe('denied');
    expect(micErrorBlock('NotFoundError')).toBe('no_mic');
    expect(micErrorBlock('NotSupportedError')).toBe('unsupported');
    expect(micErrorBlock('AbortError')).toBe('mic_error');
    expect(micErrorBlock(null)).toBe('mic_error');
    expect(dictationSource('x', null)).toBe('typed');
    expect(dictationOutcome('filled')).toBe('edit');
    expect(dictationOutcome('submitted')).toBe('submitted');
    expect(dictationOutcome('nope')).toBeNull();
    expect(typedOutcome('edited')).toBe('edited');
    expect(typedOutcome('spoken')).toBe('submitted');
    expect(dictationLanguageHints('en')).toEqual(['en', 'zh']);
    expect(dictationLanguageHints(undefined)).toEqual(['zh', 'en']);
  });
});
