/**
 * Golden vectors for the Kotlin port of shared/quest/engine.ts (android-lab/core/…/Quest.kt).
 *
 * Generates seeded random worlds (terrain, doors that block until opened, containers
 * hiding things, portable objects, verbs that set states or remove objects, goals built
 * from every condition type incl. nested sequence / all_of / any_of) plus a hand-written
 * kitchen, then plays them with a random-but-purposeful "learner" (mostly legal moves and
 * available verbs, some nonsense). Every action's result and the full state after it are
 * recorded; QuestParityTest replays the same actions on the Kotlin engine and compares.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  activeGoalProgress,
  applyQuestAction,
  availableActions,
  canMove,
  canPickUp,
  conditionObjectIds,
  createQuestState,
  emojiFor,
  isVisible,
  objectsInReach,
  resetQuestState,
  type QuestDirection,
  type QuestPlayerAction,
  type QuestState,
} from '../../../shared/quest/engine';
import type { QuestCondition, QuestObject, QuestWorld } from '../../../shared/quest/types';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: quest <out-dir>');
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(424242);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;

const T = (h: string, e: string) => ({ hanzi: h, pinyin: h, english: e });

const TERRAIN = [
  { key: '.', hanzi: '地板', pinyin: 'dìbǎn', english: 'floor', color: '#eee', walkable: true },
  { key: 'g', hanzi: '草地', pinyin: 'cǎodì', english: 'grass', color: '#9f9', emoji: '🌱', walkable: true },
  { key: 'r', hanzi: '地毯', pinyin: 'dìtǎn', english: 'rug', color: '#c99', walkable: true },
  { key: '#', hanzi: '墙', pinyin: 'qiáng', english: 'wall', color: '#333', walkable: false },
  { key: '~', hanzi: '水', pinyin: 'shuǐ', english: 'water', color: '#39f', emoji: '🌊', walkable: false },
];

const NAMES = [
  ['苹果', '🍎', 'apple'], ['杯子', '🥤', 'cup'], ['书', '📕', 'book'], ['钥匙', '🔑', 'key'], ['桌子', '🪑', 'table'],
  ['冰箱', '🧊', 'fridge'], ['门', '🚪', 'door'], ['箱子', '📦', 'box'], ['花', '🌸', 'flower'], ['猫', '🐱', 'cat'],
  ['面包', '🍞', 'bread'], ['灯', '💡', 'lamp'], ['椅子', '💺', 'chair'], ['牛奶', '🥛', 'milk'], ['衣服', '👕', 'shirt'],
];

function randomWorld(seedIndex: number): QuestWorld {
  const width = int(4, 9);
  const height = int(4, 8);
  const grid: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const r = rand();
      row += r < 0.1 ? '#' : r < 0.14 ? '~' : r < 0.3 ? 'g' : r < 0.4 ? 'r' : '.';
    }
    grid.push(row);
  }
  const walkable: [number, number][] = [];
  grid.forEach((row, y) => Array.from(row).forEach((k, x) => { if (k !== '#' && k !== '~') walkable.push([x, y]); }));
  if (walkable.length === 0) { grid[0] = '.' + grid[0].slice(1); walkable.push([0, 0]); }
  const [px, py] = pick(walkable);

  const count = int(2, 8);
  const objects: QuestObject[] = [];
  for (let i = 0; i < count; i++) {
    const [h, emoji, e] = pick(NAMES);
    const id = `${e}${i}`;
    const [x, y] = chance(0.9) ? pick(walkable) : [int(0, width - 1), int(0, height - 1)];
    const hasStates = chance(0.45);
    const states = hasStates
      ? [
          { id: 'closed', hanzi: '关着', pinyin: 'guānzhe', english: 'closed', emoji: chance(0.5) ? '🔒' : null, blocks_movement: chance(0.3) ? true : chance(0.5) ? null : false },
          { id: 'open', hanzi: '开着', pinyin: 'kāizhe', english: 'open', emoji: chance(0.5) ? '🔓' : undefined, blocks_movement: chance(0.5) ? false : null },
          ...(chance(0.3) ? [{ id: 'broken', hanzi: '坏了', pinyin: 'huàile', english: 'broken' }] : []),
        ]
      : chance(0.1) ? [] : null;
    const actions = [] as NonNullable<QuestObject['actions']>;
    if (hasStates) {
      actions.push({ id: 'open', hanzi: '打开', pinyin: 'dǎkāi', english: 'open', requires_state: 'closed', sets_state: 'open' });
      actions.push({ id: 'close', hanzi: '关上', pinyin: 'guānshàng', english: 'close', requires_state: 'open', sets_state: 'closed' });
      if (chance(0.3)) actions.push({ id: 'break', hanzi: '打破', pinyin: 'dǎpò', english: 'break', sets_state: 'broken', requires_holding: chance(0.5) ? `${pick(NAMES)[2]}${int(0, count - 1)}` : null });
    }
    if (chance(0.3)) actions.push({ id: 'eat', hanzi: '吃', pinyin: 'chī', english: 'eat', removes_object: true });
    if (chance(0.3)) actions.push({ id: 'look', hanzi: '看', pinyin: 'kàn', english: 'look' });
    if (chance(0.15)) actions.push({ id: 'shake', hanzi: '摇', pinyin: 'yáo', english: 'shake', sets_state: 'nonexistent' });
    objects.push({
      id,
      emoji,
      hanzi: h,
      pinyin: h,
      english: e,
      x,
      y,
      portable: chance(0.5),
      surface: chance(0.4),
      blocks_movement: chance(0.15),
      states,
      initial_state: hasStates ? pick(['closed', 'open', 'missing', '', null] as const) : null,
      actions: chance(0.1) ? null : actions,
      hidden_until: null,
    });
  }
  // Some objects hide inside others (at the container's tile).
  for (const obj of objects) {
    const containers = objects.filter((o) => o !== obj && o.states && o.states.length > 0);
    if (containers.length && chance(0.25)) {
      const c = pick(containers);
      obj.hidden_until = { object: c.id, state: chance(0.85) ? 'open' : 'broken' };
      obj.x = c.x;
      obj.y = c.y;
    }
  }

  const ids = objects.map((o) => o.id);
  const terrainKeys = ['.', 'g', 'r', '#', '~'];
  const leaf = (): QuestCondition => {
    const o = pick(ids);
    switch (int(0, 10)) {
      case 0: return { type: 'holding', object: o };
      case 1: return { type: 'not_holding', object: o };
      case 2: return { type: 'object_at', object: o, x: int(0, width - 1), y: int(0, height - 1) };
      case 3: return { type: 'object_on', object: o, target: pick(ids) };
      case 4: return { type: 'object_on_terrain', object: o, terrain: pick(terrainKeys) };
      case 5: { const [x, y] = pick(walkable); return { type: 'player_at', x, y }; }
      case 6: return { type: 'player_on_terrain', terrain: pick(terrainKeys) };
      case 7: return { type: 'player_next_to', object: o };
      case 8: return { type: 'object_state', object: o, state: pick(['open', 'closed', 'broken']) };
      case 9: return { type: 'object_removed', object: o };
      default: return { type: 'performed', object: o, action: pick(['open', 'close', 'eat', 'look', 'break']) };
    }
  };
  const cond = (depth: number): QuestCondition => {
    if (depth <= 0 || chance(0.5)) return leaf();
    const kids = Array.from({ length: int(1, 3) }, () => cond(depth - 1));
    return { type: pick(['all_of', 'any_of', 'sequence', 'sequence'] as const), conditions: kids };
  };
  const goals = Array.from({ length: int(0, 5) }, (_, i) => ({
    id: `g${i}`,
    instruction: T(`目标${i}`, `goal ${i}`),
    hint: chance(0.5) ? T('提示', 'hint') : null,
    success: chance(0.5) ? T('好！', 'good') : null,
    condition: chance(0.05) ? ({ type: 'mystery' } as unknown as QuestCondition) : cond(3),
  }));

  return {
    schema_version: 1,
    title: T(`世界${seedIndex}`, `World ${seedIndex}`),
    scenario: T('你在这里。', 'You are here.'),
    width,
    height,
    terrain: TERRAIN,
    grid,
    player: { emoji: '🧑', x: px, y: py },
    carry_limit: pick([0, 1, 1, 2, 3]),
    objects,
    goals,
    glossary: [{ hanzi: '拿起', pinyin: 'ná qǐ', english: 'pick up', pos: 'verb', note: null }],
  };
}

/** The kitchen from engine.test.ts with a 先…然后… goal and a sequence nested in all_of. */
function kitchen(): QuestWorld {
  return {
    schema_version: 1,
    title: T('厨房', 'Kitchen'),
    scenario: T('你在厨房。', 'You are in the kitchen.'),
    width: 5,
    height: 4,
    terrain: [TERRAIN[0], TERRAIN[3]],
    grid: ['....#', '....#', '....#', '....#'],
    player: { emoji: '🧑', x: 1, y: 1 },
    carry_limit: 1,
    objects: [
      { id: 'apple', emoji: '🍎', hanzi: '苹果', pinyin: 'píngguǒ', english: 'apple', x: 1, y: 2, portable: true, surface: false, blocks_movement: false, actions: [{ id: 'eat', hanzi: '吃', pinyin: 'chī', english: 'eat', removes_object: true }] },
      { id: 'table', emoji: '🪑', hanzi: '桌子', pinyin: 'zhuōzi', english: 'table', x: 2, y: 2, portable: false, surface: true, blocks_movement: false },
      {
        id: 'fridge', emoji: '🧊', hanzi: '冰箱', pinyin: 'bīngxiāng', english: 'fridge', x: 3, y: 2, portable: false, surface: false, blocks_movement: false,
        states: [{ id: 'closed', hanzi: '关着', pinyin: 'guānzhe', english: 'closed' }, { id: 'open', hanzi: '开着', pinyin: 'kāizhe', english: 'open', emoji: '🥶' }],
        initial_state: 'closed',
        actions: [
          { id: 'open', hanzi: '打开', pinyin: 'dǎkāi', english: 'open', requires_state: 'closed', sets_state: 'open' },
          { id: 'close', hanzi: '关上', pinyin: 'guānshàng', english: 'close', requires_state: 'open', sets_state: 'closed' },
        ],
      },
      { id: 'milk', emoji: '🥛', hanzi: '牛奶', pinyin: 'niúnǎi', english: 'milk', x: 3, y: 2, portable: true, surface: false, blocks_movement: false, hidden_until: { object: 'fridge', state: 'open' } },
    ],
    goals: [
      { id: 'g1', instruction: T('拿起苹果。', 'Pick up the apple.'), condition: { type: 'holding', object: 'apple' } },
      { id: 'g2', instruction: T('把苹果放在桌子上。', 'Put the apple on the table.'), condition: { type: 'object_on', object: 'apple', target: 'table' } },
      {
        id: 'g3',
        instruction: T('先打开冰箱，然后拿牛奶。', 'Open the fridge, then take the milk.'),
        condition: { type: 'sequence', conditions: [{ type: 'object_state', object: 'fridge', state: 'open' }, { type: 'holding', object: 'milk' }] },
      },
      {
        id: 'g4',
        instruction: T('关上冰箱，吃苹果。', 'Close the fridge and eat the apple.'),
        condition: { type: 'all_of', conditions: [{ type: 'sequence', conditions: [{ type: 'performed', object: 'fridge', action: 'close' }, { type: 'not_holding', object: 'milk' }] }, { type: 'object_removed', object: 'apple' }] },
      },
    ],
    glossary: [],
  };
}

function snapshot(s: QuestState) {
  return {
    player: [s.player.x, s.player.y],
    objects: s.world.objects.map((o) => {
      const r = s.objects[o.id];
      return [o.id, r.x, r.y, r.state, r.held, r.removed, r.revealed, isVisible(s, o.id), emojiFor(o, r)];
    }),
    held: s.held,
    sequenceProgress: Object.entries(s.sequenceProgress).sort(([a], [b]) => (a < b ? -1 : 1)),
    performed: s.performed.map((p) => [p.object, p.action]),
    completedGoals: s.completedGoals,
    activeGoalIndex: s.activeGoalIndex,
    moves: s.moves,
    finished: s.finished,
    reach: objectsInReach(s).map((o) => o.id),
    verbs: availableActions(s).map((v) => [v.object.id, v.action.id]),
    canMove: (['up', 'down', 'left', 'right'] as QuestDirection[]).map((d) => canMove(s, d)),
    canPickUp: s.world.objects.map((o) => canPickUp(s, o)),
    progress: activeGoalProgress(s),
  };
}

function chooseAction(s: QuestState): QuestPlayerAction {
  const ids = s.world.objects.map((o) => o.id);
  const r = rand();
  if (r < 0.45) return { type: 'move', direction: pick(['up', 'down', 'left', 'right'] as const) };
  if (r < 0.6) {
    const verbs = availableActions(s);
    if (verbs.length) { const v = pick(verbs); return { type: 'interact', object: v.object.id, action: v.action.id }; }
  }
  if (r < 0.72) {
    const reach = objectsInReach(s).filter((o) => o.portable);
    if (reach.length) return { type: 'pick_up', object: pick(reach).id };
  }
  if (r < 0.82 && s.held.length) return { type: 'put_down', object: pick(s.held) };
  // nonsense: unknown ids, unavailable verbs, far objects
  switch (int(0, 3)) {
    case 0: return { type: 'pick_up', object: chance(0.2) ? 'ghost' : pick(ids.length ? ids : ['ghost']) };
    case 1: return { type: 'put_down', object: chance(0.2) ? 'ghost' : pick(ids.length ? ids : ['ghost']) };
    case 2: return { type: 'interact', object: chance(0.2) ? 'ghost' : pick(ids.length ? ids : ['ghost']), action: pick(['open', 'close', 'eat', 'look', 'break', 'fly']) };
    default: return { type: 'move', direction: pick(['up', 'down', 'left', 'right'] as const) };
  }
}

const scripted: QuestPlayerAction[] = [
  { type: 'pick_up', object: 'apple' }, { type: 'move', direction: 'right' }, { type: 'move', direction: 'down' },
  { type: 'put_down', object: 'apple' }, { type: 'pick_up', object: 'milk' }, { type: 'interact', object: 'fridge', action: 'open' },
  { type: 'pick_up', object: 'milk' }, { type: 'interact', object: 'fridge', action: 'close' }, { type: 'put_down', object: 'milk' },
  { type: 'interact', object: 'apple', action: 'eat' }, { type: 'move', direction: 'right' }, { type: 'move', direction: 'right' },
];

/** Facts that were true at some point of a play-through — goals a replay of it will reach. */
function factsOf(s: QuestState): QuestCondition[] {
  const out: QuestCondition[] = [{ type: 'player_at', x: s.player.x, y: s.player.y }];
  for (const id of s.held) out.push({ type: 'holding', object: id });
  for (const o of s.world.objects) {
    const r = s.objects[o.id];
    if (r.removed) out.push({ type: 'object_removed', object: o.id });
    else if (r.state) out.push({ type: 'object_state', object: o.id, state: r.state });
    if (!r.held && !r.removed) {
      out.push({ type: 'object_at', object: o.id, x: r.x, y: r.y });
      const t = s.world.grid[r.y]?.[r.x];
      if (t) out.push({ type: 'object_on_terrain', object: o.id, terrain: t });
      for (const other of s.world.objects) {
        const q = s.objects[other.id];
        if (other.id !== o.id && !q.held && !q.removed && q.x === r.x && q.y === r.y) out.push({ type: 'object_on', object: o.id, target: other.id });
      }
    }
  }
  for (const p of s.performed.slice(-2)) out.push({ type: 'performed', object: p.object, action: p.action });
  return out;
}

/** Plays [world] without goals, then gives it goals built from what happened along the way. */
function withReachableGoals(world: QuestWorld, actions: QuestPlayerAction[]): QuestWorld {
  let s = createQuestState({ ...world, goals: [] });
  const moments: QuestCondition[][] = [];
  for (const a of actions) {
    s = applyQuestAction(s, a).state;
    moments.push(factsOf(s));
  }
  const goals: QuestWorld['goals'] = [];
  let at = 0;
  const count = int(1, 5);
  for (let g = 0; g < count && at < moments.length; g++) {
    at = Math.min(moments.length - 1, at + int(1, Math.max(1, Math.floor(moments.length / count))));
    const now = moments[at];
    let condition: QuestCondition = pick(now);
    const shape = rand();
    if (shape < 0.3) {
      // 先…然后…: something from earlier, then something from now
      const earlier = moments[int(0, at)];
      condition = { type: 'sequence', conditions: [pick(earlier), pick(now)] };
    } else if (shape < 0.45) {
      condition = { type: 'all_of', conditions: [pick(now), pick(now)] };
    } else if (shape < 0.55) {
      condition = { type: 'any_of', conditions: [pick(now), { type: 'player_at', x: -1, y: -1 }] };
    } else if (shape < 0.62) {
      condition = { type: 'all_of', conditions: [{ type: 'sequence', conditions: [pick(moments[int(0, at)]), pick(now)] }, pick(now)] };
    }
    goals.push({ id: `r${g}`, instruction: T(`目标${g}`, `goal ${g}`), condition });
  }
  return { ...world, goals };
}

function randomActions(world: QuestWorld, n: number): QuestPlayerAction[] {
  let s = createQuestState({ ...world, goals: [] });
  const out: QuestPlayerAction[] = [];
  for (let i = 0; i < n; i++) {
    const a = chooseAction(s);
    out.push(a);
    s = applyQuestAction(s, a).state;
  }
  return out;
}

const games: unknown[] = [];
const plays: { world: QuestWorld; actions: QuestPlayerAction[] | null }[] = [{ world: kitchen(), actions: scripted }];
for (let i = 0; i < 260; i++) {
  const world = randomWorld(i);
  if (chance(0.6)) {
    const actions = randomActions(world, int(15, 80));
    plays.push({ world: withReachableGoals(world, actions), actions });
  } else {
    plays.push({ world, actions: null });
  }
}
for (const { world, actions } of plays) {
  let state = createQuestState(world);
  const steps: unknown[] = [];
  const n = actions ? actions.length : int(10, 80);
  for (let i = 0; i < n; i++) {
    if (!actions && chance(0.01)) {
      state = resetQuestState(state);
      steps.push({ action: { type: 'reset' }, snapshot: snapshot(state) });
      continue;
    }
    const action = actions ? actions[i] : chooseAction(state);
    const result = applyQuestAction(state, action);
    steps.push({
      action,
      ok: result.ok,
      rejection: result.rejection ?? null,
      completedGoals: result.completedGoals,
      justFinished: result.justFinished,
      snapshot: snapshot(result.state),
    });
    state = result.state;
  }
  games.push({
    world,
    initial: snapshot(createQuestState(world)),
    conditionObjects: world.goals.map((g) => conditionObjectIds(g.condition)),
    steps,
  });
}

writeFileSync(join(OUT, 'quest.json'), JSON.stringify({ games }));
