/**
 * Turn parsed rows into a plan against the notes already in the deck:
 * add / update / unchanged / skip, with the field-level changes an update
 * would make. Matching is by normalised hanzi (Anki's "first field" rule).
 * Pasted blanks never blank an existing field.
 */
import { normalizeHanzi, type ParsedRow } from './parse';

export type ExistingPolicy = 'update' | 'skip' | 'duplicate';

export interface ExistingNote {
  id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts?: string | null;
  sentence_clue?: string | null;
}

export type UpdatableField = 'pinyin' | 'english' | 'fun_facts' | 'sentence_clue';

export interface FieldChange {
  field: UpdatableField;
  from: string;
  to: string;
}

export type PlannedAction = 'add' | 'update' | 'unchanged' | 'skip' | 'problem';

export interface PlannedRow {
  row: ParsedRow;
  action: PlannedAction;
  existing?: ExistingNote;
  changes: FieldChange[];
  /** Required fields still empty on an add (the UI can fill them in). */
  missing: Array<'pinyin' | 'english'>;
  /** Why a row is a problem or skipped, for the preview. */
  reason?: 'no_chinese' | 'duplicate_in_paste' | 'incomplete' | 'excluded' | 'policy';
}

export interface ImportSummary {
  add: number;
  update: number;
  unchanged: number;
  skipped: number;
  problems: number;
}

const norm = (s: string | null | undefined) => (s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

export function planImport(
  rows: ParsedRow[],
  existingNotes: ExistingNote[],
  policy: ExistingPolicy,
  excluded: ReadonlySet<number> = new Set()
): PlannedRow[] {
  const byHanzi = new Map<string, ExistingNote>();
  for (const n of existingNotes) {
    const key = normalizeHanzi(n.hanzi);
    if (key && !byHanzi.has(key)) byHanzi.set(key, n);
  }

  return rows.map(row => {
    if (row.problems.includes('no_chinese')) return { row, action: 'problem', changes: [], missing: [], reason: 'no_chinese' };
    if (row.problems.includes('duplicate_in_paste')) return { row, action: 'skip', changes: [], missing: [], reason: 'duplicate_in_paste' };
    if (excluded.has(row.index)) return { row, action: 'skip', changes: [], missing: [], reason: 'excluded' };

    const existing = byHanzi.get(normalizeHanzi(row.hanzi));
    if (!existing || policy === 'duplicate') {
      const missing: Array<'pinyin' | 'english'> = [];
      if (!norm(row.pinyin)) missing.push('pinyin');
      if (!norm(row.english)) missing.push('english');
      return missing.length
        ? { row, action: 'problem', changes: [], missing, reason: 'incomplete' }
        : { row, action: 'add', changes: [], missing };
    }
    if (policy === 'skip') return { row, action: 'skip', existing, changes: [], missing: [], reason: 'policy' };

    const changes: FieldChange[] = [];
    const consider = (field: UpdatableField, to: string, from: string | null | undefined) => {
      if (norm(to) && norm(to) !== norm(from)) changes.push({ field, from: norm(from), to: norm(to) });
    };
    consider('pinyin', row.pinyin, existing.pinyin);
    consider('english', row.english, existing.english);
    consider('fun_facts', row.notes, existing.fun_facts);
    consider('sentence_clue', row.sentence, existing.sentence_clue);
    return changes.length
      ? { row, action: 'update', existing, changes, missing: [] }
      : { row, action: 'unchanged', existing, changes: [], missing: [] };
  });
}

export function summarizePlan(plan: PlannedRow[]): ImportSummary {
  const s: ImportSummary = { add: 0, update: 0, unchanged: 0, skipped: 0, problems: 0 };
  for (const p of plan) {
    if (p.action === 'add') s.add++;
    else if (p.action === 'update') s.update++;
    else if (p.action === 'unchanged') s.unchanged++;
    else if (p.action === 'skip') s.skipped++;
    else s.problems++;
  }
  return s;
}
