import { describe, expect, it } from 'vitest';
import { contextBadge, contextRef, intentsFor, parseClaudeContext, parseIntent, parseStoredContext, previewOf, titleFor } from './context';

describe('Claude thread contexts', () => {
  it('parses what an app sends, dropping unknown fields and refusing missing refs', () => {
    expect(parseClaudeContext({ kind: 'general', extra: 1 })).toEqual({ kind: 'general' });
    expect(parseClaudeContext({ kind: 'card', note_id: ' n1 ', typed: { answer: '银航', correct: '银行' }, junk: true })).toEqual({
      kind: 'card',
      note_id: 'n1',
      typed: { answer: '银航', correct: '银行' },
    });
    expect(parseClaudeContext({ kind: 'card' })).toBeNull();
    expect(parseClaudeContext({ kind: 'chat_message', message_id: 'm1', conversation_id: 'c1' })).toEqual({ kind: 'chat_message', message_id: 'm1', conversation_id: 'c1' });
    expect(parseClaudeContext({ kind: 'practice', conversation_id: 'c9', scenario: '点菜' })).toEqual({ kind: 'practice', conversation_id: 'c9', scenario: '点菜' });
    // A new role-play: a situation and / or a card's word (no conversation); nothing to practise → null.
    expect(parseClaudeContext({ kind: 'practice', scenario: ' 问路 ', level: 'beginner', note_id: 'n1', extra: 1 })).toEqual({ kind: 'practice', scenario: '问路', level: 'beginner', note_id: 'n1' });
    expect(parseClaudeContext({ kind: 'practice', ai_role: '服务员' })).toBeNull();
    expect(contextRef({ kind: 'practice', scenario: '问路' })).toBeNull();
    expect(parseClaudeContext({ kind: 'reader' })).toBeNull();
    expect(parseClaudeContext(null)).toBeNull();
    expect(parseClaudeContext({ kind: 'card', note_id: 'x'.repeat(101) })).toBeNull();
  });

  it('reads a stored descriptor + snapshot, tolerating NULL and bad JSON', () => {
    expect(parseStoredContext(null, null)).toEqual({ kind: 'general' });
    expect(parseStoredContext('card', '{not json')).toEqual({ kind: 'general' });
    expect(parseStoredContext('card', JSON.stringify({ kind: 'card', note_id: 'n1', label: '银行', sublabel: 'HSK 2' }))).toEqual({
      kind: 'card',
      note_id: 'n1',
      label: '银行',
      sublabel: 'HSK 2',
    });
  });

  it('gives each context its canonical ref', () => {
    expect(contextRef({ kind: 'general' })).toBeNull();
    expect(contextRef({ kind: 'card', note_id: 'n1' })).toBe('n1');
    expect(contextRef({ kind: 'chat_message', message_id: 'm1' })).toBe('m1');
    expect(contextRef({ kind: 'practice', conversation_id: 'c1' })).toBe('c1');
  });

  it('badges: the context, or the Coach button a general chat began with', () => {
    expect(contextBadge({ kind: 'card', note_id: 'n1', label: '银行' })).toEqual({ icon: '📇', text: 'Asked on card · 银行' });
    expect(contextBadge({ kind: 'practice', conversation_id: 'c', scenario: '点菜' })).toEqual({ icon: '🎭', text: 'Practice · 点菜' });
    expect(contextBadge({ kind: 'chat_message', message_id: 'm', label: '你去过银行吗？' })?.text).toBe('About a message · 你去过银行吗？');
    expect(contextBadge({ kind: 'general' })).toBeNull();
    expect(contextBadge({ kind: 'general' }, 'ask')).toBeNull();
    expect(contextBadge({ kind: 'general' }, 'check')).toEqual({ icon: '✏️', text: 'Check' });
  });

  it('titles from the first message (one line, ≤ 120), else a word for the context', () => {
    expect(titleFor({ kind: 'general' }, '  银行和\n行的读音 ')).toBe('银行和 行的读音');
    expect(titleFor({ kind: 'general' }, 'a'.repeat(200))).toHaveLength(120);
    expect(titleFor({ kind: 'card', note_id: 'n', label: '银行' }, '')).toBe('About 银行');
    expect(titleFor({ kind: 'practice', conversation_id: 'c', scenario: '点菜' }, '')).toBe('Practice: 点菜');
    expect(titleFor({ kind: 'general' }, '')).toBe('Chat with Claude');
    expect(previewOf('a\nb')).toBe('a b');
  });

  it('offers the Coach buttons only in a general chat', () => {
    expect(intentsFor('general')).toEqual(['ask', 'check', 'explain', 'translate']);
    expect(intentsFor('card')).toEqual(['ask']);
    expect(intentsFor('practice')).toEqual(['ask']);
    expect(parseIntent('explain')).toBe('explain');
    expect(parseIntent('quick')).toBeNull();
  });
});
