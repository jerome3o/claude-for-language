import { useState } from 'react';
import { useHomeworkItems } from '../components/homework/useHomeworkItems';
import { HomeworkRow } from '../components/homework/HomeworkRow';
import { Loading } from '../components/Loading';
import '../components/homework/homework.css';

const DONE_LIMIT = 10;

/**
 * All one-off homework: what's still to do (overdue first, with due labels)
 * and what's done. Offline — reads IndexedDB; the sync keeps it current.
 */
export function HomeworkPage() {
  const items = useHomeworkItems();
  const [showAllDone, setShowAllDone] = useState(false);
  if (!items) return <Loading />;
  const done = showAllDone ? items.done : items.done.slice(0, DONE_LIMIT);
  return (
    <div className="page">
      <div className="container hw-page">
        <h1>Homework</h1>
        <p className="hw-muted">
          One-off practice your tutor set, with a date to have it done by. It isn&rsquo;t spaced repetition: go through each item once.
        </p>

        <section className="card hw-section" aria-label="To do">
          <h2>To do</h2>
          {items.todo.length === 0 ? (
            <p className="hw-muted" data-testid="hw-empty">Nothing to do — you&rsquo;re all caught up. 🎉</p>
          ) : (
            <div className="hw-list">
              {items.todo.map((item) => (
                <HomeworkRow key={item.assignment.id} item={item} showTutor />
              ))}
            </div>
          )}
        </section>

        {items.done.length > 0 && (
          <section className="card hw-section" aria-label="Done">
            <h2>Done</h2>
            <div className="hw-list">
              {done.map((item) => (
                <HomeworkRow key={item.assignment.id} item={item} showTutor />
              ))}
            </div>
            {!showAllDone && items.done.length > DONE_LIMIT && (
              <button type="button" className="btn-link" onClick={() => setShowAllDone(true)}>
                Show all {items.done.length}
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
