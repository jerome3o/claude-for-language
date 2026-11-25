/**
 * 🥽 VR worlds (语言世界, docs/VR_WORLDS.md): the DATA side of a world — what is in it, where, what it is
 * called in Chinese, and the tasks ("把杯子放在桌子上。") the engine checks while the learner plays.
 *
 * A world's frontend definition (frontend/src/vr/worlds/<id>/) IS one of these plus the visuals (a
 * Scene component and a model per object): the shared validator and engine only read the fields
 * below, so they run in unit tests, in the "every world validates" test and in the headset alike.
 *
 * Conventions (three.js, like shared/vr): metres, Y up, the floor at y = 0, yaw 0 looks down −Z,
 * a positive yaw turns to the left (counter-clockwise seen from above).
 */

export const VR_WORLD_SCHEMA_VERSION = 1;

export type Vec3 = [number, number, number];

/** A Chinese word on an object / state / task, following the card standard (shared/cards/standard.ts). */
export interface WorldWord {
  /** ONE clean simplified form, Han characters only (杯子). */
  hanzi: string;
  /** Tone marks, spaces between words (bēizi). */
  pinyin: string;
  /** One clear meaning (cup). */
  english: string;
  /** The measure word, one character (个 → "一个杯子"). */
  measure?: string;
  /**
   * Optional card extras for "+ Add as card": the explanation (character by character, then usage)
   * and one short natural sentence containing the word exactly.
   */
  fun_facts?: string;
  example?: { hanzi: string; pinyin: string; english: string };
}

/** What an object sounds like when it hits something (frontend/public/vr/sfx/impact-<material>.mp3). */
export const WORLD_MATERIALS = ['wood', 'glass', 'metal', 'plastic', 'cloth', 'paper', 'ceramic', 'food', 'stone'] as const;
export type WorldMaterial = (typeof WORLD_MATERIALS)[number];

/**
 * A collision shape in the object's own frame (its centre = `at`). Sizes are FULL sizes in metres.
 * `when` makes a part exist only while the object is in that state (a fridge door that is a wall
 * while closed and swings aside when open).
 */
export type WorldColliderShape =
  | { box: Vec3 }
  | { ball: number }
  /** Upright cylinder: [radius, height]. */
  | { cylinder: [number, number] };

export type WorldColliderPart = WorldColliderShape & {
  /** Offset of the part's centre from the object's centre. */
  offset?: Vec3;
  /** Only while these states hold: { door: 'closed' }. */
  when?: Record<string, string>;
};

/** One value of a state machine: the verb that leads to it ("打开" → open) and how to say the state ("开着"). */
export interface WorldStateValue {
  verb: WorldWord;
  label: WorldWord;
}

/** A simple state an object can be in, toggled with "use" (the panel's verb button): cycles through `values`. */
export interface WorldObjectState {
  key: string;
  initial: string;
  /** Ordered: "use" moves to the next value (and wraps). */
  values: Record<string, WorldStateValue>;
}

/** A thing in the world: named in Chinese, inspectable, and (when it has mass) grabbable. */
export interface WorldObjectSpec {
  /** Lowercase token, unique in the world (`cup`, `cup_2`). */
  id: string;
  word: WorldWord;
  /** Groups for tasks: `#fruit` targets every object tagged `fruit`. */
  tags?: string[];
  material: WorldMaterial;
  /** Kilograms. 0 = fixed in place (furniture: inspectable, not grabbable). */
  mass: number;
  /** Where its centre starts. */
  at: Vec3;
  yaw?: number;
  /** One shape (optionally offset), or several parts (a hollow fridge, a basket). */
  collider: WorldColliderPart | WorldColliderPart[];
  states?: WorldObjectState[];
  /** Things can be put ON it (a table, a plate, a tray): `on` may name it. */
  surface?: boolean;
  /**
   * Things can be put IN it (a basket, a bin, a fridge): a box in the object's frame (min / max
   * corners). `in_zone` / `count_in_zone` / `thrown_into` may name the object as the zone.
   */
  inside?: { min: Vec3; max: Vec3 };
}

/** A named region of the world (an axis-aligned box): "the counter", "by the door". */
export interface WorldZoneSpec {
  id: string;
  word?: WorldWord;
  min: Vec3;
  max: Vec3;
}

/**
 * A target: an object id (`cup`) or a tag (`#fruit` = any object tagged fruit).
 * A zone ref: a zone id, or an object with `inside` (its inside), or an object with `surface` (for `on`).
 */
export type WorldTarget = string;

export type WorldAction = 'grab' | 'release' | 'throw' | 'use' | 'inspect';

export type WorldCondition =
  /** The learner holds it (either hand / the mouse). */
  | { holding: WorldTarget }
  /** Lying (not held) with its centre inside the zone. */
  | { in_zone: WorldTarget; zone: string }
  /** Resting (not held, settled) on the surface: a surface object's top, or a zone. */
  | { on: WorldTarget; surface: string }
  /** Within `within` metres (default 0.3) of the other, centre to centre. */
  | { near: WorldTarget; to: WorldTarget; within?: number }
  /** An object's state ({ state: 'fridge', key: 'door', value: 'open' }). */
  | { state: string; key: string; value: string }
  /** It was thrown (released moving fast) and flew into the zone before anyone caught it. */
  | { thrown_into: WorldTarget; zone: string }
  /** At least `n` objects with the tag lie in the zone. */
  | { count_in_zone: WorldTarget; zone: string; n: number }
  /** The learner (their head, on the floor plan) is in the zone. */
  | { player_in: string }
  /** The learner did this (to it): grab / release / throw / use / inspect. */
  | { performed: WorldAction; target?: WorldTarget }
  | { not: WorldCondition }
  | { all_of: WorldCondition[] }
  | { any_of: WorldCondition[] }
  /** Each step in order (a step counts once reached; the next is checked after it). */
  | { sequence: WorldCondition[] };

/** One task: an imperative Chinese instruction and the condition that proves it was done. */
export interface WorldTaskSpec {
  id: string;
  /** The instruction (把杯子放在桌子上。). */
  zh: string;
  pinyin: string;
  en: string;
  done: WorldCondition;
  /** Objects to highlight when he is stuck (default: the condition's targets). */
  hint?: WorldTarget[];
}

export interface WorldSpec {
  id: string;
  title_zh: string;
  title_en: string;
  /** One line for the picker card. */
  blurb: string;
  /** The playable box: everything (objects, zones, spawn) is inside it. */
  bounds: { min: Vec3; max: Vec3 };
  /** Where the learner starts (feet on the floor) and which way they face. */
  spawn: { at: Vec3; yaw: number };
  objects: WorldObjectSpec[];
  zones?: WorldZoneSpec[];
  /** In order, easiest first (5–12). */
  tasks: WorldTaskSpec[];
}

/** One object as the engine sees it on a tick (from the physics bodies; pure data). */
export interface WorldObjectSnapshot {
  pos: Vec3;
  yaw: number;
  /** Linear speed, m/s. */
  speed: number;
  held: boolean;
  states: Record<string, string>;
}

export interface WorldSnapshot {
  /** ms (any monotonic clock). */
  t: number;
  /** The learner's head, in world coordinates. */
  player: Vec3;
  objects: Record<string, WorldObjectSnapshot>;
}

/** What the learner did since the last tick. `speed` on release = how fast it left the hand. */
export interface WorldEvent {
  type: WorldAction;
  obj: string;
  speed?: number;
}
