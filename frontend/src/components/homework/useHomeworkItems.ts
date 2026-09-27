import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database';
import { sortHomeworkItems, toHomeworkItems, type HomeworkItem } from '../../services/homework';

/**
 * The student's one-off homework, live from IndexedDB (works offline): to-do
 * items overdue-first, then done ones. `null` while IndexedDB answers.
 */
export function useHomeworkItems(): { todo: HomeworkItem[]; done: HomeworkItem[] } | null {
  return (
    useLiveQuery(async () => {
      const [assignments, events] = await Promise.all([db.homeworkAssignments.toArray(), db.homeworkEvents.toArray()]);
      return sortHomeworkItems(toHomeworkItems(assignments, events));
    }, []) ?? null
  );
}
