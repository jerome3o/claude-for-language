/**
 * The VR world validator (docs/VR_WORLDS.md "Tests a world must pass"): every object's word follows the
 * card standard, every task's references exist and make sense (you can only hold what has mass, `on`
 * needs a surface, a state value must be declared…), zones and objects sit inside the bounds, and no
 * task is already done before the learner moves. `frontend/src/vr/worlds/registry.test.ts` runs it on
 * every registered world, so a world that breaks a rule never ships.
 */
import { cardTextProblems } from '../cards/standard';
import { colliderParts, inBox, localBounds, placeBox, boxInside, type Box3 } from './geometry';
import { conditionHolds, conditionObjects, initialSnapshot, resolveTarget } from './engine';
import {
  WORLD_MATERIALS, type Vec3, type WorldCondition, type WorldObjectSpec, type WorldSpec, type WorldWord,
} from './types';

export type WorldValidation = { ok: true; problems: [] } | { ok: false; problems: string[] };

const TOKEN = /^[a-z][a-z0-9_]*$/;
const HAN_ONLY = /^\p{Script=Han}+$/u;
const HAS_HAN = /\p{Script=Han}/u;
const PINYIN_CHARS = /^[a-zA-ZāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜê'’ ,.!?·-]+$/;
const TONE_MARK = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i;
const ACTIONS = ['grab', 'release', 'throw', 'use', 'inspect'];
const MAX_TASKS = 20;

function finiteVec(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Problems with one word (a label on an object, a state, a zone). */
export function wordProblems(w: WorldWord | undefined, where: string): string[] {
  const out: string[] = [];
  if (!w || typeof w !== 'object') return [`${where}: missing word`];
  if (typeof w.hanzi !== 'string' || !HAN_ONLY.test(w.hanzi)) out.push(`${where}: hanzi "${w?.hanzi}" must be Han characters only (one clean form)`);
  if (typeof w.pinyin !== 'string' || !w.pinyin.trim()) out.push(`${where}: pinyin is missing`);
  else if (!PINYIN_CHARS.test(w.pinyin)) out.push(`${where}: pinyin "${w.pinyin}" has characters pinyin never has (tone marks, not numbers)`);
  else if (!TONE_MARK.test(w.pinyin)) out.push(`${where}: pinyin "${w.pinyin}" has no tone mark`);
  if (typeof w.english !== 'string' || !w.english.trim()) out.push(`${where}: english is missing`);
  else if (/[\/|;]/.test(w.english)) out.push(`${where}: english "${w.english}" must be ONE meaning (other senses go in fun_facts)`);
  else if (w.english.length > 60) out.push(`${where}: english is too long (≤ 60 characters)`);
  if (w.measure !== undefined && !(typeof w.measure === 'string' && HAN_ONLY.test(w.measure) && [...w.measure].length === 1)) {
    out.push(`${where}: measure "${w.measure}" must be one Han character (个, 只, 张 …)`);
  }
  if (w.example !== undefined) {
    const ex = w.example;
    if (!ex || typeof ex.hanzi !== 'string' || !ex.hanzi.includes(w.hanzi)) out.push(`${where}: example sentence must contain "${w.hanzi}" exactly`);
    else if (!ex.pinyin?.trim() || !ex.english?.trim()) out.push(`${where}: example needs pinyin and english`);
  }
  for (const p of cardTextProblems({ hanzi: w.hanzi, pinyin: w.pinyin, sentence_clue: w.example?.hanzi })) out.push(`${where}: ${p.message}`);
  return out;
}

function boxOk(min: unknown, max: unknown): boolean {
  return finiteVec(min) && finiteVec(max) && min[0] < max[0] && min[1] < max[1] && min[2] < max[2];
}

function grabbable(o: WorldObjectSpec | undefined): boolean {
  return !!o && o.mass > 0;
}

export function validateWorld(world: WorldSpec): WorldValidation {
  const problems: string[] = [];
  const p = (msg: string) => problems.push(msg);

  if (typeof world.id !== 'string' || !TOKEN.test(world.id)) p(`world id "${world.id}" must be a lowercase token`);
  if (typeof world.title_zh !== 'string' || !HAS_HAN.test(world.title_zh)) p('title_zh must be Chinese');
  if (typeof world.title_en !== 'string' || !world.title_en.trim()) p('title_en is missing');
  if (typeof world.blurb !== 'string' || !world.blurb.trim()) p('blurb is missing');
  const boundsOk = boxOk(world.bounds?.min, world.bounds?.max);
  if (!boundsOk) p('bounds must be a box (min < max on every axis)');
  const bounds: Box3 = boundsOk ? world.bounds : { min: [-1e9, -1e9, -1e9], max: [1e9, 1e9, 1e9] };
  if (!finiteVec(world.spawn?.at) || typeof world.spawn?.yaw !== 'number' || !Number.isFinite(world.spawn.yaw)) p('spawn needs at [x, y, z] and yaw');
  else if (!inBox(world.spawn.at, bounds)) p('spawn is outside the bounds');

  // ── objects ──
  const objects = Array.isArray(world.objects) ? world.objects : [];
  if (objects.length === 0) p('a world needs objects');
  const ids = new Set<string>();
  for (const o of objects) {
    const where = `object "${o?.id}"`;
    if (typeof o?.id !== 'string' || !TOKEN.test(o.id)) { p(`${where}: id must be a lowercase token`); continue; }
    if (ids.has(o.id)) p(`${where}: duplicate id`);
    ids.add(o.id);
    problems.push(...wordProblems(o.word, where));
    if (!(WORLD_MATERIALS as readonly string[]).includes(o.material)) p(`${where}: material must be one of ${WORLD_MATERIALS.join(', ')}`);
    if (typeof o.mass !== 'number' || !Number.isFinite(o.mass) || o.mass < 0) p(`${where}: mass must be ≥ 0 kg (0 = fixed)`);
    else if (o.mass > 60) p(`${where}: mass over 60 kg — make it fixed (mass 0) instead`);
    if (!finiteVec(o.at)) { p(`${where}: at must be [x, y, z]`); continue; }
    if (o.yaw !== undefined && !Number.isFinite(o.yaw)) p(`${where}: yaw must be a number`);
    for (const t of o.tags ?? []) if (!TOKEN.test(t)) p(`${where}: tag "${t}" must be a lowercase token`);
    const stateKeys = new Map<string, string[]>();
    for (const s of o.states ?? []) {
      const vals = Object.keys(s?.values ?? {});
      if (!TOKEN.test(s?.key ?? '')) p(`${where}: state key "${s?.key}" must be a lowercase token`);
      if (vals.length < 2) p(`${where}: state "${s?.key}" needs at least two values`);
      if (!vals.includes(s?.initial)) p(`${where}: state "${s?.key}" initial "${s?.initial}" is not one of its values`);
      for (const v of vals) {
        if (!TOKEN.test(v)) p(`${where}: state value "${v}" must be a lowercase token`);
        problems.push(...wordProblems(s.values[v]?.verb, `${where} state ${s.key}=${v} verb`));
        problems.push(...wordProblems(s.values[v]?.label, `${where} state ${s.key}=${v} label`));
      }
      stateKeys.set(s.key, vals);
    }
    const parts = colliderParts(o);
    if (parts.length === 0) p(`${where}: collider has no parts`);
    for (const part of parts) {
      const sizes = 'box' in part ? part.box : 'ball' in part ? [part.ball] : 'cylinder' in part ? part.cylinder : null;
      if (!sizes || !sizes.every((n: number) => Number.isFinite(n) && n > 0)) p(`${where}: collider sizes must be positive numbers`);
      if (part.offset !== undefined && !finiteVec(part.offset)) p(`${where}: collider offset must be [x, y, z]`);
      for (const [k, v] of Object.entries(part.when ?? {})) {
        if (!stateKeys.get(k)?.includes(v)) p(`${where}: collider part "when" names ${k}=${v}, which the object doesn't have`);
      }
    }
    if (o.mass > 0 && parts.some((x) => x.when)) p(`${where}: only fixed objects (mass 0) may change colliders by state`);
    if (o.inside && !boxOk(o.inside.min, o.inside.max)) p(`${where}: inside must be a box (min < max)`);
    const placed = placeBox(localBounds(o), o.at, o.yaw ?? 0);
    if (!boxInside(placed, bounds, 0.01)) p(`${where}: it starts (partly) outside the bounds`);
    if (placed.min[1] < -0.02) p(`${where}: it starts below the floor`);
  }

  // ── zones ──
  const zoneIds = new Set<string>();
  for (const z of world.zones ?? []) {
    const where = `zone "${z?.id}"`;
    if (typeof z?.id !== 'string' || !TOKEN.test(z.id)) { p(`${where}: id must be a lowercase token`); continue; }
    if (zoneIds.has(z.id) || ids.has(z.id)) p(`${where}: id already used by another zone or object`);
    zoneIds.add(z.id);
    if (!boxOk(z.min, z.max)) p(`${where}: must be a box (min < max)`);
    else if (!boxInside({ min: z.min, max: z.max }, bounds, 0.01)) p(`${where}: outside the bounds`);
    if (z.word) problems.push(...wordProblems(z.word, where));
  }

  const byId = new Map(objects.map((o) => [o.id, o]));
  const isZoneRef = (ref: string) => zoneIds.has(ref) || !!byId.get(ref)?.inside;
  const isSurfaceRef = (ref: string) => zoneIds.has(ref) || !!byId.get(ref)?.surface;

  // ── tasks ──
  const tasks = Array.isArray(world.tasks) ? world.tasks : [];
  if (tasks.length === 0) p('a world needs tasks');
  if (tasks.length > MAX_TASKS) p(`at most ${MAX_TASKS} tasks`);
  const taskIds = new Set<string>();
  const start = boundsOk && objects.length > 0 && finiteVec(world.spawn?.at) ? initialSnapshot(world) : null;
  // Objects an earlier task already asks to change: a later task about them ("close the fridge" after
  // "open the fridge") may well hold at the very start.
  const touched = new Set<string>();
  for (const t of tasks) {
    const where = `task "${t?.id}"`;
    if (typeof t?.id !== 'string' || !TOKEN.test(t.id)) { p(`${where}: id must be a lowercase token`); continue; }
    if (taskIds.has(t.id)) p(`${where}: duplicate id`);
    taskIds.add(t.id);
    if (typeof t.zh !== 'string' || !HAS_HAN.test(t.zh)) p(`${where}: zh must be a Chinese instruction`);
    else if (!/[。！？]$/.test(t.zh.trim())) p(`${where}: zh should end with 。 ！ or ？`);
    if (typeof t.pinyin !== 'string' || !TONE_MARK.test(t.pinyin)) p(`${where}: pinyin (with tone marks) is missing`);
    if (typeof t.en !== 'string' || !t.en.trim()) p(`${where}: en is missing`);
    const before = problems.length;
    checkCondition(t.done, `${where} done`);
    for (const h of t.hint ?? []) if (resolveTarget(world, h).length === 0) p(`${where}: hint "${h}" names nothing`);
    if (problems.length === before && start) {
      const names = conditionObjects(world, t.done);
      const earlier = names.some((id) => touched.has(id));
      if (!earlier && conditionHolds(world, t.done, start)) p(`${where}: is already done before the learner moves`);
      for (const id of names) touched.add(id);
    }
  }

  function target(ref: unknown, where: string, needGrab: boolean): void {
    if (typeof ref !== 'string' || !ref) { p(`${where}: target missing`); return; }
    const hit = resolveTarget(world, ref);
    if (hit.length === 0) { p(`${where}: "${ref}" names no object`); return; }
    if (needGrab && !hit.some((id) => grabbable(byId.get(id)))) p(`${where}: "${ref}" can't be picked up (mass 0)`);
  }

  function checkCondition(c: WorldCondition | undefined, where: string): void {
    if (!c || typeof c !== 'object') { p(`${where}: missing condition`); return; }
    const keys = Object.keys(c);
    if ('holding' in c) target(c.holding, `${where} holding`, true);
    else if ('in_zone' in c) {
      target(c.in_zone, `${where} in_zone`, true);
      if (!isZoneRef(c.zone)) p(`${where} in_zone: zone "${c.zone}" is neither a zone nor an object with an inside`);
    } else if ('on' in c) {
      target(c.on, `${where} on`, true);
      if (!isSurfaceRef(c.surface)) p(`${where} on: "${c.surface}" is neither a zone nor a surface object`);
    } else if ('near' in c) {
      target(c.near, `${where} near`, false);
      target(c.to, `${where} near.to`, false);
      if (c.within !== undefined && !(Number.isFinite(c.within) && c.within > 0 && c.within <= 3)) p(`${where} near: within must be 0–3 m`);
      const movable = [...resolveTarget(world, c.near), ...resolveTarget(world, c.to)].some((id) => grabbable(byId.get(id)));
      if (!movable) p(`${where} near: neither side can move`);
    } else if ('state' in c) {
      const o = byId.get(c.state);
      const s = o?.states?.find((x) => x.key === c.key);
      if (!o) p(`${where} state: no object "${c.state}"`);
      else if (!s) p(`${where} state: "${c.state}" has no state "${c.key}"`);
      else if (!(c.value in s.values)) p(`${where} state: "${c.value}" is not a value of ${c.state}.${c.key}`);
    } else if ('thrown_into' in c) {
      target(c.thrown_into, `${where} thrown_into`, true);
      if (!isZoneRef(c.zone)) p(`${where} thrown_into: zone "${c.zone}" is neither a zone nor an object with an inside`);
    } else if ('count_in_zone' in c) {
      target(c.count_in_zone, `${where} count_in_zone`, true);
      if (!isZoneRef(c.zone)) p(`${where} count_in_zone: zone "${c.zone}" is neither a zone nor an object with an inside`);
      const n = resolveTarget(world, c.count_in_zone).filter((id) => grabbable(byId.get(id)) && id !== c.zone).length;
      if (!Number.isInteger(c.n) || c.n < 1) p(`${where} count_in_zone: n must be a whole number ≥ 1`);
      else if (c.n > n) p(`${where} count_in_zone: asks for ${c.n} but only ${n} can be moved`);
    } else if ('player_in' in c) {
      if (!zoneIds.has(c.player_in)) p(`${where} player_in: "${c.player_in}" is not a zone`);
    } else if ('performed' in c) {
      if (!ACTIONS.includes(c.performed)) p(`${where} performed: action must be one of ${ACTIONS.join(', ')}`);
      if (c.target !== undefined) {
        target(c.target, `${where} performed`, c.performed !== 'use' && c.performed !== 'inspect');
        if (c.performed === 'use' && !resolveTarget(world, c.target).some((id) => (byId.get(id)?.states ?? []).length > 0)) {
          p(`${where} performed use: "${c.target}" has no state to use`);
        }
      }
    } else if ('not' in c) checkCondition(c.not, `${where} not`);
    else if ('all_of' in c || 'any_of' in c || 'sequence' in c) {
      const list = 'all_of' in c ? c.all_of : 'any_of' in c ? c.any_of : (c as { sequence: WorldCondition[] }).sequence;
      if (!Array.isArray(list) || list.length === 0) p(`${where} ${keys[0]}: needs at least one step`);
      else list.forEach((x, i) => checkCondition(x, `${where} ${keys[0]}[${i}]`));
    } else p(`${where}: unknown condition ${JSON.stringify(keys)}`);
  }

  return problems.length === 0 ? { ok: true, problems: [] } : { ok: false, problems };
}
