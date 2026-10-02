import { describe, it, expect } from 'vitest';
import { toolsForMessage, looksLikeChinese, learningToolsForMessage } from './messageTools';

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

import { manageToolsForMessage } from './messageTools';

describe('manageToolsForMessage (PR 2)', () => {
  const ids = (t: { id: string }[]) => t.map((x) => x.id);
  it('pin for anyone; edit + delete on my own messages', () => {
    expect(ids(manageToolsForMessage({ sender_id: 'me' }, false, 'me'))).toEqual(['pin', 'edit', 'delete']);
    expect(ids(manageToolsForMessage({ sender_id: 'other' }, false, 'me'))).toEqual(['pin']);
    expect(ids(manageToolsForMessage({ sender_id: 'other', pinned_at: 'x' }, false, 'me'))).toEqual(['unpin']);
  });
  it('photo caption editable, voice not', () => {
    const photo = manageToolsForMessage({ sender_id: 'me', attachment: { kind: 'image' } }, false, 'me');
    expect(photo.find((t) => t.id === 'edit')?.label).toBe('Edit caption');
    expect(ids(manageToolsForMessage({ sender_id: 'me', attachment: { kind: 'voice' } }, false, 'me'))).toEqual(['pin', 'delete']);
  });
  it('nothing on deleted / pending messages or in the Claude chat', () => {
    expect(manageToolsForMessage({ sender_id: 'me', deleted_at: 'x' }, false, 'me')).toEqual([]);
    expect(manageToolsForMessage({ sender_id: 'me', pending: true }, false, 'me')).toEqual([]);
    expect(manageToolsForMessage({ sender_id: 'me' }, true, 'me')).toEqual([]);
  });
});

describe('learningToolsForMessage (PR 3)', () => {
  it('a tutor can correct the student\'s text message, and edit / remove a correction', () => {
    expect(ids(learningToolsForMessage(zhOther, 'tutor', false, ME).menu)).toEqual(['make_cards', 'correct']);
    const corrected = { ...zhOther, correction: { text: '这个句子很地道！' } };
    const t = learningToolsForMessage(corrected, 'tutor', false, ME).menu;
    expect(ids(t)).toEqual(['make_cards', 'correct', 'remove_correction']);
    expect(t[1].label).toBe('Edit correction');
  });
  it('never on my own message, a photo / voice message, or for a student', () => {
    expect(ids(learningToolsForMessage(zhMine, 'tutor', false, ME).menu)).toEqual(['make_cards']);
    expect(ids(learningToolsForMessage({ ...zhOther, attachment: { kind: 'image' } }, 'tutor', false, ME).menu)).toEqual(['make_cards']);
    expect(ids(learningToolsForMessage(zhOther, 'student', false, ME).menu)).toEqual(['make_cards']);
  });
  it('the corrected person can make a card from the correction', () => {
    const mine = { ...zhMine, correction: { text: '我把作业做完了！' } };
    expect(ids(learningToolsForMessage(mine, 'student', false, ME).menu)).toEqual(['make_cards', 'correction_card']);
  });
  it('voice messages make cards from the transcript once there is one', () => {
    const voice = { sender_id: OTHER, content: '', attachment: { kind: 'voice', transcript: null } };
    expect(ids(learningToolsForMessage(voice, 'student', false, ME).menu)).toEqual([]);
    const done = { ...voice, attachment: { kind: 'voice', transcript: '你好' } };
    expect(ids(learningToolsForMessage(done, 'student', false, ME).menu)).toEqual(['make_cards']);
  });
  it('nothing on deleted or pending messages; the tutor chat replaces word-by-word and translate', () => {
    expect(learningToolsForMessage({ ...zhOther, deleted_at: 'x' }, 'tutor', false, ME).menu).toEqual([]);
    expect(learningToolsForMessage({ ...zhOther, pending: true }, 'tutor', false, ME).menu).toEqual([]);
    expect(learningToolsForMessage(zhOther, 'student', false, ME).replaces).toEqual(['word_by_word', 'translate']);
    const ai = learningToolsForMessage({ ...zhOther, sender_id: CLAUDE }, 'student', true, ME);
    expect(ai.replaces).toEqual([]);
    expect(ids(ai.menu)).toEqual(['make_cards']);
  });
});
