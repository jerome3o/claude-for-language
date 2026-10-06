/** "next revisit 20 Oct" / "done for good" — the tutor's line for a student's lesson / reader ("revisit later"). */
export function nextRevisitLabel(item: { next_revisit_at?: string | null; retired?: boolean }): string | null {
  if (item.retired) return 'done for good';
  if (!item.next_revisit_at) return null;
  const d = new Date(item.next_revisit_at);
  if (d.getTime() <= Date.now()) return 'due now';
  return `next revisit ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}
