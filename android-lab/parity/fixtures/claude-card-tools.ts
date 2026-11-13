/**
 * Claude's card tools in a card thread (shared/claude/cardTools.ts): parsing the stored results, the
 * device's effects, the lines under a reply, Undo's fields, the sheet's "Earlier about 银行".
 * Writes claude-card-tools.json; checked by core/…/claude/CardToolsParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cardToolEffects, cardToolLines, earlierCardThreads, earlierCardThreadsLabel, parseCardToolResults, undoEditFields } from '../../../shared/claude/cardTools';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: claude-card-tools <out-dir>');
mkdirSync(OUT, { recursive: true });

const RAWS: Array<string | null> = [
  null,
  '',
  'nope',
  '{"tool":"x"}',
  JSON.stringify([{ tool: 'bump_cards', success: true, data: { bumped: ['银行', '银行', ' '], already_bumped: ['取钱'] } }, { nope: 1 }, { tool: 'x', success: 'yes', error: 'bad' }, { tool: 3 }]),
  JSON.stringify([
    { tool: 'edit_current_card', success: true, data: { note: { id: 'n1', hanzi: '银行', fun_facts: '银 silver', sentence_clue: null, updated_at: '2026-11-03T10:00:00Z', deck_id: 'd1', interval: 3 }, changes: { fun_facts: '银 silver', sentence_clue_pinyin: 'x', english: 4 } } },
    { tool: 'create_flashcards', success: true, data: { created: [{ hanzi: '存钱' }, { hanzi: '取钱' }, { pinyin: 'x' }], count: 2 } },
    { tool: 'create_flashcards', success: true, data: { created: [{ hanzi: '钱包' }] } },
    { tool: 'create_flashcards', success: false, error: 'Target deck not found' },
    { tool: 'create_custom_lesson', success: true, data: { title: '  银行 vs 很行 ' } },
    { tool: 'create_custom_lesson', success: true },
    { tool: 'bump_cards', success: true, data: { bumped: [], already_bumped: ['银行'] } },
    { tool: 'bump_cards', success: true, data: { bumped: [] } },
    { tool: 'delete_current_card', success: true },
    { tool: 'edit_current_card', success: false, error: 'Failed to update note' },
    { tool: 'edit_current_card', success: false },
    { tool: 'search_cards', success: true },
    { tool: 'bump_cards', success: false, error: 'x' },
  ]),
  JSON.stringify([{ tool: 'edit_current_card', success: true, data: { changes: {} } }, { tool: 'create_flashcards', success: true, data: { count: 2.7 } }]),
  // The cards with their note ids (the tappable words): a card thread's `created`, every other chat's `notes`.
  JSON.stringify([
    { tool: 'create_flashcards', success: true, data: { created: [{ id: 'n1', hanzi: ' 机会 ', pinyin: 'jīhuì', english: 'opportunity', deck_id: 'x' }, { id: 'n2', hanzi: '难得', pinyin: 7 }, { id: 'n1', hanzi: '机会' }, { hanzi: '没有' }, { id: 'n3' }, 4, { id: ' ', hanzi: '好' }], count: 2, targetDeckId: 'd1', deck_name: 'From Claude' } },
    { tool: 'create_flashcards', success: true, data: { deck_id: 'd2', deck_name: 'HSK 2', deck_source_key: null, notes: [{ id: 'n4', hanzi: '这次机会很难得。', pinyin: 'zhè cì jīhuì hěn nándé.', english: '  ' }] } },
    { tool: 'create_flashcards', success: true, data: { notes: [{ id: 7, hanzi: 'y' }, { id: 'n5', hanzi: '取钱', english: 'withdraw money' }], deck_id: 5, created: 'nope' } },
  ]),
];

const results = RAWS.map((raw) => {
  const parsed = parseCardToolResults(raw);
  return { raw, parsed, effects: cardToolEffects(parsed), lines: cardToolLines(parsed) };
});

const undo = [
  { before: { hanzi: '银行', fun_facts: null, pinyin: 'yínháng' }, edited: { hanzi: '银行', fun_facts: 'new', pinyin: 'yínhang', updated_at: 'x' } },
  { before: { english: 'bank' }, edited: {} },
  { before: {}, edited: { sentence_clue: null, english: 'bank' } },
  { before: { sentence_clue: '我去银行', english: 'bank' }, edited: { sentence_clue: null, english: 'bank' } },
].map((c) => ({ ...c, out: undoEditFields(c.before as never, c.edited as never) }));

const t = (id: string, noteId: string, at: string | null, extra: Record<string, unknown> = {}) => ({
  id, context_kind: 'card', context: { kind: 'card', note_id: noteId }, last_message_at: at, created_at: '2026-11-01T00:00:00.000Z', archived: false, ...extra,
});
const THREADS = [
  t('a', 'n1', '2026-11-02T10:00:00.000Z'),
  t('b', 'n1', '2026-11-03T10:00:00.000Z'),
  t('c', 'n2', '2026-11-03T11:00:00.000Z'),
  t('d', 'n1', null, { archived: true }),
  t('e', 'n1', null),
  t('f', 'n1', '2026-11-03T10:00:00.000Z'),
  t('g', 'n1', '2026-11-03T12:00:00.000Z', { context_kind: 'general', context: { kind: 'general' } }),
  t('cur', 'n1', '2026-11-03T12:00:00.000Z'),
];
const earlier = [
  { noteId: 'n1', currentId: 'cur' },
  { noteId: 'n1', currentId: null },
  { noteId: 'n2', currentId: null },
  { noteId: 'n3', currentId: 'x' },
].map((c) => ({ ...c, out: earlierCardThreads(THREADS, c.noteId, c.currentId).map((x) => x.id) }));
const labels = [0, 1, 2, 5].map((n) => ({ n, out: earlierCardThreadsLabel('银行', n) }));

writeFileSync(join(OUT, 'claude-card-tools.json'), JSON.stringify({ results, undo, threads: THREADS, earlier, labels }));
