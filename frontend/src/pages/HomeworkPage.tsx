import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useHomeworkItems } from '../components/homework/useHomeworkItems';
import { HomeworkRow } from '../components/homework/HomeworkRow';
import { HomeworkRowSlim, useHomeworkLessonRows, useSlimRowMenu } from '../components/home/HomeworkHomeCard';
import { useRowActions } from '../components/homework/RowActions';
import { useLessonRunBars } from '../components/homework/useLessonRunBars';
import { undoSkip, type HomeworkItem } from '../services/homework';
import { track } from '../services/analytics';
import { readHomeworkSnapshot, type HomeworkView } from '../components/home/useHomework';
import { Loading } from '../components/Loading';
import '../components/homework/homework.css';

const DONE_LIMIT = 10;

/**
 * All one-off homework: what's still to do (overdue first, with due labels)
 * and what's done, plus the mini lessons Home's card lists — revisions due and
 * new lessons a tutor sent for long-term review — so Home's "+N more" lands on
 * exactly those rows. Offline — reads IndexedDB; the sync keeps it current.
 */
export function HomeworkPage() {
  const items = useHomeworkItems();
  const view = useMemo<HomeworkView>(() => ({ pick: readHomeworkSnapshot(), progress: null, wordCount: null }), []);
  const lessonRows = useHomeworkLessonRows(view);
  const runBars = useLessonRunBars();
  const slimMenu = useSlimRowMenu('homework');
  const rowMenu = useRowActions('homework');
  const openItemMenu = (item: HomeworkItem) => rowMenu.open({
    kind: 'assignment',
    title: item.assignment.title,
    tutor_name: item.assignment.tutor_name ?? null,
    assignment_id: item.assignment.id,
    assignment_kind: item.assignment.kind,
    lesson_id: item.assignment.kind === 'lesson' ? item.assignment.target_id : null,
  });
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
            <p className="hw-muted" data-testid="hw-empty">
              {lessonRows && lessonRows.length > 0 ? 'No one-off homework right now.' : <>Nothing to do — you&rsquo;re all caught up. 🎉</>}
            </p>
          ) : (
            <div className="hw-list">
              {items.todo.map((item) => (
                <HomeworkRow key={item.assignment.id} item={item} showTutor runBar={runBars[item.assignment.target_id] ?? null} onMenu={openItemMenu} />
              ))}
            </div>
          )}
        </section>

        {lessonRows && lessonRows.length > 0 && (
          <section className="card hw-section" aria-label="Mini lessons" data-testid="hw-lesson-rows">
            <h2>Mini lessons</h2>
            <p className="hw-muted">Revisions due today and new lessons your tutor sent. Your own lessons are on <Link to="/lessons">Mini Lessons</Link>.</p>
            <div className="hw-slim-list">
              {lessonRows.map((row) => <HomeworkRowSlim key={row.key} row={row} onMenu={slimMenu.onMenu} />)}
            </div>
          </section>
        )}

        {items.skipped.length > 0 && (
          <section className="card hw-section" aria-label="Skipped" data-testid="hw-skipped">
            <h2>Skipped</h2>
            <p className="hw-muted">You skipped these — your tutor can see that. Bring one back any time.</p>
            <div className="hw-list">
              {items.skipped.map((item) => (
                <HomeworkRow
                  key={item.assignment.id}
                  item={item}
                  showTutor
                  action={(
                    <button
                      type="button"
                      className="hw-undo-skip"
                      data-testid="hw-undo-skip"
                      onClick={() => {
                        void undoSkip(item.assignment.id).then((ok) => {
                          if (ok) track('homework.skipped', { kind: item.assignment.kind, undo: true });
                        });
                      }}
                    >
                      Bring back
                    </button>
                  )}
                />
              ))}
            </div>
          </section>
        )}

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
      {slimMenu.element}
      {rowMenu.element}
    </div>
  );
}
