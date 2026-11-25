/**
 * VR world progress on this device (docs/VR_WORLDS.md "Tasks"): which tasks of each world have been
 * done (ever), the best time for a whole run, how many runs finished. Its own small IndexedDB
 * (`vr-worlds`), like the meme review's — nothing synced; reads never throw (private windows).
 */
import Dexie, { type Table } from 'dexie';

export interface WorldProgress {
  world_id: string;
  /** Task ids done at least once. */
  done: string[];
  best_ms: number | null;
  runs_finished: number;
  last_played: string;
}

class VrWorldsDB extends Dexie {
  progress!: Table<WorldProgress, string>;

  constructor() {
    super('vr-worlds');
    this.version(1).stores({ progress: 'world_id' });
  }
}

let dbInstance: VrWorldsDB | null = null;
function db(): VrWorldsDB {
  if (!dbInstance) dbInstance = new VrWorldsDB();
  return dbInstance;
}

export function emptyProgress(worldId: string): WorldProgress {
  return { world_id: worldId, done: [], best_ms: null, runs_finished: 0, last_played: new Date(0).toISOString() };
}

export async function getProgress(worldId: string): Promise<WorldProgress> {
  try {
    return (await db().progress.get(worldId)) ?? emptyProgress(worldId);
  } catch {
    return emptyProgress(worldId);
  }
}

export async function allProgress(): Promise<Map<string, WorldProgress>> {
  try {
    const rows = await db().progress.toArray();
    return new Map(rows.map((r) => [r.world_id, r]));
  } catch {
    return new Map();
  }
}

/** Pure: a task done (and, when `finishedMs` is given, a whole run finished in that time). */
export function withTaskDone(p: WorldProgress, taskId: string | null, finishedMs: number | null, now: Date): WorldProgress {
  const done = taskId && !p.done.includes(taskId) ? [...p.done, taskId] : p.done;
  return {
    ...p,
    done,
    best_ms: finishedMs === null ? p.best_ms : p.best_ms === null ? finishedMs : Math.min(p.best_ms, finishedMs),
    runs_finished: p.runs_finished + (finishedMs === null ? 0 : 1),
    last_played: now.toISOString(),
  };
}

export async function recordTask(worldId: string, taskId: string | null, finishedMs: number | null): Promise<WorldProgress> {
  const next = withTaskDone(await getProgress(worldId), taskId, finishedMs, new Date());
  try {
    await db().progress.put(next);
  } catch {
    /* storage blocked: progress just isn't remembered */
  }
  return next;
}
