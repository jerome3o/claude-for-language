/**
 * Runs an import plan against the API: one request per row (the same
 * endpoints a hand-added word uses, so TTS and sentence sets are generated
 * exactly as usual), a few in flight at a time, with progress and per-row
 * failures reported instead of aborting the batch.
 */
import type { PlannedRow } from '@shared/import';
import { createNote, updateNote } from '../api/client';

export interface ImportProgress {
  done: number;
  total: number;
  /** The row being processed, for "Adding 苹果…". */
  current?: string;
}

export interface ImportOutcome {
  added: number;
  updated: number;
  failed: Array<{ row: PlannedRow; error: string }>;
}

const CONCURRENCY = 3;

export async function runImport(
  deckId: string,
  plan: PlannedRow[],
  onProgress?: (p: ImportProgress) => void
): Promise<ImportOutcome> {
  const work = plan.filter(p => p.action === 'add' || p.action === 'update');
  const outcome: ImportOutcome = { added: 0, updated: 0, failed: [] };
  let next = 0;
  let done = 0;
  onProgress?.({ done: 0, total: work.length });

  async function one(item: PlannedRow): Promise<void> {
    const r = item.row;
    if (item.action === 'add') {
      const note = await createNote(deckId, {
        hanzi: r.hanzi,
        pinyin: r.pinyin,
        english: r.english,
        fun_facts: r.notes || undefined,
      });
      if (r.sentence) {
        // createNote has no sentence field; the update also queues the clue's audio.
        await updateNote(note.id, { sentence_clue: r.sentence });
      }
      outcome.added++;
    } else if (item.action === 'update' && item.existing) {
      const updates: Parameters<typeof updateNote>[1] = {};
      for (const ch of item.changes) {
        if (ch.field === 'pinyin') updates.pinyin = ch.to;
        else if (ch.field === 'english') updates.english = ch.to;
        else if (ch.field === 'fun_facts') updates.fun_facts = ch.to;
        else if (ch.field === 'sentence_clue') updates.sentence_clue = ch.to;
      }
      await updateNote(item.existing.id, updates);
      outcome.updated++;
    }
  }

  async function worker(): Promise<void> {
    while (next < work.length) {
      const item = work[next++];
      onProgress?.({ done, total: work.length, current: item.row.hanzi });
      try {
        await one(item);
      } catch (err) {
        outcome.failed.push({ row: item, error: err instanceof Error ? err.message : String(err) });
      }
      done++;
      onProgress?.({ done, total: work.length, current: item.row.hanzi });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, worker));
  return outcome;
}
