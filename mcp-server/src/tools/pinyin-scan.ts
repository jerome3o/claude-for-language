/**
 * The pinyin check of stored content (worker services/pinyin-scan.ts, POST /api/me/pinyin-scan):
 * the signed-in user's mini lessons (and the copies they assigned to students), library lessons and
 * graded readers, checked for pinyin that can't be right — a syllable its character never has
 * (扶梯 "fúqī" → "fútī") or syllables that don't line up with the characters. Readings the
 * character really has are never changed. Dry run by default.
 *
 * Tool: scan_content_pinyin.
 */
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { guard, jsonResult } from './context.js';

interface ScanFix { path: string; where: string; hanzi: string; before: string; after: string; reason: string }
interface ScanItem { kind: string; id: string; title: string; owner?: string; fixes: ScanFix[]; status?: string }
export interface ScanResponse {
  apply: boolean;
  kinds: string[];
  scanned: Record<string, number>;
  items: ScanItem[];
  fix_count: number;
  applied: number;
  report: string;
}

/** What the chat needs: the readable report first, then the items without JSON paths. Pure. */
export function shapeScan(r: ScanResponse) {
  return {
    dry_run: !r.apply,
    report: r.report,
    scanned: r.scanned,
    fix_count: r.fix_count,
    ...(r.apply ? { applied_items: r.applied } : {}),
    items: r.items.map((i) => ({
      kind: i.kind,
      id: i.id,
      title: i.title,
      ...(i.owner === 'student_copy' ? { student_copy: true } : {}),
      ...(i.status ? { status: i.status } : {}),
      fixes: i.fixes.map((f) => ({ where: f.where, hanzi: f.hanzi, before: f.before, after: f.after })),
    })),
    next: r.apply || !r.fix_count ? undefined : 'Nothing was written. Show the user the report; call again with dry_run: false only when they say to apply it.',
  };
}

export function registerPinyinScanTools(ctx: ToolContext): void {
  const { server, api } = ctx;
  server.tool(
    'scan_content_pinyin',
    "Check the pinyin of the user's stored content — their mini lessons (and lesson copies they assigned to students), library lessons and graded readers — for pinyin that can't be right: a syllable its character never has (扶梯 written \"fúqī\" → \"fútī\"), or syllables that don't line up with the characters (a syllable missing or extra → the line is rebuilt). A reading the character really has is never changed (还 hái / huán, 得 de / děi, 长 cháng / zhǎng), the hanzi is never touched, and a multiple-choice exercise's wrong options (sometimes deliberate tone distractors) are left alone. DRY RUN by default: returns a readable report (title, where, hanzi, before → after) and changes nothing. With dry_run: false — only when the user asked to apply it — the pinyin is corrected in place: same ids, completion history and review schedule kept, devices pick it up on their next sync, audio unchanged. New content is checked automatically when it is saved.",
    {
      dry_run: z.boolean().optional().describe('Default true: report only. false = write the corrections.'),
      kinds: z.array(z.enum(['lesson', 'library', 'reader'])).min(1).optional().describe('What to scan (default all three): lesson = mini lessons in the study session, library = library lessons, reader = graded readers.'),
    },
    async ({ dry_run, kinds }) => guard(async () => {
      const r = await api.post<ScanResponse>('/api/me/pinyin-scan', { apply: dry_run === false, ...(kinds ? { kinds } : {}) });
      const { report, ...rest } = shapeScan(r);
      // The report as plain text (readable line breaks), then the structured items.
      return { content: [{ type: 'text' as const, text: report }, ...jsonResult(rest).content] };
    }),
  );
}
