/**
 * Which piece of tutor homework the student home should surface, and how to
 * describe its progress in words. Pure functions — the hook feeds them data.
 */
import { CardQueue } from '../../types';

export interface HomeworkTutor {
  relationshipId: string;
  tutorId: string;
  tutorName: string;
}

export interface HomeworkDeckSource {
  relationshipId: string;
  /** The student's copy of the deck (decks.id in their account). */
  targetDeckId: string;
  sharedAt: string;
}

export interface HomeworkLessonSource {
  id: string;
  title: string;
  assignedBy: string | null;
  assignedRelationshipId: string | null;
  createdAt: string;
  status: 'active' | 'done';
}

export interface HomeworkMessage {
  conversationId: string;
  relationshipId: string | null;
  /** Preview text of the message, if the notification carried one. */
  text: string | null;
  createdAt: string;
}

export type HomeworkItem =
  | { kind: 'deck'; deckId: string; name: string; sentAt: string }
  | { kind: 'lesson'; lessonId: string; title: string; sentAt: string };

export interface HomeworkPick {
  tutorName: string;
  relationshipId: string;
  item: HomeworkItem | null;
  unreadMessage: HomeworkMessage | null;
}

export interface PickHomeworkInput {
  tutors: HomeworkTutor[];
  sharedDecks: HomeworkDeckSource[];
  lessons: HomeworkLessonSource[];
  unreadMessages: HomeworkMessage[];
  /** Local decks by id → display name; a shared deck that is gone locally is skipped. */
  localDecks: Map<string, string>;
}

/** "第三周作业：天气 (from tutor)" → "第三周作业：天气" — the card already says who sent it. */
export function stripFromTutorSuffix(name: string): string {
  return name.replace(/\s*\(from tutor\)\s*$/i, '').trim() || name;
}

function newestFirst(a: string, b: string): number {
  return b.localeCompare(a);
}

/**
 * Pick the newest thing a tutor sent (deck copied via share/invite, or a
 * lesson assigned from their library) plus the newest unread tutor message.
 * Returns null when there is nothing from any tutor.
 */
export function pickHomework(input: PickHomeworkInput): HomeworkPick | null {
  if (input.tutors.length === 0) return null;
  const byRelationship = new Map(input.tutors.map(t => [t.relationshipId, t]));
  const byTutorId = new Map(input.tutors.map(t => [t.tutorId, t]));

  const candidates: Array<{ item: HomeworkItem; tutor: HomeworkTutor }> = [];

  for (const shared of input.sharedDecks) {
    const tutor = byRelationship.get(shared.relationshipId);
    const localName = input.localDecks.get(shared.targetDeckId);
    if (!tutor || localName === undefined) continue;
    candidates.push({
      tutor,
      item: { kind: 'deck', deckId: shared.targetDeckId, name: stripFromTutorSuffix(localName), sentAt: shared.sharedAt },
    });
  }

  for (const lesson of input.lessons) {
    if (lesson.status !== 'active') continue;
    const tutor =
      (lesson.assignedRelationshipId && byRelationship.get(lesson.assignedRelationshipId)) ||
      (lesson.assignedBy && byTutorId.get(lesson.assignedBy)) ||
      null;
    if (!tutor) continue;
    candidates.push({
      tutor,
      item: { kind: 'lesson', lessonId: lesson.id, title: lesson.title, sentAt: lesson.createdAt },
    });
  }

  candidates.sort((a, b) => newestFirst(a.item.sentAt, b.item.sentAt));

  const unread = input.unreadMessages
    .filter(m => m.relationshipId && byRelationship.has(m.relationshipId))
    .sort((a, b) => newestFirst(a.createdAt, b.createdAt))[0] ?? null;

  const chosen = candidates[0];
  if (!chosen && !unread) return null;

  const tutor = chosen ? chosen.tutor : byRelationship.get(unread!.relationshipId!)!;
  // A message from a different tutor than the homework's sender is still worth
  // showing, but only when it belongs to the same relationship — otherwise
  // "Reply" would open the wrong chat.
  const messageForTutor = unread && unread.relationshipId === tutor.relationshipId ? unread : null;

  return {
    tutorName: tutor.tutorName,
    relationshipId: tutor.relationshipId,
    item: chosen ? chosen.item : null,
    unreadMessage: messageForTutor,
  };
}

export interface DeckProgressSummary {
  total: number;
  started: number;
  /** Up to two words with the most Again ratings, hanzi only. */
  needWork: string[];
}

export function summarizeHomeworkDeck(
  cards: Array<{ id: string; note_id: string; queue: CardQueue }>,
  notes: Array<{ id: string; hanzi: string }>,
  events: Array<{ card_id: string; rating: number }>,
  needWorkLimit = 2
): DeckProgressSummary {
  const noteByCard = new Map(cards.map(c => [c.id, c.note_id]));
  const hanziByNote = new Map(notes.map(n => [n.id, n.hanzi]));
  const agains = new Map<string, number>();
  for (const e of events) {
    if (e.rating !== 0) continue;
    const noteId = noteByCard.get(e.card_id);
    if (!noteId || !hanziByNote.has(noteId)) continue;
    agains.set(noteId, (agains.get(noteId) ?? 0) + 1);
  }
  const needWork = [...agains.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, needWorkLimit)
    .map(([noteId]) => hanziByNote.get(noteId)!);
  return {
    total: cards.length,
    started: cards.filter(c => c.queue !== CardQueue.NEW).length,
    needWork,
  };
}

/** "7 of 18 cards started · 刮风 and 晴天 need work" */
export function describeDeckProgress(summary: DeckProgressSummary): string {
  const { total, started, needWork } = summary;
  let head: string;
  if (total === 0) head = 'No cards yet';
  else if (started === 0) head = `Not started yet · ${total} ${total === 1 ? 'card' : 'cards'}`;
  else if (started >= total) head = `All ${total} cards started`;
  else head = `${started} of ${total} cards started`;

  if (needWork.length === 0) return head;
  const words = needWork.length === 1 ? needWork[0] : `${needWork[0]} and ${needWork[1]}`;
  return `${head} · ${words} ${needWork.length === 1 ? 'needs' : 'need'} work`;
}
