/**
 * Scan (and optionally fix) the pinyin of content already stored: the caller's mini lessons (and the
 * copies they assigned to students), library lessons and graded readers. Same check as on write
 * (services/pinyin-check.ts): only a syllable its character can't have, or pinyin whose syllables
 * can't be lined up with the characters, is corrected.
 *
 * Dry run by default. `apply` writes the corrected pinyin IN PLACE, the way a normal edit does:
 * - a lesson keeps its id, so its completion history and FSRS schedule carry over; `updated_at` is
 *   touched so devices pick it up on their next sync (the same write as lesson-images.ts);
 * - a library item keeps its version (only the pinyin changed; the students' copies are scanned
 *   themselves when they were assigned by the caller);
 * - a reader page keeps its id (and its word chips, picture and reading history).
 * Each write is conditional on the stored value being the one scanned, so a concurrent edit wins.
 * TTS clips are keyed by the Chinese text + voice, never the pinyin — nothing is regenerated.
 */

import type { PinyinFix } from '@shared/pinyin/fixes';
import { pinyinFixSummary } from '@shared/pinyin/fixes';
import { fixSpecPinyin, type PinyinReadingSources } from './pinyin-check';

export const PINYIN_SCAN_KINDS = ['lesson', 'library', 'reader'] as const;
export type PinyinScanKind = (typeof PINYIN_SCAN_KINDS)[number];

export interface PinyinScanItem {
  kind: PinyinScanKind;
  id: string;
  title: string;
  /** lesson: whose account it is in ('mine', or the student's copy the caller assigned). */
  owner?: 'mine' | 'student_copy';
  fixes: PinyinFix[];
  /** apply: written / skipped because it changed since the scan. */
  status?: 'applied' | 'changed_since_scan';
}

export interface PinyinScanResult {
  apply: boolean;
  kinds: PinyinScanKind[];
  /** How many items of each kind were looked at. */
  scanned: Record<PinyinScanKind, number>;
  /** Only the items with something to fix. */
  items: PinyinScanItem[];
  fix_count: number;
  applied: number;
  /** A readable summary, one line per fix. */
  report: string;
}

export function pickScanKinds(raw: unknown): PinyinScanKind[] | null {
  if (raw === undefined || raw === null) return [...PINYIN_SCAN_KINDS];
  if (!Array.isArray(raw)) return null;
  const kinds = [...new Set(raw)].filter((k): k is PinyinScanKind => (PINYIN_SCAN_KINDS as readonly unknown[]).includes(k));
  return kinds.length === raw.length && kinds.length > 0 ? kinds : null;
}

function parse(json: string | null): unknown {
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

interface LessonRow { id: string; title: string; spec: string; user_id: string }
interface LibraryRow { id: string; title: string; spec: string }
interface ReaderRow { id: string; title_english: string; title_chinese: string; vocabulary_used: string | null }
interface PageRow { id: string; reader_id: string; page_number: number; content_chinese: string; content_pinyin: string | null }

async function changed(db: D1Database, sql: string, params: unknown[]): Promise<boolean> {
  const r = await db.prepare(sql).bind(...params).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function scanContentPinyin(
  db: D1Database,
  userId: string,
  opts: { apply?: boolean; kinds?: PinyinScanKind[]; sources?: PinyinReadingSources } = {},
): Promise<PinyinScanResult> {
  const apply = opts.apply === true;
  const kinds = opts.kinds ?? [...PINYIN_SCAN_KINDS];
  const sources = opts.sources ?? {};
  const scanned: Record<PinyinScanKind, number> = { lesson: 0, library: 0, reader: 0 };
  const items: PinyinScanItem[] = [];

  if (kinds.includes('lesson')) {
    const rows = (await db
      .prepare('SELECT id, title, spec, user_id FROM custom_lessons WHERE user_id = ? OR assigned_by = ? ORDER BY created_at')
      .bind(userId, userId)
      .all<LessonRow>()).results;
    for (const row of rows) {
      scanned.lesson++;
      const spec = parse(row.spec);
      if (!spec) continue;
      const fixes = await fixSpecPinyin(spec, sources);
      if (!fixes.length) continue;
      const item: PinyinScanItem = { kind: 'lesson', id: row.id, title: row.title, owner: row.user_id === userId ? 'mine' : 'student_copy', fixes };
      if (apply) {
        const ok = await changed(db, `UPDATE custom_lessons SET spec = ?, updated_at = datetime('now') WHERE id = ? AND spec = ?`, [JSON.stringify(spec), row.id, row.spec]);
        item.status = ok ? 'applied' : 'changed_since_scan';
      }
      items.push(item);
    }
  }

  if (kinds.includes('library')) {
    const rows = (await db
      .prepare('SELECT id, title, spec FROM lesson_library WHERE owner_id = ? AND archived_at IS NULL ORDER BY created_at')
      .bind(userId)
      .all<LibraryRow>()).results;
    for (const row of rows) {
      scanned.library++;
      const spec = parse(row.spec);
      if (!spec) continue;
      const fixes = await fixSpecPinyin(spec, sources);
      if (!fixes.length) continue;
      const item: PinyinScanItem = { kind: 'library', id: row.id, title: row.title, fixes };
      if (apply) {
        const ok = await changed(db, `UPDATE lesson_library SET spec = ?, updated_at = datetime('now') WHERE id = ? AND spec = ?`, [JSON.stringify(spec), row.id, row.spec]);
        item.status = ok ? 'applied' : 'changed_since_scan';
      }
      items.push(item);
    }
  }

  if (kinds.includes('reader')) {
    const readers = (await db
      .prepare('SELECT id, title_english, title_chinese, vocabulary_used FROM graded_readers WHERE user_id = ? ORDER BY created_at')
      .bind(userId)
      .all<ReaderRow>()).results;
    const pages = (await db
      .prepare(`SELECT p.id, p.reader_id, p.page_number, p.content_chinese, p.content_pinyin
                FROM reader_pages p JOIN graded_readers r ON r.id = p.reader_id
                WHERE r.user_id = ? ORDER BY p.reader_id, p.page_number`)
      .bind(userId)
      .all<PageRow>()).results;
    const pagesByReader = new Map<string, PageRow[]>();
    for (const p of pages) pagesByReader.set(p.reader_id, [...(pagesByReader.get(p.reader_id) ?? []), p]);
    for (const reader of readers) {
      scanned.reader++;
      const vocab = parse(reader.vocabulary_used);
      const own = pagesByReader.get(reader.id) ?? [];
      const spec = {
        vocabulary_used: Array.isArray(vocab) ? vocab : [],
        pages: own.map((p) => ({ content_chinese: p.content_chinese, content_pinyin: p.content_pinyin ?? '' })),
      };
      const fixes = await fixSpecPinyin(spec, sources);
      if (!fixes.length) continue;
      const item: PinyinScanItem = { kind: 'reader', id: reader.id, title: reader.title_english || reader.title_chinese, fixes };
      if (apply) {
        let ok = true;
        const vocabFixed = fixes.some((f) => f.path.startsWith('vocabulary_used'));
        if (vocabFixed) {
          ok = (await changed(db, 'UPDATE graded_readers SET vocabulary_used = ? WHERE id = ? AND vocabulary_used = ?', [JSON.stringify(spec.vocabulary_used), reader.id, reader.vocabulary_used])) && ok;
        }
        for (const f of fixes) {
          const m = /^pages\[(\d+)\]\.content_pinyin$/.exec(f.path);
          if (!m) continue;
          const page = own[Number(m[1])];
          ok = (await changed(db, 'UPDATE reader_pages SET content_pinyin = ? WHERE id = ? AND content_pinyin = ?', [f.after, page.id, page.content_pinyin ?? ''])) && ok;
        }
        item.status = ok ? 'applied' : 'changed_since_scan';
      }
      items.push(item);
    }
  }

  const fixCount = items.reduce((n, i) => n + i.fixes.length, 0);
  const applied = items.filter((i) => i.status === 'applied').length;
  return { apply, kinds, scanned, items, fix_count: fixCount, applied, report: scanReport(items, scanned, apply) };
}

const KIND_LABEL: Record<PinyinScanKind, string> = { lesson: 'Lesson', library: 'Library lesson', reader: 'Reader' };

/** One block per item, one line per fix: where, hanzi, before → after. */
export function scanReport(items: readonly PinyinScanItem[], scanned: Record<PinyinScanKind, number>, apply: boolean): string {
  const looked = `Scanned ${scanned.lesson} lesson(s), ${scanned.library} library lesson(s), ${scanned.reader} reader(s).`;
  if (!items.length) return `${looked} Nothing to fix.`;
  const total = items.reduce((n, i) => n + i.fixes.length, 0);
  const head = `${looked} ${total} pinyin line(s) in ${items.length} item(s) ${apply ? 'corrected' : 'would be corrected (dry run — nothing written)'}:`;
  const blocks = items.map((item) => {
    const owner = item.owner === 'student_copy' ? " (a student's copy you assigned)" : '';
    const status = item.status === 'changed_since_scan' ? ' — NOT written: it changed since the scan, run again' : '';
    const lines = item.fixes.map((f) => `  - ${f.where}: ${f.hanzi}\n      ${f.before}\n    → ${f.after}${f.reason === 'reading' ? `   (${pinyinFixSummary(f)})` : '   (syllables did not line up — line rebuilt)'}`);
    return `${KIND_LABEL[item.kind]} "${item.title}"${owner} [${item.id}]${status}\n${lines.join('\n')}`;
  });
  return [head, ...blocks].join('\n\n');
}
