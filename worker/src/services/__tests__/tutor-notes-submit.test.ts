import { describe, it, expect } from 'vitest';
import { composeCallNotes } from '../tutor-notes-submit';

/**
 * A recorded video lesson as session notes: the transcript with speaker
 * labels and translations, the whiteboard's text, the in-call chat and the
 * lesson report, in an order the agent can read top-down.
 */

const names = { t1: 'Li (tutor)', s1: 'Jerome (student)' };

function seg(id: string, user_id: string, start: number, text: string, translation: string | null = null) {
  return { id, user_id, start_ms: 1_000_000 + start * 1000, end_ms: 1_000_000 + start * 1000 + 900, text, translation };
}

describe('composeCallNotes', () => {
  it('lays out report, whiteboard, chat and transcript with roles and times', () => {
    const notes = composeCallNotes({
      title: 'Restaurant role-play',
      startedAt: 1_000_000,
      names,
      transcript: [
        seg('a', 't1', 5, '今天我们练习点菜。', 'Today we practise ordering.'),
        seg('b', 's1', 12, '我要点菜。', 'I want to order.'),
        seg('c', 't1', 15, '很好，也可以说 我想点菜。', 'Good, you can also say 我想点菜.'),
      ],
      board: [
        { type: 'text', id: 'x', by: 't1', color: '#1f2937', x: 0.1, y: 0.1, size: 24, text: '想 + verb = would like to' },
        { type: 'stroke', id: 'y', by: 't1', color: '#1f2937', width: 3, points: [[0, 0], [1, 1]] },
      ],
      chat: [{ id: 'm1', user_id: 's1', name: 'Jerome', text: '菜单 = menu?', at: 1_000_020 }],
      report: {
        summary: 'You practised ordering food.',
        corrections: [{ said: '我要点菜', better: '我想点菜', pinyin: 'wǒ xiǎng diǎn cài', explanation: '想 is softer than 要 for a request.' }],
        follow_ups: ['Order something in Chinese this week.'],
      },
    });
    expect(notes).toMatch(/^Recorded video lesson: Restaurant role-play\nParticipants: Li \(tutor\), Jerome \(student\)/);
    expect(notes.indexOf('LESSON REPORT')).toBeLessThan(notes.indexOf('WRITTEN ON THE WHITEBOARD'));
    expect(notes.indexOf('WRITTEN ON THE WHITEBOARD')).toBeLessThan(notes.indexOf('IN-CALL CHAT'));
    expect(notes.indexOf('IN-CALL CHAT')).toBeLessThan(notes.indexOf('TRANSCRIPT'));
    expect(notes).toContain('- said "我要点菜" → better "我想点菜" (wǒ xiǎng diǎn cài): 想 is softer');
    expect(notes).toContain('想 + verb = would like to');
    expect(notes).not.toContain('stroke');
    expect(notes).toContain('Jerome (student): 菜单 = menu?');
    expect(notes).toContain('[0:05] Li (tutor): 今天我们练习点菜。\n    (Today we practise ordering.)');
    expect(notes).toContain('[0:12] Jerome (student): 我要点菜。');
  });

  it('is empty when the call has nothing to work from', () => {
    expect(composeCallNotes({ title: null, startedAt: null, names, transcript: [], board: [], chat: [], report: null })).toBe('');
  });

  it('still produces notes from the whiteboard alone and says no speech was transcribed', () => {
    const notes = composeCallNotes({
      title: null,
      startedAt: null,
      names,
      transcript: [],
      board: [{ type: 'text', id: 'x', by: 't1', color: '#1f2937', x: 0, y: 0, size: 20, text: '太…了' }],
      chat: [],
      report: null,
    });
    expect(notes).toContain('太…了');
    expect(notes).toContain('(no speech was transcribed)');
  });

  it('trims the middle of a very long transcript, keeping the start and the end', () => {
    const transcript = Array.from({ length: 4000 }, (_, i) => seg(`s${i}`, i % 2 ? 's1' : 't1', i * 3, `第${i}句，我们继续练习这个句型好不好。`));
    const notes = composeCallNotes({ title: null, startedAt: 1_000_000, names, transcript, board: [], chat: [], report: null });
    expect(notes.length).toBeLessThan(60_000);
    expect(notes).toContain('第0句');
    expect(notes).toContain('第3999句');
    expect(notes).toContain('middle of the lesson omitted');
  });
});
