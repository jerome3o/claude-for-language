/**
 * The VR worlds task engine (docs/VR_WORLDS.md "The task language"): one task at a time, checked
 * live against a snapshot of the world (where every object is, what the learner holds, object states)
 * plus the events since the last tick (grab / release / throw / use / inspect). Pure: the scene
 * builds snapshots from the physics bodies ~10× a second and feeds them in; unit tests feed
 * hand-made ones.
 *
 * Ideas from the 2D quests (shared/quest): declarative conditions, sequences that remember how far
 * they got, "performed" for verbs — adapted to 3D (zones, surfaces, throwing, counting).
 */
import { distance, inBox, insideRegion, objectById, surfaceRegion, type Box3 } from './geometry';
import type {
  Vec3, WorldAction, WorldCondition, WorldEvent, WorldObjectSnapshot, WorldSnapshot, WorldSpec, WorldTaskSpec,
} from './types';

/** Released faster than this (m/s) = thrown. */
export const THROW_SPEED = 1.4;
/** Slower than this (m/s) = settled (resting on a surface). */
export const SETTLED_SPEED = 0.25;
/** Lying in a zone: not held and slower than this (a bounce through the basket doesn't count). */
export const LYING_SPEED = 0.6;
/** Default `near` distance (m). */
export const NEAR_DISTANCE = 0.3;
/** After this long on one task (ms) its targets glow. */
export const HINT_AFTER_MS = 40_000;

export interface WorldRun {
  worldId: string;
  startedAt: number;
  /** The task being played (= tasks.length when all are done). */
  taskIndex: number;
  taskStartedAt: number;
  done: string[];
  finishedAt: number | null;
  /** Sequence progress per condition path ("0.1") of the current task. */
  seq: Record<string, number>;
  /** `action:obj` done since the current task started. */
  performed: string[];
  /** Objects in flight since a throw: obj → when released (ms). */
  airborne: Record<string, number>;
  /** `obj|zone` an airborne object passed through since the current task started. */
  thrownInto: string[];
}

export function startRun(world: Pick<WorldSpec, 'id'>, now: number, firstTask = 0): WorldRun {
  return {
    worldId: world.id,
    startedAt: now,
    taskIndex: firstTask,
    taskStartedAt: now,
    done: [],
    finishedAt: null,
    seq: {},
    performed: [],
    airborne: {},
    thrownInto: [],
  };
}

export function currentTask(world: Pick<WorldSpec, 'tasks'>, run: WorldRun): WorldTaskSpec | null {
  return world.tasks[run.taskIndex] ?? null;
}

/** Object ids a target names: `cup`, or every object tagged `fruit` for `#fruit`. */
export function resolveTarget(world: Pick<WorldSpec, 'objects'>, target: string): string[] {
  if (target.startsWith('#')) {
    const tag = target.slice(1);
    return world.objects.filter((o) => (o.tags ?? []).includes(tag)).map((o) => o.id);
  }
  return objectById(world, target) ? [target] : [];
}

/** Every zone ref's world box at this moment: zones, and objects' insides (they move with the object). */
export function zoneBox(world: WorldSpec, ref: string, snap: WorldSnapshot): Box3 | null {
  const z = (world.zones ?? []).find((x) => x.id === ref);
  if (z) return { min: z.min, max: z.max };
  const o = objectById(world, ref);
  if (!o || !o.inside) return null;
  const s = snap.objects[o.id];
  return insideRegion(o, s?.pos ?? o.at, s?.yaw ?? o.yaw ?? 0);
}

/** "On" regions: a surface object's top (moving with it), or a zone. */
export function surfaceBox(world: WorldSpec, ref: string, snap: WorldSnapshot): Box3 | null {
  const o = objectById(world, ref);
  if (o && o.surface) {
    const s = snap.objects[o.id];
    return surfaceRegion(o, s?.pos ?? o.at, s?.yaw ?? o.yaw ?? 0);
  }
  const z = (world.zones ?? []).find((x) => x.id === ref);
  return z ? { min: z.min, max: z.max } : null;
}

/** Every zone ref an object can be inside (for thrown_into latching). */
function allZoneRefs(world: WorldSpec): string[] {
  return [...(world.zones ?? []).map((z) => z.id), ...world.objects.filter((o) => o.inside).map((o) => o.id)];
}

/** The world as it is before anything moves: every object at `at`, nothing held, initial states. */
export function initialSnapshot(world: WorldSpec, t = 0): WorldSnapshot {
  const objects: Record<string, WorldObjectSnapshot> = {};
  for (const o of world.objects) {
    const states: Record<string, string> = {};
    for (const s of o.states ?? []) states[s.key] = s.initial;
    objects[o.id] = { pos: [...o.at] as Vec3, yaw: o.yaw ?? 0, speed: 0, held: false, states };
  }
  return { t, player: [world.spawn.at[0], world.spawn.at[1] + 1.6, world.spawn.at[2]], objects };
}

interface EvalCtx {
  world: WorldSpec;
  snap: WorldSnapshot;
  run: WorldRun;
}

function lying(o: WorldObjectSnapshot | undefined): o is WorldObjectSnapshot {
  return !!o && !o.held && o.speed < LYING_SPEED;
}

function evalCond(c: WorldCondition, ctx: EvalCtx, path: string): boolean {
  const { world, snap, run } = ctx;
  const objs = (t: string) => resolveTarget(world, t).map((id) => [id, snap.objects[id]] as const);
  if ('holding' in c) return objs(c.holding).some(([, o]) => !!o?.held);
  if ('in_zone' in c) {
    return objs(c.in_zone).some(([id, o]) => {
      if (id === c.zone || !lying(o)) return false;
      const b = zoneBox(world, c.zone, snap);
      return !!b && inBox(o.pos, b);
    });
  }
  if ('on' in c) {
    return objs(c.on).some(([id, o]) => {
      if (id === c.surface || !o || o.held || o.speed >= SETTLED_SPEED) return false;
      const b = surfaceBox(world, c.surface, snap);
      return !!b && inBox(o.pos, b);
    });
  }
  if ('near' in c) {
    const within = c.within ?? NEAR_DISTANCE;
    const others = objs(c.to);
    return objs(c.near).some(([id, a]) => !!a && others.some(([id2, b]) => id2 !== id && !!b && distance(a.pos, b.pos) <= within));
  }
  if ('state' in c) return snap.objects[c.state]?.states[c.key] === c.value;
  if ('thrown_into' in c) {
    const ids = resolveTarget(world, c.thrown_into);
    return run.thrownInto.some((k) => {
      const [obj, zone] = k.split('|');
      return zone === c.zone && ids.includes(obj);
    });
  }
  if ('count_in_zone' in c) {
    const b = zoneBox(world, c.zone, snap);
    if (!b) return false;
    const n = objs(c.count_in_zone).filter(([id, o]) => id !== c.zone && lying(o) && inBox(o.pos, b)).length;
    return n >= c.n;
  }
  if ('player_in' in c) {
    const b = zoneBox(world, c.player_in, snap);
    if (!b) return false;
    // On the floor plan: the head's x / z inside, any height.
    return snap.player[0] >= b.min[0] && snap.player[0] <= b.max[0] && snap.player[2] >= b.min[2] && snap.player[2] <= b.max[2];
  }
  if ('performed' in c) {
    if (!c.target) return run.performed.some((k) => k.startsWith(`${c.performed}:`));
    const ids = resolveTarget(world, c.target);
    return ids.some((id) => run.performed.includes(`${c.performed}:${id}`));
  }
  if ('not' in c) return !evalCond(c.not, ctx, `${path}.n`);
  if ('all_of' in c) return c.all_of.every((x, i) => evalCond(x, ctx, `${path}.${i}`));
  if ('any_of' in c) return c.any_of.some((x, i) => evalCond(x, ctx, `${path}.${i}`));
  if ('sequence' in c) {
    let i = run.seq[path] ?? 0;
    while (i < c.sequence.length && evalCond(c.sequence[i], ctx, `${path}.${i}`)) i++;
    run.seq[path] = i;
    return i >= c.sequence.length;
  }
  return false;
}

/** Evaluates a condition on its own (no run state: sequences start from scratch, nothing performed). */
export function conditionHolds(world: WorldSpec, cond: WorldCondition, snap: WorldSnapshot): boolean {
  const run = startRun(world, snap.t);
  return evalCond(cond, { world, snap, run }, '0');
}

/** How far the current task's top-level sequence has got (for a "step 1 of 2" line), else null. */
export function sequenceProgress(task: WorldTaskSpec | null, run: WorldRun): { step: number; of: number } | null {
  if (!task || !('sequence' in task.done)) return null;
  return { step: Math.min(run.seq['0'] ?? 0, task.done.sequence.length), of: task.done.sequence.length };
}

export interface StepResult {
  run: WorldRun;
  /** The task that was completed on this tick, if any. */
  completed: WorldTaskSpec | null;
  /** Every task is done (this tick or earlier). */
  finished: boolean;
}

function record(run: WorldRun, action: WorldAction, obj: string) {
  const key = `${action}:${obj}`;
  if (!run.performed.includes(key)) run.performed.push(key);
}

/**
 * One tick: fold the events in (performed, throws), latch thrown-into zones, evaluate the current
 * task; on success move to the next one (its own sequences / latches start fresh).
 */
export function stepRun(world: WorldSpec, prev: WorldRun, snap: WorldSnapshot, events: readonly WorldEvent[] = []): StepResult {
  const run: WorldRun = {
    ...prev,
    done: [...prev.done],
    seq: { ...prev.seq },
    performed: [...prev.performed],
    airborne: { ...prev.airborne },
    thrownInto: [...prev.thrownInto],
  };
  for (const e of events) {
    record(run, e.type, e.obj);
    if (e.type === 'grab') delete run.airborne[e.obj];
    if ((e.type === 'release' && (e.speed ?? 0) >= THROW_SPEED) || e.type === 'throw') {
      run.airborne[e.obj] = snap.t;
      record(run, 'throw', e.obj);
    }
  }
  // Airborne objects: latch every zone they pass through; land when settled (after a moment).
  const zones = allZoneRefs(world);
  for (const [id, since] of Object.entries(run.airborne)) {
    const o = snap.objects[id];
    if (!o || o.held) {
      delete run.airborne[id];
      continue;
    }
    for (const z of zones) {
      if (z === id) continue;
      const b = zoneBox(world, z, snap);
      const key = `${id}|${z}`;
      if (b && inBox(o.pos, b) && !run.thrownInto.includes(key)) run.thrownInto.push(key);
    }
    if (o.speed < SETTLED_SPEED && snap.t - since > 400) delete run.airborne[id];
  }

  const task = currentTask(world, run);
  if (!task) return { run, completed: null, finished: run.taskIndex >= world.tasks.length };
  const ok = evalCond(task.done, { world, snap, run }, '0');
  if (!ok) return { run, completed: null, finished: false };
  run.done.push(task.id);
  run.taskIndex += 1;
  run.taskStartedAt = snap.t;
  run.seq = {};
  run.performed = [];
  run.thrownInto = [];
  const finished = run.taskIndex >= world.tasks.length;
  if (finished) run.finishedAt = snap.t;
  return { run, completed: task, finished };
}

/** Skip the current task (counts as not done). */
export function skipTask(world: Pick<WorldSpec, 'tasks'>, prev: WorldRun, now: number): WorldRun {
  if (prev.taskIndex >= world.tasks.length) return prev;
  const taskIndex = prev.taskIndex + 1;
  return {
    ...prev,
    taskIndex,
    taskStartedAt: now,
    seq: {},
    performed: [],
    thrownInto: [],
    finishedAt: taskIndex >= world.tasks.length ? now : prev.finishedAt,
  };
}

/** Every object a condition talks about (targets, zones that are objects, surfaces that are objects). */
export function conditionObjects(world: WorldSpec, c: WorldCondition): string[] {
  const out = new Set<string>();
  const add = (ref: string | undefined) => { if (ref) for (const id of resolveTarget(world, ref)) out.add(id); };
  const walk = (x: WorldCondition) => {
    if ('holding' in x) add(x.holding);
    else if ('in_zone' in x) { add(x.in_zone); add(x.zone); }
    else if ('on' in x) { add(x.on); add(x.surface); }
    else if ('near' in x) { add(x.near); add(x.to); }
    else if ('state' in x) add(x.state);
    else if ('thrown_into' in x) { add(x.thrown_into); add(x.zone); }
    else if ('count_in_zone' in x) { add(x.count_in_zone); add(x.zone); }
    else if ('performed' in x) add(x.target);
    else if ('not' in x) walk(x.not);
    else if ('all_of' in x) x.all_of.forEach(walk);
    else if ('any_of' in x) x.any_of.forEach(walk);
    else if ('sequence' in x) x.sequence.forEach(walk);
  };
  walk(c);
  return [...out];
}

/** What glows when he's stuck: the task's `hint`, else what its condition names. */
export function hintTargets(world: WorldSpec, task: WorldTaskSpec): string[] {
  if (task.hint && task.hint.length > 0) return [...new Set(task.hint.flatMap((t) => resolveTarget(world, t)))];
  return conditionObjects(world, task.done);
}

export function hintDue(run: WorldRun, now: number): boolean {
  return run.finishedAt === null && now - run.taskStartedAt >= HINT_AFTER_MS;
}

/** "3:07" for a duration in ms. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
