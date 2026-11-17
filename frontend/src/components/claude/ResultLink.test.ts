import { describe, expect, it } from 'vitest';
import { CLAUDE_RETURN_MAX_AGE_MS, contextRefOf, readClaudeReturn, withoutClaudeReturn } from './ResultLink';
import { missingLessonLine } from '../../pages/LessonReplayPage';

describe('where he was when he opened a line under a Claude reply', () => {
  const now = 1_800_000_000_000;
  it('reads a recent remembered place, never an old or malformed one', () => {
    const ret = { thread_id: 't1', source: 'study_card', ref: 'n1', page: null, scroll: 240, at: now - 60_000 };
    expect(readClaudeReturn({ claudeReturn: ret, other: 1 }, now)).toEqual(ret);
    expect(readClaudeReturn({ claudeReturn: { ...ret, at: now - CLAUDE_RETURN_MAX_AGE_MS - 1 } }, now)).toBeNull();
    expect(readClaudeReturn({ claudeReturn: { thread_id: 't1' } }, now)).toBeNull();
    expect(readClaudeReturn(null, now)).toBeNull();
    expect(readClaudeReturn({ claudeReturn: { at: now, scroll: 'x', page: 3 } }, now)).toEqual({ thread_id: null, source: null, ref: null, page: 3, scroll: null, at: now });
  });

  it('a host clears it once its sheet is closed again, keeping the rest of the state', () => {
    expect(withoutClaudeReturn({ claudeReturn: {}, from: 'home' })).toEqual({ from: 'home' });
    expect(withoutClaudeReturn({ claudeReturn: {} })).toBeNull();
    expect(withoutClaudeReturn({ from: 'home' })).toEqual({ from: 'home' });
    expect(withoutClaudeReturn(null)).toBeNull();
  });

  it('what a thread is about: the card, the chat message, the reader, the lesson', () => {
    expect(contextRefOf({ kind: 'card', note_id: 'n1' })).toBe('n1');
    expect(contextRefOf({ kind: 'chat_message', message_id: 'm1' })).toBe('m1');
    expect(contextRefOf({ kind: 'reader', reader_id: 'r1' })).toBe('r1');
    expect(contextRefOf({ kind: 'exercise', lesson_id: 'L1' })).toBe('L1');
    expect(contextRefOf({ kind: 'general' })).toBeNull();
  });

  it('the player says what happened to a lesson that is not on this device', () => {
    expect(missingLessonLine('busy', true)).toBe('Getting the lesson…');
    expect(missingLessonLine('done', true)).toBe('This lesson isn’t there any more — it may have been deleted.');
    expect(missingLessonLine('idle', false)).toBe('This lesson isn’t on this device yet — it needs a connection.');
  });
});
