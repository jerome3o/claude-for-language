import { useLiveQuery } from 'dexie-react-hooks';
import { savedRunBar } from '@shared/study/lessonRun';
import type { RetryBar } from '@shared/homework';
import { db } from '../../db/database';
import { stepOptions } from '../../services/lessonLearn';
import { useSkipHandwriting } from '../settings/SkipHandwritingSetting';

/**
 * The retry bar of every mini lesson with a run in progress on this device, by lesson id
 * (`savedRunBar`: blue answered, orange owed) — the bar on its homework / lesson row. A lesson not
 * started has none (no bar).
 */
export function useLessonRunBars(): Record<string, RetryBar | null> {
  const skip = useSkipHandwriting();
  return useLiveQuery(async () => {
    const runs = await db.lessonRuns.toArray().catch(() => []);
    if (runs.length === 0) return {};
    const rows = await db.customLessons.bulkGet(runs.map((r) => r.lesson_id));
    const out: Record<string, RetryBar | null> = {};
    runs.forEach((run, i) => {
      const spec = rows[i]?.spec;
      if (spec) out[run.lesson_id] = savedRunBar(run, run.lesson_id, spec, stepOptions(skip));
    });
    return out;
  }, [skip]) ?? {};
}
