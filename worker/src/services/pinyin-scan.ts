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

import type { PinyinFix, PinyinWarning } from '@shared/pinyin/fixes';
import { pinyinFixSummary } from '@shared/pinyin/fixes';
import { checkSpecPinyin, type PinyinReadingSources } from './pinyin-check';

export const PINYIN_SCAN_KINDS = ['lesson', 'library', 'reader'] as const;
export type PinyinScanKind = (typeof PINYIN_SCAN_KINDS)[number];

export interface PinyinScanItem {
  kind: PinyinScanKind;
  id: string;
  title: string;
  /** lesson: whose account it is in ('mine', or the student's copy the caller assigned). */
  owner?: 'mine' | 'student_copy';
  fixes: PinyinFix[];
  /** Lines left as written that need a look (never written, also with apply). */
  warnings: PinyinWarning[];
  /** apply: written / skipped because it changed since the scan. */
  status?: 'applied' | 'changed_since_scan';
}

export interface PinyinScanResult {
  apply: boolean;
  kinds: PinyinScanKind[];
  /** How many items of each kind were looked at. */
  scanned: Record<PinyinScanKind, number>;
  /** Only the items with something to fix or to look at. */
  items: PinyinScanItem[];
  fix_count: number;
  /** Lines that need a look (not changed). */
  warning_count: number;
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
      const { fixes, warnings } = await checkSpecPinyin(spec, sources);
      if (!fixes.length && !warnings.length) continue;
      const item: PinyinScanItem = { kind: 'lesson', id: row.id, title: row.title, owner: row.user_id === userId ? 'mine' : 'student_copy', fixes, warnings };
      if (apply && fixes.length) {
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
      const { fixes, warnings } = await checkSpecPinyin(spec, sources);
      if (!fixes.length && !warnings.length) continue;
      const item: PinyinScanItem = { kind: 'library', id: row.id, title: row.title, fixes, warnings };
      if (apply && fixes.length) {
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
      const { fixes, warnings } = await checkSpecPinyin(spec, sources);
      if (!fixes.length && !warnings.length) continue;
      const item: PinyinScanItem = { kind: 'reader', id: reader.id, title: reader.title_english || reader.title_chinese, fixes, warnings };
      if (apply && fixes.length) {
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
  const warningCount = items.reduce((n, i) => n + i.warnings.length, 0);
  const applied = items.filter((i) => i.status === 'applied').length;
  return { apply, kinds, scanned, items, fix_count: fixCount, warning_count: warningCount, applied, report: scanReport(items, scanned, apply) };
}

const KIND_LABEL: Record<PinyinScanKind, string> = { lesson: 'Lesson', library: 'Library lesson', reader: 'Reader' };

/** One block per item with fixes (where, hanzi, before → after), then the lines that need a look. */
export function scanReport(items: readonly PinyinScanItem[], scanned: Record<PinyinScanKind, number>, apply: boolean): string {
  const looked = `Scanned ${scanned.lesson} lesson(s), ${scanned.library} library lesson(s), ${scanned.reader} reader(s).`;
  const total = items.reduce((n, i) => n + i.fixes.length, 0);
  const warned = items.reduce((n, i) => n + (i.warnings?.length ?? 0), 0);
  if (!total && !warned) return `${looked} Nothing to fix.`;
  const title = (item: PinyinScanItem) => `${KIND_LABEL[item.kind]} "${item.title}"${item.owner === 'student_copy' ? " (a student's copy you assigned)" : ''} [${item.id}]`;
  const parts: string[] = [];
  const withFixes = items.filter((i) => i.fixes.length);
  parts.push(
    total
      ? `${looked} ${total} pinyin line(s) in ${withFixes.length} item(s) ${apply ? 'corrected' : 'would be corrected (dry run — nothing written)'}:`
      : `${looked} Nothing to correct.`,
  );
  for (const item of withFixes) {
    const status = item.status === 'changed_since_scan' ? ' — NOT written: it changed since the scan, run again' : '';
    const lines = item.fixes.map((f) => `  - ${f.where}: ${f.hanzi}\n      ${f.before}\n    → ${f.after}   (${pinyinFixSummary(f)})`);
    parts.push(`${title(item)}${status}\n${lines.join('\n')}`);
  }
  if (warned) {
    const withWarnings = items.filter((i) => i.warnings?.length);
    parts.push(`Needs a look (not changed): ${warned} line(s) in ${withWarnings.length} item(s) whose syllables don't line up with the characters — nothing was guessed or rebuilt:`);
    for (const item of withWarnings) {
      const lines = item.warnings.map((w) => `  - ${w.where}: ${w.hanzi}\n      ${w.pinyin}\n      ${w.detail}`);
      parts.push(`${title(item)}\n${lines.join('\n')}`);
    }
  }
  return parts.join('\n\n');
}
