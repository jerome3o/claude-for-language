/**
 * Create, then send (Oct 2026): what a session-notes job made waits in the
 * tutor's account until they press "Send to <student>". The one rule for which
 * items are still unsent (worker services/tutor-notes-send.ts, the web job card,
 * the MCP `not_sent` list; Lab `HomeworkSend.kt`) and the button words.
 */
import { studentFirstName } from './removal';

/** The fields of a job result this rule reads (worker TutorNotesResult). */
export interface JobResultLike {
  deck?: { id: string; name: string; note_count: number; target_deck_id?: string; removed_at?: string };
  lessons?: Array<{ library_item_id: string; title: string; lesson_id?: string; removed_at?: string }>;
  reader?: { id: string; title_english: string; target_reader_id?: string; removed_at?: string };
}

export interface UnsentItem {
  /** "deck" | "lesson:<library_item_id>" | "reader" — what POST …/session-notes/:id/send takes. */
  key: string;
  kind: 'deck' | 'lesson' | 'reader';
  source_id: string;
  title: string;
}

/** Items still only in the tutor's account: not sent, not taken back, not empty. */
export function unsentJobItems(result: JobResultLike | null | undefined): UnsentItem[] {
  const out: UnsentItem[] = [];
  const d = result?.deck;
  if (d && d.note_count > 0 && !d.target_deck_id && !d.removed_at) out.push({ key: 'deck', kind: 'deck', source_id: d.id, title: d.name });
  for (const l of result?.lessons ?? []) {
    if (!l.lesson_id && !l.removed_at) out.push({ key: `lesson:${l.library_item_id}`, kind: 'lesson', source_id: l.library_item_id, title: l.title });
  }
  const r = result?.reader;
  if (r && !r.target_reader_id && !r.removed_at) out.push({ key: 'reader', kind: 'reader', source_id: r.id, title: r.title_english });
  return out;
}

/** "Send to Jerome" */
export function sendToLabel(studentName: string | null | undefined): string {
  return `Send to ${studentFirstName(studentName)}`;
}

/** "Send all 3 to Jerome" */
export function sendAllLabel(count: number, studentName: string | null | undefined): string {
  return `Send all ${count} to ${studentFirstName(studentName)}`;
}

/** The confirm line before a send. */
export function sendConfirmText(titles: string[], studentName: string | null | undefined): string {
  const name = studentFirstName(studentName);
  const what = titles.length === 1 ? `"${titles[0]}"` : `${titles.length} items (${titles.map((t) => `"${t}"`).join(', ')})`;
  return `Send ${what} to ${name} as homework? It shows up in their app on their next sync.`;
}

/** The toast after a send. */
export function sentToast(titles: string[], studentName: string | null | undefined): string {
  const name = studentFirstName(studentName);
  return titles.length === 1 ? `Sent "${titles[0]}" to ${name}` : `Sent ${titles.length} items to ${name}`;
}
