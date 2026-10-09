/**
 * "Ready to unlock" (docs/STUDY_SESSION.md "Unlockable lessons"): locked mini lessons, each with
 * what unlocks it — its podcast (▶ Listen) or the real-world task — and the unlock button. On the
 * Mini Lessons page; the Lab shows the same section on Today's mini lessons.
 */
import { Link } from 'react-router-dom';
import { lockedLessonLine, unlockButtonLabel, type LessonUnlock } from '@shared/lesson';
import './ReadyToUnlock.css';

export interface LockedLessonItem {
  id: string;
  title: string;
  icon: string | null;
  unlock: LessonUnlock;
  /** The linked audio lesson's title, when known on this device. */
  audioTitle?: string | null;
  /** The linked audio lesson was already heard to the end (before the lesson existed). */
  listened?: boolean;
}

export function ReadyToUnlock({ items, onUnlock, busyId }: {
  items: LockedLessonItem[];
  onUnlock: (item: LockedLessonItem) => void;
  busyId?: string | null;
}) {
  if (items.length === 0) return null;
  return (
    <section className="ready-unlock" data-testid="ready-to-unlock">
      <h2 className="ready-unlock-heading">🔒 Ready to unlock ({items.length})</h2>
      <p className="ready-unlock-sub">These wait until you&rsquo;ve done the real thing — then they come today.</p>
      <div className="ready-unlock-list">
        {items.map(item => (
          <div key={item.id} className="ready-unlock-row" data-testid={`locked-lesson-${item.id}`}>
            <div className="ready-unlock-icon" aria-hidden>🔒</div>
            <div className="ready-unlock-body">
              <div className="ready-unlock-title">{item.title}</div>
              <div className="ready-unlock-line">
                {lockedLessonLine(item.unlock, item.audioTitle)}
                {item.listened && <span className="ready-unlock-listened"> · listened ✓</span>}
              </div>
              <div className="ready-unlock-actions">
                {item.unlock.kind === 'audio_lesson' && (
                  <Link to={`/audio-lessons/${item.unlock.audio_lesson_id}`} className="btn btn-secondary btn-sm ready-unlock-btn">
                    ▶ Listen
                  </Link>
                )}
                <button
                  type="button"
                  className="btn btn-primary btn-sm ready-unlock-btn"
                  onClick={() => onUnlock(item)}
                  disabled={busyId === item.id}
                  data-testid={`unlock-${item.id}`}
                >
                  {unlockButtonLabel(item.unlock)}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
