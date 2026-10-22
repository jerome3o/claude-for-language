/**
 * The tutor's line for a student's mini lesson (shared/study/lessonRevision.ts — revise until right
 * first time): "Revision 2 due 29 Oct · 3 to get right" / "all right first time", from the server's
 * `revision_label`; an older server's "next revisit" date as a fallback.
 */
export function nextRevisitLabel(item: { revision_label?: string | null; next_revisit_at?: string | null; retired?: boolean }): string | null {
  if (item.revision_label) return item.revision_label;
  if (item.retired) return 'done';
  if (!item.next_revisit_at) return null;
  const d = new Date(item.next_revisit_at);
  if (d.getTime() <= Date.now()) return 'revision due';
  return `revision ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}
