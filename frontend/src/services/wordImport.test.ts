import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseWordList, planImport } from '@shared/import';
import { runImport } from './wordImport';

vi.mock('../api/client', () => ({
  createNote: vi.fn(async (_deckId: string, data: { hanzi: string }) => ({ id: `new-${data.hanzi}`, ...data })),
  updateNote: vi.fn(async (id: string, updates: Record<string, unknown>) => ({ id, ...updates })),
}));

import { createNote, updateNote } from '../api/client';

const existing = [{ id: 'n1', hanzi: '香蕉', pinyin: 'xiāng jiāo', english: 'banana', fun_facts: null, sentence_clue: null }];

describe('runImport', () => {
  beforeEach(() => {
    vi.mocked(createNote).mockClear();
    vi.mocked(updateNote).mockClear();
  });

  it('creates new notes (sentence included), updates changed ones, reports progress', async () => {
    const { rows } = parseWordList('苹果\tpíng guǒ\tapple\t我吃苹果。\n香蕉\txiāng jiāo\tbanana (fruit)\n葡萄');
    const plan = planImport(rows, existing, 'update');
    const progress: number[] = [];
    const out = await runImport('deck-1', plan, p => progress.push(p.done));
    expect(out).toEqual({ added: 1, updated: 1, failed: [] });
    expect(createNote).toHaveBeenCalledWith('deck-1', { hanzi: '苹果', pinyin: 'píng guǒ', english: 'apple', fun_facts: undefined, sentence_clue: '我吃苹果。' });
    expect(updateNote).not.toHaveBeenCalledWith('new-苹果', expect.anything());
    expect(updateNote).toHaveBeenCalledWith('n1', { english: 'banana (fruit)' });
    expect(progress[progress.length - 1]).toBe(2);
    // The incomplete row (葡萄) is a problem row and is not sent
    expect(createNote).toHaveBeenCalledTimes(1);
  });

  it('keeps going after a failed row and reports it', async () => {
    vi.mocked(createNote).mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const { rows } = parseWordList('苹果\tpíng guǒ\tapple\n葡萄\tpú tao\tgrape');
    const out = await runImport('deck-1', planImport(rows, [], 'update'));
    expect(out.added).toBe(1);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].row.row.hanzi).toBe('苹果');
    expect(out.failed[0].error).toBe('boom');
  });
});
