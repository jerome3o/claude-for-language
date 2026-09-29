import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { homeHomework, wordsMet, type HomeHomeworkRow, type LongTermHomework } from '@shared/homework';
import { tutorNotesHomeLine } from '@shared/tutor-notes';
import { db } from '../../db/database';
import { useHomeworkItems } from '../homework/useHomeworkItems';
import type { HomeworkView } from './useHomework';
import '../homework/homework.css';

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Long-term homework on the device: fsrs-mode deck / lesson assignments, plus the newest deck or
 * lesson a tutor sent before assignments existed (the old "From <tutor>" pick), each deck with
 * its words met, live from IndexedDB.
 */
function useLongTerm(view: HomeworkView): LongTermHomework[] | undefined {
  const pick = view.pick;
  const legacyKey = pick?.item ? `${pick.item.kind}:${pick.item.kind === 'deck' ? pick.item.deckId : pick.item.lessonId}` : '';
  return useLiveQuery(async () => {
    const assignments = await db.homeworkAssignments.toArray();
    const items: LongTermHomework[] = assignments
      .filter((a) => a.mode === 'fsrs' && a.status === 'active' && (a.kind === 'deck' || a.kind === 'lesson'))
      .map((a) => ({ kind: a.kind as 'deck' | 'lesson', target_id: a.target_id, title: a.title, tutor_name: a.tutor_name ?? null, sent_at: a.created_at, met: null, total: null }));
    const item = pick?.item;
    if (item && !assignments.some((a) => a.target_id === (item.kind === 'deck' ? item.deckId : item.lessonId))) {
      items.push(
        item.kind === 'deck'
          ? { kind: 'deck', target_id: item.deckId, title: item.name, tutor_name: pick.tutorName, sent_at: item.sentAt, met: null, total: null }
          : { kind: 'lesson', target_id: item.lessonId, title: item.title, tutor_name: pick.tutorName, sent_at: item.sentAt, met: null, total: null }
      );
    }
    for (const lt of items) {
      if (lt.kind !== 'deck') continue;
      const [cards, notes] = await Promise.all([
        db.cards.where('deck_id').equals(lt.target_id).toArray(),
        db.notes.where('deck_id').equals(lt.target_id).primaryKeys(),
      ]);
      if (notes.length === 0) continue; // not on this device yet
      const { met, total } = wordsMet(cards, notes as string[]);
      lt.met = met;
      lt.total = total;
    }
    return items;
  }, [legacyKey]);
}

function HomeworkRowSlim({ row }: { row: HomeHomeworkRow }) {
  return (
    <Link to={row.route} className="hw-slim" data-testid="home-hw-row" aria-label={`${row.title}, ${row.progress}${row.due ? `, ${row.due}` : ''}`}>
      <span className="hw-slim-icon" aria-hidden="true">{row.icon}</span>
      <span className="hw-slim-main">
        <span className="hw-slim-line">
          <span className="hw-slim-title" lang="zh">{row.title}</span>
          {row.progress && <span className="hw-slim-progress">{row.progress}</span>}
        </span>
        {row.fraction !== null && (
          <span className="hw-slim-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(row.fraction * 100)}%` }} />
          </span>
        )}
      </span>
      {row.due && <span className={`hw-slim-due hw-slim-due-${row.tone}`} data-testid="hw-due">{row.due}</span>}
    </Link>
  );
}

/**
 * Home's homework card, compact: one slim row per active item (title, "5 / 12", due label, a thin
 * bar); a tap opens it — the pass for one-off / both items (the lesson / reader player for those
 * kinds), the deck for long-term-only decks. An unread tutor message is one small line.
 * Hidden when there is nothing. Rows come from the shared `homeHomework` (Lab app: same rules).
 */
export function HomeworkHomeCard({ view }: { view: HomeworkView }) {
  const items = useHomeworkItems();
  const longTerm = useLongTerm(view);
  const unread = view.pick?.unreadMessage ?? null;
  const model = useMemo(
    () => homeHomework(items?.todo ?? [], longTerm ?? [], { unreadFrom: unread ? view.pick?.tutorName ?? null : null }),
    [items, longTerm, unread, view.pick?.tutorName]
  );
  if (!items || (model.rows.length === 0 && !unread)) return null;

  return (
    <section className="card hw-home" aria-label="Homework" data-testid="homework-home-card">
      <div className="hw-home-head">
        <h2>{model.heading}</h2>
        <Link to="/homework" className="hw-home-all">
          {model.more > 0 ? `+${model.more} more ›` : 'All ›'}
        </Link>
      </div>
      {model.rows.length > 0 && (
        <div className="hw-slim-list">
          {model.rows.map((row) => <HomeworkRowSlim key={row.key} row={row} />)}
        </div>
      )}
      {unread && view.pick && (
        <Link to={`/connections/${view.pick.relationshipId}/chat/${unread.conversationId}`} className="hw-home-message" data-testid="home-hw-message">
          <span aria-hidden="true">💬</span>
          <span className="hw-home-message-text">{unread.text ? `“${truncate(unread.text, 48)}”` : `New message from ${view.pick.tutorName}`}</span>
          <span className="hw-home-message-dot" aria-label="unread" />
        </Link>
      )}
    </section>
  );
}

/** "🗒 3 new notes from 明慧老师 ›" — only while a tutor note is unseen; opens /tutor-notes. */
export function TutorNotesHomeRow() {
  const line = useLiveQuery(async () => {
    const rows = await db.recordingNotes.toArray();
    return tutorNotesHomeLine(rows.filter((r) => r.seen_at === null));
  }, []);
  if (!line) return null;
  return (
    <Link to="/tutor-notes" className="card hw-notes-row" data-testid="home-tutor-notes">
      <span aria-hidden="true">🗒</span>
      <span className="hw-notes-row-text">{line}</span>
      <span className="hw-notes-row-chevron" aria-hidden="true">›</span>
    </Link>
  );
}
