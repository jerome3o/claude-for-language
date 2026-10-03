/**
 * Taking homework back (worker/src/services/homework-removal.ts): the words of
 * the confirm sheet and the toast, shared by the web app and the Lab app
 * (android-lab core `HomeworkRemoval.kt`, parity-tested) so both say exactly
 * the same thing.
 */

export type RemovalKind = 'deck' | 'lesson' | 'reader';

/** What the removal preview endpoint answers, reduced to what the words need. */
export interface RemovalFacts {
  kind: RemovalKind;
  /** Deck / lesson / reader title as the tutor knows it. */
  title: string;
  /** Deck: words met / words in the copy. */
  words_met?: number;
  words_total?: number;
  /** Lesson: completions; reader: readings. */
  times?: number;
  /** The student already deleted their copy. */
  copy_gone?: boolean;
  /** Deck: "Also delete my copy" may be offered. */
  can_delete_source?: boolean;
}

export interface RemovalCopy {
  /** ⋯ menu item. */
  menuLabel: string;
  title: string;
  /** What happens to the student's progress, in plain words. */
  body: string;
  /** Where it goes / what stays. */
  detail: string;
  /** "Also delete my copy" when it applies, else null. */
  sourceOption: string | null;
  confirmLabel: string;
}

/** "Jerome Swannack" → "Jerome"; empty → "your student". */
export function studentFirstName(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return first || 'your student';
}

const PLACE: Record<RemovalKind, string> = { deck: 'decks', lesson: 'lessons', reader: 'readers' };

function times(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
}

/** The ⋯ menu item, e.g. "Remove from Jerome's decks". */
export function removalMenuLabel(kind: RemovalKind, studentName: string | null | undefined): string {
  return `Remove from ${studentFirstName(studentName)}'s ${PLACE[kind]}`;
}

/** "Undo — remove from Jerome" on a session-notes job card. */
export function removalUndoLabel(studentName: string | null | undefined): string {
  return `Undo — remove from ${studentFirstName(studentName)}`;
}

export function removalCopy(facts: RemovalFacts, studentName: string | null | undefined): RemovalCopy {
  const name = studentFirstName(studentName);
  const place = PLACE[facts.kind];
  const title = `Remove “${facts.title}” from ${name}'s ${place}?`;
  let body: string;
  let detail: string;
  if (facts.copy_gone) {
    body = `${name} already deleted their copy — nothing is lost.`;
    detail = 'It just leaves your Homework list.';
  } else if (facts.kind === 'deck') {
    const met = facts.words_met ?? 0;
    const total = facts.words_total ?? 0;
    body = met === 0
      ? `${name} hasn't started this — nothing is lost.`
      : `${name} has met ${met} of ${total} words; their progress on these words will be deleted.`;
    detail = `It disappears from ${name}'s phone on their next sync.`;
  } else {
    const n = facts.times ?? 0;
    const verb = facts.kind === 'lesson' ? 'done this lesson' : 'read this';
    body = n === 0
      ? `${name} hasn't ${verb} yet — nothing is lost.`
      : `${name} has ${verb} ${times(n)}; that history will be deleted.`;
    detail = facts.kind === 'lesson'
      ? `It disappears from ${name}'s phone on their next sync. The lesson stays in your library.`
      : `It disappears from ${name}'s phone on their next sync. Your reader stays.`;
  }
  return {
    menuLabel: removalMenuLabel(facts.kind, studentName),
    title,
    body,
    detail,
    sourceOption: facts.kind === 'deck' && facts.can_delete_source ? 'Also delete my copy' : null,
    confirmLabel: 'Remove',
  };
}

/** The toast after it went, e.g. "Removed “HSK 1” from Jerome's decks". */
export function removalToast(kind: RemovalKind, title: string, studentName: string | null | undefined, sourceDeleted = false): string {
  const base = `Removed “${title}” from ${studentFirstName(studentName)}'s ${PLACE[kind]}`;
  return sourceDeleted ? `${base} and deleted your copy` : base;
}
