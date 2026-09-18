import { describe, it, expect } from 'vitest';
import { toolsForMessage, looksLikeChinese } from './messageTools';

const ME = 'user-me';
const OTHER = 'user-other';
const CLAUDE = 'claude-ai';

const zhMine = { sender_id: ME, content: '我把作业做完了。' };
const zhOther = { sender_id: OTHER, content: '这个句子很地道。' };
const enMine = { sender_id: ME, content: 'See you tomorrow!' };

const ids = (tools: { id: string }[]) => tools.map((t) => t.id);

describe('looksLikeChinese', () => {
  it('detects hanzi', () => {
    expect(looksLikeChinese('你好')).toBe(true);
    expect(looksLikeChinese('hello')).toBe(false);
    expect(looksLikeChinese('hello 你好')).toBe(true);
  });
});

describe('toolsForMessage — inline row', () => {
  it('is only Reply and Play, and Play only for Chinese content', () => {
    expect(ids(toolsForMessage(zhMine, 'student', false, ME).inline)).toEqual(['reply', 'play']);
    expect(ids(toolsForMessage(enMine, 'student', false, ME).inline)).toEqual(['reply']);
  });
});

describe('toolsForMessage — learner in a tutor chat', () => {
  it('offers Check my Chinese on own Chinese messages, never Translate', () => {
    const set = toolsForMessage(zhMine, 'student', false, ME);
    expect(set.isMine).toBe(true);
    expect(ids(set.menu)).toEqual(['react', 'check', 'discuss', 'copy']);
  });

  it('offers Translate + Word by word on the tutor’s Chinese messages, never Check', () => {
    const set = toolsForMessage(zhOther, 'student', false, ME);
    expect(set.isMine).toBe(false);
    expect(ids(set.menu)).toEqual(['react', 'translate', 'word_by_word', 'discuss', 'copy']);
    expect(set.menu.find((t) => t.id === 'translate')?.label).toBe('Translate & make flashcard');
  });

  it('drops the Chinese-only tools on an English message', () => {
    expect(ids(toolsForMessage(enMine, 'student', false, ME).menu)).toEqual(['react', 'discuss', 'copy']);
  });

  it('swaps Check for View corrections once a check flagged the message', () => {
    const flagged = { ...zhMine, check_status: 'needs_improvement' as const };
    expect(ids(toolsForMessage(flagged, 'student', false, ME).menu)).toContain('view_corrections');
    expect(ids(toolsForMessage(flagged, 'student', false, ME).menu)).not.toContain('check');
    const fine = { ...zhMine, check_status: 'correct' as const };
    expect(ids(toolsForMessage(fine, 'student', false, ME).menu)).toEqual(['react', 'discuss', 'copy']);
  });

  it('labels Discuss as a continuation when a discussion exists', () => {
    const set = toolsForMessage({ ...zhOther, has_discussion: true }, 'student', false, ME);
    expect(set.menu.find((t) => t.id === 'discuss')?.label).toBe('Continue discussion with Claude');
  });
});

describe('toolsForMessage — tutor', () => {
  it('never sees Check my Chinese on their own messages', () => {
    expect(ids(toolsForMessage(zhMine, 'tutor', false, ME).menu)).toEqual(['react', 'discuss', 'copy']);
  });

  it('gets "Make a card from this" (no word-by-word) on the student’s messages', () => {
    const set = toolsForMessage(zhOther, 'tutor', false, ME);
    expect(ids(set.menu)).toEqual(['react', 'translate', 'discuss', 'copy']);
    expect(set.menu.find((t) => t.id === 'translate')?.label).toBe('Make a card from this');
  });
});

describe('toolsForMessage — Claude practice chat', () => {
  it('treats the user as the learner on their own messages', () => {
    expect(ids(toolsForMessage(zhMine, 'student', true, ME).menu)).toContain('check');
    // Even a user whose relationship role somehow reads "tutor" is learning here.
    expect(ids(toolsForMessage(zhMine, 'tutor', true, ME).menu)).toContain('check');
  });

  it('offers Translate + Word by word on Claude’s messages', () => {
    const set = toolsForMessage({ sender_id: CLAUDE, content: '欢迎光临！请问几位？' }, 'student', true, ME);
    expect(ids(set.menu)).toEqual(['react', 'translate', 'word_by_word', 'discuss', 'copy']);
  });
});

describe('toolsForMessage — connectivity', () => {
  it('marks every AI / server tool as needing internet and the local ones as not', () => {
    const set = toolsForMessage(zhOther, 'student', false, ME);
    const all = [...set.inline, ...set.menu];
    const online = all.filter((t) => t.needsInternet).map((t) => t.id);
    const offline = all.filter((t) => !t.needsInternet).map((t) => t.id);
    expect(online).toEqual(['play', 'react', 'translate', 'word_by_word', 'discuss']);
    expect(offline).toEqual(['reply', 'copy']);
  });
});
