import type { LocalReader } from '../db/database';
import type { QueueCounts } from '../types';
import type { ReaderFinishHow } from '../services/reader-study';
import { QueueCountsHeader } from './QueueCountsHeader';
import { ReaderView } from './reader/ReaderView';

/**
 * A graded reader shown inside a study session (or a homework pass): the one
 * reading view (components/reader/ReaderView.tsx, also the Readers list's
 * /readers/:id) with the session's top bar — its queue counts (or a
 * "Homework" label) and ✕.
 */
export function StudyReader({
  reader,
  counts,
  isFinishing,
  onFinish,
  onEnd,
}: {
  reader: LocalReader;
  /** The session's queue counts; omitted in the homework pass (a "Homework" label instead). */
  counts?: QueueCounts;
  isFinishing: boolean;
  /** Read: Finish was pressed, or the whole story was listened to the end. */
  onFinish: (timeSpentMs: number, how: ReaderFinishHow) => void;
  onEnd: () => void;
}) {
  return (
    <ReaderView
      reader={reader}
      source={counts ? 'session' : 'homework'}
      isFinishing={isFinishing}
      onFinish={onFinish}
      topbarStart={counts ? <QueueCountsHeader counts={counts} activeQueue={reader.queue} /> : <span className="study-topbar-label">Homework</span>}
      topbarEnd={(
        <button className="study-close-btn" onClick={onEnd} aria-label="End session">
          ✕
        </button>
      )}
    />
  );
}
