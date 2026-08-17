/**
 * The quest engine: a pure, deterministic state machine for the tile-map
 * lessons. The UI owns nothing but rendering — every rule (what can be walked
 * on, what can be picked up, which verbs are offered, when an instruction
 * counts as carried out) lives here, so a generated world is playable without
 * any lesson-specific code.
 *
 * Everything is pure: `applyQuestAction` returns a new state and never mutates
 * the one it was given.
 */

import type {
  QuestCondition,
  QuestObject,
  QuestObjectAction,
  QuestWorld,
} from './types';

export interface QuestObjectRuntime {
  x: number;
  y: number;
  /** Current state id, or null for stateless objects. */
  state: string | null;
  held: boolean;
  removed: boolean;
  /** Set once a `hidden_until` object has been uncovered — it stays uncovered. */
  revealed: boolean;
}

export interface QuestPerformed {
  object: string;
  action: string;
}

export interface QuestState {
  world: QuestWorld;
  player: { x: number; y: number };
  objects: Record<string, QuestObjectRuntime>;
  /** Object ids being carried, in pick-up order. */
  held: string[];
  /** How far through each `sequence` condition we are, keyed by condition path. */
  sequenceProgress: Record<string, number>;
  performed: QuestPerformed[];
  completedGoals: string[];
  /** Index of the goal being worked on; === goals.length when the quest is done. */
  activeGoalIndex: number;
  moves: number;
  finished: boolean;
}

export type QuestPlayerAction =
  | { type: 'move'; direction: QuestDirection }
  | { type: 'pick_up'; object: string }
  | { type: 'put_down'; object: string }
  | { type: 'interact'; object: string; action: string };

export type QuestDirection = 'up' | 'down' | 'left' | 'right';

export type QuestRejection =
  | 'blocked'
  | 'out_of_bounds'
  | 'out_of_reach'
  | 'not_portable'
  | 'hands_full'
  | 'not_held'
  | 'unknown_object'
  | 'unknown_action'
  | 'action_unavailable';

export interface QuestActionResult {
  state: QuestState;
  /** False when the action was refused — state is returned unchanged. */
  ok: boolean;
  rejection?: QuestRejection;
  /** Goals finished by this action, in order. */
  completedGoals: string[];
  /** True when this action finished the last goal. */
  justFinished: boolean;
}

const DIRECTION_DELTA: Record<QuestDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

// ============ Setup ============

export function createQuestState(world: QuestWorld): QuestState {
  const objects: Record<string, QuestObjectRuntime> = {};
  for (const obj of world.objects) {
    objects[obj.id] = {
      x: obj.x,
      y: obj.y,
      state: initialStateOf(obj),
      held: false,
      removed: false,
      revealed: !obj.hidden_until,
    };
  }

  const state: QuestState = {
    world,
    player: { x: world.player.x, y: world.player.y },
    objects,
    held: [],
    sequenceProgress: {},
    performed: [],
    completedGoals: [],
    activeGoalIndex: 0,
    moves: 0,
    finished: world.goals.length === 0,
  };

  // A world can start with goals already satisfied (e.g. "stand on the mat"
  // when the player starts there) — settle before the first render.
  return advance(state).state;
}

function initialStateOf(obj: QuestObject): string | null {
  if (!obj.states || obj.states.length === 0) return null;
  const initial = obj.initial_state;
  if (initial && obj.states.some((s) => s.id === initial)) return initial;
  return obj.states[0].id;
}

// ============ Lookups ============

export function findObject(world: QuestWorld, id: string): QuestObject | undefined {
  return world.objects.find((o) => o.id === id);
}

export function terrainAt(world: QuestWorld, x: number, y: number) {
  if (y < 0 || y >= world.grid.length) return undefined;
  const key = world.grid[y][x];
  if (key === undefined) return undefined;
  return world.terrain.find((t) => t.key === key);
}

/** The sprite to draw: the current state's emoji wins over the object's. */
export function emojiFor(obj: QuestObject, runtime: QuestObjectRuntime | undefined): string {
  const stateEmoji = obj.states?.find((s) => s.id === runtime?.state)?.emoji;
  return stateEmoji || obj.emoji;
}

/** The object's current state entry, if it has states. */
export function currentStateOf(obj: QuestObject, state: QuestState) {
  const runtime = state.objects[obj.id];
  return obj.states?.find((s) => s.id === runtime?.state);
}

/** Visible = not removed, and either never hidden or already uncovered. */
export function isVisible(state: QuestState, id: string): boolean {
  const runtime = state.objects[id];
  if (!runtime || runtime.removed) return false;
  return runtime.revealed;
}

function blocksMovement(obj: QuestObject, state: QuestState): boolean {
  const current = currentStateOf(obj, state);
  if (current && current.blocks_movement !== null && current.blocks_movement !== undefined) {
    return current.blocks_movement;
  }
  return obj.blocks_movement;
}

/** Visible, non-held objects standing on a tile. */
export function objectsAt(state: QuestState, x: number, y: number): QuestObject[] {
  return state.world.objects.filter((obj) => {
    const runtime = state.objects[obj.id];
    return (
      runtime &&
      !runtime.held &&
      isVisible(state, obj.id) &&
      runtime.x === x &&
      runtime.y === y
    );
  });
}

/** Objects the player can touch: on their tile or orthogonally adjacent. */
export function objectsInReach(state: QuestState): QuestObject[] {
  const { x, y } = state.player;
  const tiles: Array<[number, number]> = [
    [x, y],
    [x, y - 1],
    [x, y + 1],
    [x - 1, y],
    [x + 1, y],
  ];
  const seen = new Set<string>();
  const result: QuestObject[] = [];
  for (const [tx, ty] of tiles) {
    for (const obj of objectsAt(state, tx, ty)) {
      if (seen.has(obj.id)) continue;
      seen.add(obj.id);
      result.push(obj);
    }
  }
  return result;
}

/** Held objects, in pick-up order. */
export function heldObjects(state: QuestState): QuestObject[] {
  return state.held
    .map((id) => findObject(state.world, id))
    .filter((o): o is QuestObject => !!o);
}

export function canPickUp(state: QuestState, obj: QuestObject): boolean {
  const runtime = state.objects[obj.id];
  if (!runtime || runtime.held || !obj.portable || !isVisible(state, obj.id)) return false;
  if (state.held.length >= Math.max(1, state.world.carry_limit)) return false;
  return objectsInReach(state).some((o) => o.id === obj.id);
}

/** Whether an action is offered right now (state and holding requirements met). */
export function isActionAvailable(
  state: QuestState,
  obj: QuestObject,
  action: QuestObjectAction
): boolean {
  const runtime = state.objects[obj.id];
  if (!runtime || !isVisible(state, obj.id)) return false;
  if (action.requires_state && runtime.state !== action.requires_state) return false;
  if (action.requires_holding && !state.held.includes(action.requires_holding)) return false;
  // A held object can always be acted on; otherwise it must be within reach.
  if (!runtime.held && !objectsInReach(state).some((o) => o.id === obj.id)) return false;
  return true;
}

/** Every verb button to show right now, paired with its object. */
export function availableActions(
  state: QuestState
): Array<{ object: QuestObject; action: QuestObjectAction }> {
  const candidates = [...heldObjects(state), ...objectsInReach(state)];
  const seen = new Set<string>();
  const result: Array<{ object: QuestObject; action: QuestObjectAction }> = [];
  for (const obj of candidates) {
    if (seen.has(obj.id)) continue;
    seen.add(obj.id);
    for (const action of obj.actions ?? []) {
      if (isActionAvailable(state, obj, action)) result.push({ object: obj, action });
    }
  }
  return result;
}

export function canMove(state: QuestState, direction: QuestDirection): boolean {
  const { dx, dy } = DIRECTION_DELTA[direction];
  return isWalkable(state, state.player.x + dx, state.player.y + dy);
}

function isWalkable(state: QuestState, x: number, y: number): boolean {
  const world = state.world;
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  const terrain = terrainAt(world, x, y);
  if (!terrain || !terrain.walkable) return false;
  return !objectsAt(state, x, y).some((obj) => blocksMovement(obj, state));
}

// ============ Actions ============

export function applyQuestAction(
  state: QuestState,
  action: QuestPlayerAction
): QuestActionResult {
  switch (action.type) {
    case 'move':
      return move(state, action.direction);
    case 'pick_up':
      return pickUp(state, action.object);
    case 'put_down':
      return putDown(state, action.object);
    case 'interact':
      return interact(state, action.object, action.action);
  }
}

function reject(state: QuestState, rejection: QuestRejection): QuestActionResult {
  return { state, ok: false, rejection, completedGoals: [], justFinished: false };
}

function move(state: QuestState, direction: QuestDirection): QuestActionResult {
  const { dx, dy } = DIRECTION_DELTA[direction];
  const x = state.player.x + dx;
  const y = state.player.y + dy;
  if (x < 0 || y < 0 || x >= state.world.width || y >= state.world.height) {
    return reject(state, 'out_of_bounds');
  }
  if (!isWalkable(state, x, y)) return reject(state, 'blocked');

  const next: QuestState = {
    ...state,
    player: { x, y },
    moves: state.moves + 1,
    objects: { ...state.objects },
  };
  // Carried objects travel with the player so `object_at` reads sensibly.
  for (const id of next.held) {
    next.objects[id] = { ...next.objects[id], x, y };
  }
  return advance(next);
}

function pickUp(state: QuestState, id: string): QuestActionResult {
  const obj = findObject(state.world, id);
  const runtime = state.objects[id];
  if (!obj || !runtime) return reject(state, 'unknown_object');
  if (!isVisible(state, id) || runtime.held) return reject(state, 'unknown_object');
  if (!obj.portable) return reject(state, 'not_portable');
  if (!objectsInReach(state).some((o) => o.id === id)) return reject(state, 'out_of_reach');
  if (state.held.length >= Math.max(1, state.world.carry_limit)) {
    return reject(state, 'hands_full');
  }

  const next: QuestState = {
    ...state,
    held: [...state.held, id],
    objects: {
      ...state.objects,
      [id]: { ...runtime, held: true, x: state.player.x, y: state.player.y },
    },
    moves: state.moves + 1,
  };
  return advance(next);
}

function putDown(state: QuestState, id: string): QuestActionResult {
  const runtime = state.objects[id];
  if (!runtime) return reject(state, 'unknown_object');
  if (!runtime.held) return reject(state, 'not_held');

  const next: QuestState = {
    ...state,
    held: state.held.filter((held) => held !== id),
    objects: {
      ...state.objects,
      [id]: { ...runtime, held: false, x: state.player.x, y: state.player.y },
    },
    moves: state.moves + 1,
  };
  return advance(next);
}

function interact(state: QuestState, id: string, actionId: string): QuestActionResult {
  const obj = findObject(state.world, id);
  const runtime = state.objects[id];
  if (!obj || !runtime) return reject(state, 'unknown_object');
  const action = obj.actions?.find((a) => a.id === actionId);
  if (!action) return reject(state, 'unknown_action');
  if (!isActionAvailable(state, obj, action)) return reject(state, 'action_unavailable');

  const updated: QuestObjectRuntime = { ...runtime };
  if (action.sets_state) updated.state = action.sets_state;
  if (action.removes_object) {
    updated.removed = true;
    updated.held = false;
  }

  const next: QuestState = {
    ...state,
    objects: { ...state.objects, [id]: updated },
    held: action.removes_object ? state.held.filter((h) => h !== id) : state.held,
    performed: [...state.performed, { object: id, action: actionId }],
    moves: state.moves + 1,
  };
  return advance(next);
}

/** Restart the same world from the beginning. */
export function resetQuestState(state: QuestState): QuestState {
  return createQuestState(state.world);
}

// ============ Progress ============

/**
 * Settle the world after a change: uncover anything whose container opened,
 * push `sequence` conditions forward, then complete goals in order.
 */
function advance(state: QuestState): QuestActionResult {
  let next = revealHidden(state);
  next = tickSequences(next);

  const completed: string[] = [];
  const goals = next.world.goals;
  let index = next.activeGoalIndex;
  while (index < goals.length && evaluate(goals[index].condition, next, goalPath(index))) {
    completed.push(goals[index].id);
    index++;
    // Later goals can hinge on a sequence that only starts counting now.
    next = tickSequences(next);
  }

  if (completed.length > 0 || index !== next.activeGoalIndex) {
    next = {
      ...next,
      activeGoalIndex: index,
      completedGoals: [...next.completedGoals, ...completed],
      finished: index >= goals.length,
    };
  }

  return {
    state: next,
    ok: true,
    completedGoals: completed,
    justFinished: next.finished && !state.finished,
  };
}

function revealHidden(state: QuestState): QuestState {
  let objects: Record<string, QuestObjectRuntime> | null = null;
  for (const obj of state.world.objects) {
    const runtime = state.objects[obj.id];
    if (!runtime || runtime.revealed || !obj.hidden_until) continue;
    const container = state.objects[obj.hidden_until.object];
    if (container && !container.removed && container.state === obj.hidden_until.state) {
      objects = objects ?? { ...state.objects };
      objects[obj.id] = { ...runtime, revealed: true };
    }
  }
  return objects ? { ...state, objects } : state;
}

/** Stable identity for a condition inside the tree, used to remember progress. */
function goalPath(goalIndex: number): string {
  return `g${goalIndex}`;
}

/**
 * Nested sequences settle over a few passes: an inner sequence completing can
 * let its parent step forward, so keep going until nothing moves.
 */
function tickSequences(state: QuestState): QuestState {
  let working = state;
  for (let pass = 0; pass < 8; pass++) {
    const next = tickSequencesOnce(working);
    if (next === working) break;
    working = next;
  }
  return working;
}

function tickSequencesOnce(state: QuestState): QuestState {
  let progress: Record<string, number> | null = null;

  const walk = (condition: QuestCondition, path: string): void => {
    if (condition.type === 'sequence') {
      // Step through as far as the world currently allows — several steps can
      // land at once (walking onto a tile can satisfy two in a row).
      let index = state.sequenceProgress[path] ?? 0;
      let advanced = false;
      while (
        index < condition.conditions.length &&
        evaluate(condition.conditions[index], state, `${path}.${index}`)
      ) {
        index++;
        advanced = true;
      }
      if (advanced) {
        progress = progress ?? { ...state.sequenceProgress };
        progress[path] = index;
      }
    }
    if (
      condition.type === 'sequence' ||
      condition.type === 'all_of' ||
      condition.type === 'any_of'
    ) {
      condition.conditions.forEach((child, i) => walk(child, `${path}.${i}`));
    }
  };

  state.world.goals.forEach((goal, i) => walk(goal.condition, goalPath(i)));

  return progress ? { ...state, sequenceProgress: progress } : state;
}

/**
 * Is this condition satisfied right now? `sequence` reads the progress counter
 * kept by `tickSequences`, so its steps count even if they are later undone.
 */
export function evaluate(condition: QuestCondition, state: QuestState, path: string): boolean {
  switch (condition.type) {
    case 'holding':
      return state.held.includes(condition.object);
    case 'not_holding':
      return !state.held.includes(condition.object);
    case 'object_at': {
      const runtime = state.objects[condition.object];
      return (
        !!runtime &&
        !runtime.held &&
        !runtime.removed &&
        runtime.x === condition.x &&
        runtime.y === condition.y
      );
    }
    case 'object_on': {
      const runtime = state.objects[condition.object];
      const target = state.objects[condition.target];
      return (
        !!runtime &&
        !!target &&
        !runtime.held &&
        !runtime.removed &&
        !target.removed &&
        condition.object !== condition.target &&
        runtime.x === target.x &&
        runtime.y === target.y
      );
    }
    case 'object_on_terrain': {
      const runtime = state.objects[condition.object];
      if (!runtime || runtime.held || runtime.removed) return false;
      return terrainAt(state.world, runtime.x, runtime.y)?.key === condition.terrain;
    }
    case 'player_at':
      return state.player.x === condition.x && state.player.y === condition.y;
    case 'player_on_terrain':
      return terrainAt(state.world, state.player.x, state.player.y)?.key === condition.terrain;
    case 'player_next_to': {
      const runtime = state.objects[condition.object];
      if (!runtime || runtime.removed) return false;
      if (runtime.held) return true;
      const distance =
        Math.abs(runtime.x - state.player.x) + Math.abs(runtime.y - state.player.y);
      return distance <= 1;
    }
    case 'object_state': {
      const runtime = state.objects[condition.object];
      return !!runtime && !runtime.removed && runtime.state === condition.state;
    }
    case 'object_removed':
      return !!state.objects[condition.object]?.removed;
    case 'performed':
      return state.performed.some(
        (p) => p.object === condition.object && p.action === condition.action
      );
    case 'all_of':
      return condition.conditions.every((child, i) => evaluate(child, state, `${path}.${i}`));
    case 'any_of':
      return condition.conditions.some((child, i) => evaluate(child, state, `${path}.${i}`));
    case 'sequence':
      return (state.sequenceProgress[path] ?? 0) >= condition.conditions.length;
  }
}

/** Every object a condition talks about — used to highlight targets on a hint. */
export function conditionObjectIds(condition: QuestCondition): string[] {
  switch (condition.type) {
    case 'holding':
    case 'not_holding':
    case 'object_at':
    case 'object_on_terrain':
    case 'player_next_to':
    case 'object_state':
    case 'object_removed':
    case 'performed':
      return [condition.object];
    case 'object_on':
      return [condition.object, condition.target];
    case 'all_of':
    case 'any_of':
    case 'sequence':
      return condition.conditions.flatMap(conditionObjectIds);
    default:
      return [];
  }
}

/** How far through the active goal's top-level sequence the learner is. */
export function activeGoalProgress(
  state: QuestState
): { done: number; total: number } | null {
  const goal = state.world.goals[state.activeGoalIndex];
  if (!goal || goal.condition.type !== 'sequence') return null;
  return {
    done: Math.min(
      state.sequenceProgress[goalPath(state.activeGoalIndex)] ?? 0,
      goal.condition.conditions.length
    ),
    total: goal.condition.conditions.length,
  };
}
