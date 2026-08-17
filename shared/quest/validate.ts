/**
 * World validation.
 *
 * Generated worlds are checked before they are ever stored: a quest that
 * references a missing object, hides a goal behind a wall, or paints a grid row
 * of the wrong length is unplayable, and the learner should never see it. The
 * error strings are written to be fed straight back to the model as a repair
 * prompt, so they name the offending field and say what was expected.
 */

import type { QuestCondition, QuestObject, QuestWorld } from './types';

export const QUEST_MIN_SIZE = 4;
export const QUEST_MAX_SIZE = 12;
export const QUEST_MAX_OBJECTS = 24;
export const QUEST_MAX_GOALS = 8;

/** Returns a list of problems; an empty list means the world is playable. */
export function validateQuestWorld(world: QuestWorld): string[] {
  const errors: string[] = [];

  if (!world || typeof world !== 'object') return ['world is missing'];

  // --- grid ---
  const { width, height } = world;
  if (!Number.isInteger(width) || width < QUEST_MIN_SIZE || width > QUEST_MAX_SIZE) {
    errors.push(`width must be an integer between ${QUEST_MIN_SIZE} and ${QUEST_MAX_SIZE}, got ${width}`);
  }
  if (!Number.isInteger(height) || height < QUEST_MIN_SIZE || height > QUEST_MAX_SIZE) {
    errors.push(`height must be an integer between ${QUEST_MIN_SIZE} and ${QUEST_MAX_SIZE}, got ${height}`);
  }

  const terrain = world.terrain ?? [];
  if (terrain.length === 0) errors.push('terrain must contain at least one tile type');

  const terrainKeys = new Set<string>();
  for (const t of terrain) {
    if (!t.key || [...t.key].length !== 1) {
      errors.push(`terrain key "${t.key}" must be exactly one character`);
      continue;
    }
    if (terrainKeys.has(t.key)) errors.push(`terrain key "${t.key}" is used twice`);
    terrainKeys.add(t.key);
  }
  if (!terrain.some((t) => t.walkable)) errors.push('at least one terrain type must be walkable');

  const grid = world.grid ?? [];
  if (grid.length !== height) {
    errors.push(`grid must have exactly ${height} rows (height), got ${grid.length}`);
  }
  grid.forEach((row, y) => {
    const cells = [...(row ?? '')];
    if (cells.length !== width) {
      errors.push(`grid row ${y} must be exactly ${width} characters (width), got ${cells.length}`);
    }
    cells.forEach((cell, x) => {
      if (!terrainKeys.has(cell)) {
        errors.push(`grid (${x},${y}) uses terrain key "${cell}" which is not defined in terrain`);
      }
    });
  });

  const walkableKeys = new Set(terrain.filter((t) => t.walkable).map((t) => t.key));
  const inBounds = (x: number, y: number) =>
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
  const terrainKeyAt = (x: number, y: number) => (inBounds(x, y) ? grid[y]?.[x] : undefined);
  const isWalkableTile = (x: number, y: number) => {
    const key = terrainKeyAt(x, y);
    return key !== undefined && walkableKeys.has(key);
  };

  // --- player ---
  const player = world.player;
  if (!player || !player.emoji) {
    errors.push('player.emoji is required');
  }
  if (!player || !inBounds(player.x, player.y)) {
    errors.push(`player start (${player?.x},${player?.y}) is outside the grid`);
  } else if (!isWalkableTile(player.x, player.y)) {
    errors.push(`player start (${player.x},${player.y}) is on a non-walkable tile`);
  }

  if (
    world.carry_limit !== undefined &&
    (!Number.isInteger(world.carry_limit) || world.carry_limit < 1 || world.carry_limit > 4)
  ) {
    errors.push(`carry_limit must be an integer between 1 and 4, got ${world.carry_limit}`);
  }

  // --- objects ---
  const objects = world.objects ?? [];
  if (objects.length > QUEST_MAX_OBJECTS) {
    errors.push(`too many objects (${objects.length}); keep it under ${QUEST_MAX_OBJECTS}`);
  }
  const objectsById = new Map<string, QuestObject>();
  for (const obj of objects) {
    if (!obj.id) {
      errors.push('every object needs an id');
      continue;
    }
    if (objectsById.has(obj.id)) errors.push(`object id "${obj.id}" is used twice`);
    objectsById.set(obj.id, obj);

    if (!obj.emoji) errors.push(`object "${obj.id}" needs an emoji`);
    if (!obj.hanzi) errors.push(`object "${obj.id}" needs hanzi`);
    if (!inBounds(obj.x, obj.y)) {
      errors.push(`object "${obj.id}" at (${obj.x},${obj.y}) is outside the grid`);
    } else if (!isWalkableTile(obj.x, obj.y) && !obj.blocks_movement) {
      errors.push(
        `object "${obj.id}" at (${obj.x},${obj.y}) sits on a non-walkable tile, so the player can never reach it`
      );
    }
    if (obj.portable && obj.blocks_movement) {
      errors.push(`object "${obj.id}" cannot be both portable and blocks_movement`);
    }

    const stateIds = new Set<string>();
    for (const state of obj.states ?? []) {
      if (!state.id) {
        errors.push(`object "${obj.id}" has a state without an id`);
        continue;
      }
      if (stateIds.has(state.id)) {
        errors.push(`object "${obj.id}" defines state "${state.id}" twice`);
      }
      stateIds.add(state.id);
    }
    if (obj.initial_state && !stateIds.has(obj.initial_state)) {
      errors.push(`object "${obj.id}" has initial_state "${obj.initial_state}" which is not one of its states`);
    }

    const actionIds = new Set<string>();
    for (const action of obj.actions ?? []) {
      if (!action.id) {
        errors.push(`object "${obj.id}" has an action without an id`);
        continue;
      }
      if (actionIds.has(action.id)) {
        errors.push(`object "${obj.id}" defines action "${action.id}" twice`);
      }
      actionIds.add(action.id);
      if (!action.hanzi) errors.push(`action "${action.id}" on "${obj.id}" needs a Chinese verb`);
      if (action.requires_state && !stateIds.has(action.requires_state)) {
        errors.push(
          `action "${action.id}" on "${obj.id}" requires state "${action.requires_state}" which that object does not have`
        );
      }
      if (action.sets_state && !stateIds.has(action.sets_state)) {
        errors.push(
          `action "${action.id}" on "${obj.id}" sets state "${action.sets_state}" which that object does not have`
        );
      }
      if (action.requires_holding && !objects.some((o) => o.id === action.requires_holding)) {
        errors.push(
          `action "${action.id}" on "${obj.id}" requires holding "${action.requires_holding}" which is not an object`
        );
      }
    }

    if (obj.hidden_until) {
      const container = objects.find((o) => o.id === obj.hidden_until!.object);
      if (!container) {
        errors.push(`object "${obj.id}" is hidden_until unknown object "${obj.hidden_until.object}"`);
      } else if (!(container.states ?? []).some((s) => s.id === obj.hidden_until!.state)) {
        errors.push(
          `object "${obj.id}" is hidden until "${obj.hidden_until.object}" reaches state "${obj.hidden_until.state}", which that object does not have`
        );
      } else if (!(container.actions ?? []).some((a) => a.sets_state === obj.hidden_until!.state)) {
        errors.push(
          `object "${obj.id}" can never be uncovered: no action on "${obj.hidden_until.object}" sets state "${obj.hidden_until.state}"`
        );
      }
    }
  }

  // --- goals ---
  const goals = world.goals ?? [];
  if (goals.length === 0) errors.push('a quest needs at least one goal');
  if (goals.length > QUEST_MAX_GOALS) {
    errors.push(`too many goals (${goals.length}); keep it to ${QUEST_MAX_GOALS} or fewer`);
  }
  const goalIds = new Set<string>();
  const referencedTiles: Array<{ x: number; y: number; label: string }> = [];
  const referencedObjects = new Set<string>();

  goals.forEach((goal, index) => {
    const label = goal.id || `goal ${index + 1}`;
    if (!goal.id) errors.push(`goal ${index + 1} needs an id`);
    else if (goalIds.has(goal.id)) errors.push(`goal id "${goal.id}" is used twice`);
    goalIds.add(goal.id);

    if (!goal.instruction?.hanzi) errors.push(`${label} needs a Chinese instruction`);
    if (!goal.condition) {
      errors.push(`${label} needs a condition`);
      return;
    }
    validateCondition(goal.condition, label, {
      errors,
      objectsById,
      terrainKeys,
      inBounds,
      isWalkableTile,
      referencedTiles,
      referencedObjects,
    });
  });

  // --- reachability ---
  if (errors.length === 0) {
    errors.push(
      ...findUnreachable(world, {
        referencedObjects,
        referencedTiles,
        isWalkableTile,
        inBounds,
        objectsById,
      })
    );
  }

  return errors;
}

interface ConditionContext {
  errors: string[];
  objectsById: Map<string, QuestObject>;
  terrainKeys: Set<string>;
  inBounds: (x: number, y: number) => boolean;
  isWalkableTile: (x: number, y: number) => boolean;
  referencedTiles: Array<{ x: number; y: number; label: string }>;
  referencedObjects: Set<string>;
}

function validateCondition(condition: QuestCondition, label: string, ctx: ConditionContext): void {
  const { errors, objectsById } = ctx;

  const requireObject = (id: string, role: string): QuestObject | undefined => {
    const obj = objectsById.get(id);
    if (!obj) {
      errors.push(`${label}: condition references ${role} "${id}" which is not an object in the world`);
      return undefined;
    }
    ctx.referencedObjects.add(id);
    return obj;
  };

  const requireTile = (x: number, y: number) => {
    if (!ctx.inBounds(x, y)) {
      errors.push(`${label}: condition targets tile (${x},${y}) which is outside the grid`);
      return;
    }
    if (!ctx.isWalkableTile(x, y)) {
      errors.push(`${label}: condition targets tile (${x},${y}) which is not walkable`);
      return;
    }
    ctx.referencedTiles.push({ x, y, label });
  };

  switch (condition.type) {
    case 'holding':
    case 'not_holding': {
      const obj = requireObject(condition.object, 'object');
      if (obj && !obj.portable) {
        errors.push(`${label}: "${condition.object}" must be portable to be carried`);
      }
      break;
    }
    case 'object_at': {
      const obj = requireObject(condition.object, 'object');
      if (obj && !obj.portable) {
        errors.push(
          `${label}: "${condition.object}" is not portable, so it can never be moved to (${condition.x},${condition.y})`
        );
      }
      requireTile(condition.x, condition.y);
      break;
    }
    case 'object_on': {
      const obj = requireObject(condition.object, 'object');
      if (obj && !obj.portable) {
        errors.push(`${label}: "${condition.object}" must be portable to be put on something`);
      }
      const target = requireObject(condition.target, 'target');
      if (target && !target.surface) {
        errors.push(`${label}: "${condition.target}" must have surface: true to have things put on it`);
      }
      if (target && target.blocks_movement) {
        errors.push(
          `${label}: "${condition.target}" blocks movement, so nothing can be put on its tile`
        );
      }
      if (condition.object === condition.target) {
        errors.push(`${label}: an object cannot be put on itself`);
      }
      break;
    }
    case 'object_on_terrain': {
      const obj = requireObject(condition.object, 'object');
      if (obj && !obj.portable) {
        errors.push(`${label}: "${condition.object}" must be portable to be moved onto terrain`);
      }
      if (!ctx.terrainKeys.has(condition.terrain)) {
        errors.push(`${label}: terrain "${condition.terrain}" is not defined`);
      }
      break;
    }
    case 'player_at':
      requireTile(condition.x, condition.y);
      break;
    case 'player_on_terrain':
      if (!ctx.terrainKeys.has(condition.terrain)) {
        errors.push(`${label}: terrain "${condition.terrain}" is not defined`);
      }
      break;
    case 'player_next_to':
      requireObject(condition.object, 'object');
      break;
    case 'object_state': {
      const obj = requireObject(condition.object, 'object');
      if (obj) {
        const states = obj.states ?? [];
        if (!states.some((s) => s.id === condition.state)) {
          errors.push(`${label}: "${condition.object}" has no state "${condition.state}"`);
        } else if (!(obj.actions ?? []).some((a) => a.sets_state === condition.state)) {
          const initial =
            obj.initial_state ?? (states.length > 0 ? states[0].id : undefined);
          if (initial !== condition.state) {
            errors.push(
              `${label}: nothing can put "${condition.object}" into state "${condition.state}" — give it an action with sets_state: "${condition.state}"`
            );
          }
        }
      }
      break;
    }
    case 'object_removed': {
      const obj = requireObject(condition.object, 'object');
      if (obj && !(obj.actions ?? []).some((a) => a.removes_object)) {
        errors.push(
          `${label}: "${condition.object}" can never be removed — give it an action with removes_object: true`
        );
      }
      break;
    }
    case 'performed': {
      const obj = requireObject(condition.object, 'object');
      if (obj && !(obj.actions ?? []).some((a) => a.id === condition.action)) {
        errors.push(`${label}: "${condition.object}" has no action "${condition.action}"`);
      }
      break;
    }
    case 'all_of':
    case 'any_of':
    case 'sequence': {
      const children = condition.conditions ?? [];
      if (children.length === 0) {
        errors.push(`${label}: "${condition.type}" needs at least one condition`);
      }
      children.forEach((child) => validateCondition(child, label, ctx));
      break;
    }
    default:
      errors.push(`${label}: unknown condition type "${(condition as { type: string }).type}"`);
  }
}

interface ReachabilityContext {
  referencedObjects: Set<string>;
  referencedTiles: Array<{ x: number; y: number; label: string }>;
  isWalkableTile: (x: number, y: number) => boolean;
  inBounds: (x: number, y: number) => boolean;
  objectsById: Map<string, QuestObject>;
}

/**
 * Flood-fill from the player's start to make sure every tile the goals talk
 * about can actually be walked to. A blocking object counts as passable if some
 * action can move it out of a blocking state (a locked door with a key is fine;
 * a wall around the prize is not).
 */
function findUnreachable(world: QuestWorld, ctx: ReachabilityContext): string[] {
  const errors: string[] = [];
  const permanentBlockers = new Set<string>();
  for (const obj of world.objects ?? []) {
    if (!obj.blocks_movement) continue;
    const unblockable = (obj.actions ?? []).some((action) => {
      if (!action.sets_state) return false;
      const target = (obj.states ?? []).find((s) => s.id === action.sets_state);
      return target?.blocks_movement === false;
    });
    if (!unblockable) permanentBlockers.add(`${obj.x},${obj.y}`);
  }

  const start = world.player;
  const seen = new Set<string>([`${start.x},${start.y}`]);
  const queue: Array<[number, number]> = [[start.x, start.y]];
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      if (!ctx.isWalkableTile(nx, ny)) continue;
      if (permanentBlockers.has(key)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }

  /** Reachable = standable, or standable from an adjacent tile. */
  const canBeTouched = (x: number, y: number) =>
    seen.has(`${x},${y}`) ||
    seen.has(`${x - 1},${y}`) ||
    seen.has(`${x + 1},${y}`) ||
    seen.has(`${x},${y - 1}`) ||
    seen.has(`${x},${y + 1}`);

  for (const id of ctx.referencedObjects) {
    const obj = ctx.objectsById.get(id);
    if (!obj) continue;
    if (!canBeTouched(obj.x, obj.y)) {
      errors.push(
        `object "${id}" at (${obj.x},${obj.y}) is walled off from the player start (${start.x},${start.y}) — a goal needs it, so open a path`
      );
    }
  }

  for (const tile of ctx.referencedTiles) {
    if (!seen.has(`${tile.x},${tile.y}`)) {
      errors.push(
        `${tile.label}: tile (${tile.x},${tile.y}) cannot be walked to from the player start (${start.x},${start.y})`
      );
    }
  }

  return errors;
}
