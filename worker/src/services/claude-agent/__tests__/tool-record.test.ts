/**
 * tool-record.ts: what Claude's tools did, told back to Claude on the next turns — built from the same
 * stored `tool_results` the apps draw their lines from; replayed by every history builder
 * (threadTextTurns / coachAskTurns, buildCoachHistory) and the memory's message text; a record Claude
 * writes itself is taken out of the stored answer.
 */
import { describe, expect, it } from 'vitest';
import type { CoachMessage } from '../../../types';
import { buildCoachHistory } from '../../coach-replies';
import { coachAskTurns } from '../../claude-chat';
import { memoryMessageText } from '../memory';
import { stripToolRecords, toolRecord, toolRecordLine, withToolRecord, TOOL_RECORD_OPEN } from '../tool-record';

const json = (v: unknown) => JSON.stringify(v);

function msg(id: string, role: 'user' | 'assistant', content: string, extra: Partial<CoachMessage> = {}): CoachMessage {
  return { id, conversation_id: 'c1', role, content_type: 'text', content, tool_results: null, created_at: `2026-11-08T10:00:0${id}Z`, status: null, ...extra };
}

describe('the record of a reply’s tools', () => {
  it('says what each tool did, by name, with the cards and the deck', () => {
    // A card turn (apply.ts) and the Coach's create_flashcards (coach-replies defaultApply) store different shapes.
    expect(toolRecordLine({ tool: 'create_flashcards', success: true, data: { created: [{ hanzi: '机会' }, { hanzi: '把握' }], count: 2, deck_name: 'HSK 3' } })).toBe(
      'create_flashcards: added 2 cards to the deck “HSK 3”: 机会、把握.',
    );
    expect(toolRecordLine({ tool: 'create_flashcards', success: true, data: { deck_name: 'HSK 2', notes: [{ hanzi: '熊猫' }] } })).toBe('create_flashcards: added 1 card to the deck “HSK 2”: 熊猫.');
    expect(toolRecordLine({ tool: 'create_flashcards', success: true, data: { created: [], count: 0 } })).toBe('create_flashcards: ran, but no card was added.');
    expect(toolRecordLine({ tool: 'create_flashcards', success: false, error: 'Target deck not found' })).toBe('create_flashcards: FAILED (Target deck not found) — no card was added.');
    expect(toolRecordLine({ tool: 'propose_flashcards', success: true, data: { flashcards: [{ hanzi: '机会' }] } })).toBe(
      'create_flashcards: proposed 1 card (机会) for the learner to review — nothing is saved unless they save them.',
    );
    expect(toolRecordLine({ tool: 'edit_current_card', success: true, data: { changes: { english: 'opportunity' } } })).toBe('edit_current_card: edited this card (english → “opportunity”).');
    expect(toolRecordLine({ tool: 'delete_current_card', success: true })).toBe('delete_current_card: deleted this card.');
    expect(toolRecordLine({ tool: 'create_custom_lesson', success: true, data: { title: '机会 vs 时机' } })).toBe('create_custom_lesson: made the mini lesson “机会 vs 时机” (on their Mini Lessons page).');
    expect(toolRecordLine({ tool: 'bump_cards', success: true, data: { bumped: ['机会'], already_bumped: [], not_found: ['时机'] } })).toBe(
      "bump_cards: put first in today's study: 机会; not in their decks: 时机.",
    );
  });

  it('is empty without results, and wraps the lines in ⟦app record … ⟧', () => {
    expect(toolRecord(null)).toBe('');
    expect(toolRecord('[]')).toBe('');
    expect(toolRecord('not json')).toBe('');
    expect(withToolRecord('你好', null)).toBe('你好');
    const record = toolRecord(json([{ tool: 'create_flashcards', success: true, data: { created: [{ hanzi: '机会' }], count: 1 } }]));
    expect(record.startsWith(TOOL_RECORD_OPEN)).toBe(true);
    expect(record.endsWith('⟧')).toBe(true);
    expect(record).toContain("- create_flashcards: added 1 card to the learner's decks: 机会.");
  });

  it('a record Claude copied into its answer is taken out; any other text is untouched', () => {
    expect(stripToolRecords('好的。\n\n⟦app record — what your tools actually did:\n- create_flashcards: added 1 card⟧')).toBe('好的。');
    expect(stripToolRecords('A ⟦app record x⟧ B')).toBe('A B');
    expect(stripToolRecords('  plain answer \n')).toBe('  plain answer \n');
  });
});

describe('every history builder replays the record after the reply it belongs to', () => {
  const results = json([{ tool: 'create_flashcards', success: true, data: { created: [{ hanzi: '这次机会很难得，你要好好把握。' }], count: 1, deck_name: '语法句型' } }]);
  const stored = [
    msg('1', 'user', '请你加一张卡片，关于机会。'),
    msg('2', 'assistant', '我已经加了一张新卡片。', { tool_results: results }),
    msg('3', 'user', 'What did you do?'),
  ];

  it('threads (card / general / reader / exercise / discuss): coachAskTurns', () => {
    const turns = coachAskTurns(stored);
    expect(turns[1]).toEqual({ role: 'assistant', content: `我已经加了一张新卡片。\n\n${toolRecord(results)}` });
    expect(turns[1].content).toContain('added 1 card to the deck “语法句型”: 这次机会很难得，你要好好把握。');
    expect(turns[2]).toEqual({ role: 'user', content: 'What did you do?' });
  });

  it('Sentence Coach follow-ups: buildCoachHistory', () => {
    const history = buildCoachHistory(stored, 'none');
    expect(history[1]).toEqual({ role: 'assistant', content: `我已经加了一张新卡片。\n\n${toolRecord(results)}` });
  });

  it('memory (thread summaries, read_chat): the reply’s text + what its tools did', () => {
    const text = memoryMessageText({ role: 'assistant', content_type: 'text', content: '我已经加了一张新卡片。', tool_results: results }, 400);
    expect(text).toBe('我已经加了一张新卡片。\n(Tools: create_flashcards: added 1 card to the deck “语法句型”: 这次机会很难得，你要好好把握。.)');
    expect(memoryMessageText({ role: 'user', content_type: 'text', content: 'hi', tool_results: results }, 400)).toBe('hi');
  });
});
