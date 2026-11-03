import { describe, expect, it } from 'vitest';
import { cardToolEffects, cardToolLines, earlierCardThreads, earlierCardThreadsLabel, parseCardToolResults, undoEditFields } from './cardTools';

const EDIT = {
  tool: 'edit_current_card',
  success: true,
  data: { note: { id: 'n1', hanzi: '银行', fun_facts: '银 silver · 行 business', updated_at: '2026-11-03T10:00:00Z', deck_id: 'd1' }, changes: { fun_facts: '银 silver · 行 business', sentence_clue_pinyin: 'x' } },
};

describe('card tools in a card thread', () => {
  it('parses the stored results, dropping anything unreadable', () => {
    expect(parseCardToolResults(null)).toEqual([]);
    expect(parseCardToolResults('nope')).toEqual([]);
    expect(parseCardToolResults('{"tool":"x"}')).toEqual([]);
    expect(parseCardToolResults(JSON.stringify([{ tool: 'bump_cards', success: true, data: { bumped: ['银行'] } }, { nope: 1 }, { tool: 'x', success: 'yes', error: 'bad' }]))).toEqual([
      { tool: 'bump_cards', success: true, data: { bumped: ['银行'] } },
      { tool: 'x', success: false, error: 'bad' },
    ]);
  });

  it('what the device does: the edited note, a delete, cards made, lessons, bumps — failures ignored', () => {
    const results = parseCardToolResults(
      JSON.stringify([
        EDIT,
        { tool: 'create_flashcards', success: true, data: { created: [{ hanzi: '存钱' }, { hanzi: '取钱' }], count: 2 } },
        { tool: 'create_flashcards', success: false, error: 'Target deck not found' },
        { tool: 'create_custom_lesson', success: true, data: { title: '银行 vs 很行' } },
        { tool: 'bump_cards', success: true, data: { bumped: ['存钱', '存钱'], already_bumped: ['取钱'] } },
        { tool: 'delete_current_card', success: true },
      ]),
    );
    expect(cardToolEffects(results)).toEqual({
      edited: { hanzi: '银行', fun_facts: '银 silver · 行 business', updated_at: '2026-11-03T10:00:00Z' },
      deleted: true,
      cardsAdded: 2,
      lessons: 1,
      bumped: ['存钱'],
    });
    expect(cardToolEffects([])).toEqual({ edited: null, deleted: false, cardsAdded: 0, lessons: 0, bumped: [] });
  });

  it('one line per result: the edit offers Undo, failures say why', () => {
    const lines = cardToolLines(
      parseCardToolResults(
        JSON.stringify([
          EDIT,
          { tool: 'create_flashcards', success: true, data: { created: [{ hanzi: '存钱' }], count: 1 } },
          { tool: 'create_custom_lesson', success: true, data: { title: '存钱和取钱' } },
          { tool: 'bump_cards', success: true, data: { bumped: [], already_bumped: ['银行'] } },
          { tool: 'bump_cards', success: true, data: { bumped: [], already_bumped: [] } },
          { tool: 'delete_current_card', success: true },
          { tool: 'edit_current_card', success: false, error: 'Failed to update note' },
          { tool: 'search_cards', success: true },
        ]),
      ),
    );
    expect(lines).toEqual([
      { kind: 'edited', text: '✓ Claude edited this card · notes, example sentence', undo: true },
      { kind: 'added', text: '✓ Added 1 card: 存钱', undo: false },
      { kind: 'lesson', text: '🎓 Mini lesson made: 存钱和取钱 — it’s on your Mini Lessons page', undo: false },
      { kind: 'bumped', text: '⚡ Already in today’s study: 银行', undo: false },
      { kind: 'deleted', text: '🗑 Claude deleted this card', undo: false },
      { kind: 'failed', text: '✗ Couldn’t edit this card: Failed to update note', undo: false },
    ]);
  });

  it('Undo puts back only the fields the edit changed', () => {
    expect(undoEditFields({ hanzi: '银行', fun_facts: null, pinyin: 'yínháng' }, { hanzi: '银行', fun_facts: 'new', pinyin: 'yínhang', updated_at: 'x' })).toEqual({ fun_facts: '', pinyin: 'yínháng' });
    expect(undoEditFields({ english: 'bank' }, {})).toEqual({});
  });

  it("the sheet's earlier threads: this card's, not archived, not the one on screen, newest first", () => {
    const t = (id: string, noteId: string, at: string | null, extra: object = {}) => ({ id, context_kind: 'card', context: { kind: 'card', note_id: noteId }, last_message_at: at, created_at: '2026-11-01T00:00:00Z', ...extra });
    const list = [t('a', 'n1', '2026-11-02T10:00:00Z'), t('b', 'n1', '2026-11-03T10:00:00Z'), t('c', 'n2', '2026-11-03T11:00:00Z'), t('d', 'n1', null, { archived: true }), t('e', 'n1', null), t('cur', 'n1', '2026-11-03T12:00:00Z')];
    expect(earlierCardThreads(list, 'n1', 'cur').map((x) => x.id)).toEqual(['b', 'a', 'e']);
    expect(earlierCardThreadsLabel('银行', 0)).toBeNull();
    expect(earlierCardThreadsLabel('银行', 1)).toBe('Earlier about 银行 · 1 chat');
    expect(earlierCardThreadsLabel('银行', 3)).toBe('Earlier about 银行 · 3 chats');
  });
});
