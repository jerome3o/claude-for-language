import { describe, expect, it } from 'vitest';
import {
  conditionHolds, formatDuration, hintDue, hintTargets, HINT_AFTER_MS, initialSnapshot, resolveTarget, skipTask, startRun, stepRun,
  surfaceBox, zoneBox, sequenceProgress,
} from './engine';
import { placeBox, localBounds } from './geometry';
import { rigOffsetTransform, rigToWorld, snapTurnRig, teleportArc, teleportRig, worldToRig, type Rig } from './rig';
import { validateWorld, wordProblems } from './validate';
import { testWorld } from './testWorld';
import type { Vec3, WorldSnapshot, WorldSpec } from './types';

function snap(world: WorldSpec, t: number, patch: Record<string, Partial<WorldSnapshot['objects'][string]>> = {}, player?: Vec3): WorldSnapshot {
  const s = initialSnapshot(world, t);
  for (const [id, p] of Object.entries(patch)) s.objects[id] = { ...s.objects[id], ...p };
  if (player) s.player = player;
  return s;
}

describe('validateWorld', () => {
  it('accepts the test world', () => {
    expect(validateWorld(testWorld())).toEqual({ ok: true, problems: [] });
  });

  it('refuses bad words (card standard)', () => {
    expect(wordProblems({ hanzi: '杯子/杯', pinyin: 'bēizi', english: 'cup' }, 'x').join()).toMatch(/Han characters only/);
    expect(wordProblems({ hanzi: '杯子', pinyin: 'bei1zi', english: 'cup' }, 'x').join()).toMatch(/pinyin/);
    expect(wordProblems({ hanzi: '杯子', pinyin: 'beizi', english: 'cup' }, 'x').join()).toMatch(/no tone mark/);
    expect(wordProblems({ hanzi: '杯子', pinyin: 'bēizi', english: 'cup / mug' }, 'x').join()).toMatch(/ONE meaning/);
    expect(wordProblems({ hanzi: '杯子', pinyin: 'bēizi', english: 'cup', measure: '个个' }, 'x').join()).toMatch(/measure/);
    expect(wordProblems({ hanzi: '杯子', pinyin: 'bēizi', english: 'cup', example: { hanzi: '我有一个杯。', pinyin: 'x', english: 'y' } }, 'x').join()).toMatch(/contain/);
    expect(wordProblems({ hanzi: '杯子', pinyin: 'bēizi', english: 'cup', measure: '个' }, 'x')).toEqual([]);
  });

  it('refuses dangling references and impossible tasks', () => {
    const w = testWorld();
    w.tasks = [
      { id: 'a', zh: '拿起桌子。', pinyin: 'Náqǐ zhuōzi.', en: 'Pick up the table.', done: { holding: 'table' } },
      { id: 'b', zh: '把杯子放在苹果上。', pinyin: 'Bǎ bēizi fàng zài píngguǒ shang.', en: 'x', done: { on: 'cup', surface: 'apple' } },
      { id: 'c', zh: '打开冰箱。', pinyin: 'Dǎkāi bīngxiāng.', en: 'x', done: { state: 'box', key: 'door', value: 'open' } },
      { id: 'd', zh: '放三个。', pinyin: 'Fàng sān gè.', en: 'x', done: { count_in_zone: '#fruit', zone: 'basket', n: 3 } },
      { id: 'e', zh: '走。', pinyin: 'Zǒu.', en: 'x', done: { player_in: 'nowhere' } },
      { id: 'f', zh: '拿。', pinyin: 'Ná.', en: 'x', done: { holding: '#nothing' } },
      { id: 'g', zh: '拿', pinyin: 'Ná.', en: 'x', done: { sequence: [] } },
    ];
    const r = validateWorld(w);
    expect(r.ok).toBe(false);
    const text = r.problems.join('\n');
    expect(text).toMatch(/"table" can't be picked up/);
    expect(text).toMatch(/"apple" is neither a zone nor a surface/);
    expect(text).toMatch(/has no state "door"/);
    expect(text).toMatch(/asks for 3 but only 2/);
    expect(text).toMatch(/"nowhere" is not a zone/);
    expect(text).toMatch(/"#nothing" names no object/);
    expect(text).toMatch(/should end with/);
    expect(text).toMatch(/needs at least one step/);
  });

  it('refuses a task that is done before anything moves, and objects outside the bounds', () => {
    const w = testWorld();
    w.tasks = [{ id: 'a', zh: '看。', pinyin: 'Kàn.', en: 'x', done: { not: { holding: 'cup' } } }];
    w.objects[1].at = [9, 0.05, 0];
    const text = validateWorld(w).problems.join('\n');
    expect(text).toMatch(/already done/);
    expect(text).toMatch(/"cup": it starts \(partly\) outside the bounds/);
  });
});

describe('geometry', () => {
  it('turns a box about Y', () => {
    const b = placeBox({ min: [-1, 0, -0.1], max: [1, 1, 0.1] }, [0, 0, 0], Math.PI / 2);
    expect(b.min[0]).toBeCloseTo(-0.1);
    expect(b.max[2]).toBeCloseTo(1);
    expect(localBounds({ collider: { cylinder: [0.04, 0.1] } })).toEqual({ min: [-0.04, -0.05, -0.04], max: [0.04, 0.05, 0.04] });
  });

  it('zones move with their object; surfaces are the top of the object', () => {
    const w = testWorld();
    const s = snap(w, 0, { basket: { pos: [0, 0.1, 0] } });
    expect(zoneBox(w, 'basket', s)?.min[0]).toBeCloseTo(-0.2);
    expect(zoneBox(w, 'door', s)).toEqual({ min: [-3, 0, 2], max: [-2, 2.5, 3] });
    expect(zoneBox(w, 'cup', s)).toBeNull();
    const top = surfaceBox(w, 'table', s)!;
    expect(top.min[1]).toBeCloseTo(0.72);
  });
});

describe('the task engine', () => {
  it('plays the test world through', () => {
    const w = testWorld();
    let run = startRun(w, 0);
    // 1 holding
    let r = stepRun(w, run, snap(w, 100));
    expect(r.completed).toBeNull();
    r = stepRun(w, r.run, snap(w, 200, { cup: { held: true } }), [{ type: 'grab', obj: 'cup' }]);
    expect(r.completed?.id).toBe('pick_cup');
    // 2 on the table: moving doesn't count, settled does
    r = stepRun(w, r.run, snap(w, 300, { cup: { pos: [0.1, 0.8, -1], speed: 1 } }));
    expect(r.completed).toBeNull();
    r = stepRun(w, r.run, snap(w, 400, { cup: { pos: [0.1, 0.8, -1], speed: 0.01 } }));
    expect(r.completed?.id).toBe('cup_on_table');
    // 3 two apples in the basket (one isn't enough; held doesn't count)
    r = stepRun(w, r.run, snap(w, 500, { apple: { pos: [1.5, 0.1, -1.5] }, apple_2: { pos: [1.5, 0.12, -1.5], held: true } }));
    expect(r.completed).toBeNull();
    r = stepRun(w, r.run, snap(w, 600, { apple: { pos: [1.5, 0.1, -1.5] }, apple_2: { pos: [1.45, 0.12, -1.5] } }));
    expect(r.completed?.id).toBe('apples_basket');
    // 4 sequence: walking to the door first doesn't count
    r = stepRun(w, r.run, snap(w, 700, {}, [-2.5, 1.6, 2.5]));
    expect(r.completed).toBeNull();
    expect(sequenceProgress(w.tasks[3], r.run)).toEqual({ step: 0, of: 2 });
    r = stepRun(w, r.run, snap(w, 800, { box: { states: { lid: 'open' } } }, [0, 1.6, 0]), [{ type: 'use', obj: 'box' }]);
    expect(sequenceProgress(w.tasks[3], r.run)).toEqual({ step: 1, of: 2 });
    r = stepRun(w, r.run, snap(w, 900, { box: { states: { lid: 'closed' } } }, [-2.5, 1.6, 2.5]));
    expect(r.completed?.id).toBe('open_then_door');
    // 5 throw: a slow drop into the basket doesn't count, a throw that passes through does
    r = stepRun(w, r.run, snap(w, 1000, { cup: { pos: [1.5, 0.1, -1.5] } }), [{ type: 'release', obj: 'cup', speed: 0.2 }]);
    expect(r.completed).toBeNull();
    r = stepRun(w, r.run, snap(w, 1100, { cup: { pos: [0, 1, 0], speed: 4 } }), [{ type: 'release', obj: 'cup', speed: 4 }]);
    expect(r.run.airborne.cup).toBe(1100);
    r = stepRun(w, r.run, snap(w, 1200, { cup: { pos: [1.5, 0.15, -1.5], speed: 3 } }));
    expect(r.completed?.id).toBe('throw');
    expect(r.finished).toBe(true);
    expect(r.run.finishedAt).toBe(1200);
    expect(r.run.done).toEqual(['pick_cup', 'cup_on_table', 'apples_basket', 'open_then_door', 'throw']);
  });

  it('does not mutate the run it was given', () => {
    const w = testWorld();
    const run = startRun(w, 0);
    const copy = JSON.stringify(run);
    stepRun(w, run, snap(w, 1, { cup: { held: true } }), [{ type: 'grab', obj: 'cup' }]);
    expect(JSON.stringify(run)).toBe(copy);
  });

  it('a caught throw stops being airborne', () => {
    const w = testWorld();
    let r = stepRun(w, { ...startRun(w, 0), taskIndex: 4 }, snap(w, 0), [{ type: 'release', obj: 'cup', speed: 5 }]);
    r = stepRun(w, r.run, snap(w, 100, { cup: { held: true } }), [{ type: 'grab', obj: 'cup' }]);
    expect(r.run.airborne.cup).toBeUndefined();
    r = stepRun(w, r.run, snap(w, 200, { cup: { pos: [1.5, 0.1, -1.5] } }));
    expect(r.completed).toBeNull();
  });

  it('performed, near, any_of and not', () => {
    const w = testWorld();
    const s = snap(w, 0, { cup: { pos: [-1.1, 0.05, 0] } });
    expect(conditionHolds(w, { near: 'cup', to: '#fruit' }, s)).toBe(true);
    expect(conditionHolds(w, { near: 'cup', to: '#fruit', within: 0.05 }, s)).toBe(false);
    expect(conditionHolds(w, { any_of: [{ holding: 'cup' }, { not: { holding: 'apple' } }] }, s)).toBe(true);
    const r = stepRun(w, { ...startRun(w, 0) }, s, [{ type: 'inspect', obj: 'table' }]);
    expect(r.run.performed).toContain('inspect:table');
    expect(resolveTarget(w, '#fruit')).toEqual(['apple', 'apple_2']);
  });

  it('skips, hints and durations', () => {
    const w = testWorld();
    const run = skipTask(w, startRun(w, 0), 50);
    expect(run.taskIndex).toBe(1);
    expect(run.done).toEqual([]);
    expect(hintDue(run, 50 + HINT_AFTER_MS - 1)).toBe(false);
    expect(hintDue(run, 50 + HINT_AFTER_MS)).toBe(true);
    expect(hintTargets(w, w.tasks[1])).toEqual(['cup', 'table']);
    expect(hintTargets(w, w.tasks[2])).toEqual(['apple', 'apple_2', 'basket']);
    expect(formatDuration(187_000)).toBe('3:07');
  });
});

describe('the rig (teleport, snap turn)', () => {
  const close = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

  it('teleport puts the head over the target', () => {
    const rig: Rig = { x: 1, y: 0, z: 2, yaw: 0.7 };
    const head: Vec3 = [0.4, 1.6, -0.3];
    const moved = teleportRig(rig, head, [3, 0, -1]);
    const h = rigToWorld(moved, head);
    expect(h[0]).toBeCloseTo(3);
    expect(h[2]).toBeCloseTo(-1);
    close(worldToRig(moved, h), head);
  });

  it('snap turn keeps the head where it is', () => {
    const rig: Rig = { x: 1, y: 0, z: 2, yaw: 0.2 };
    const head: Vec3 = [0.5, 1.6, 0.4];
    const before = rigToWorld(rig, head);
    const turned = snapTurnRig(rig, head, Math.PI / 6);
    close(rigToWorld(turned, head), before);
    expect(turned.yaw).toBeCloseTo(0.2 + Math.PI / 6);
  });

  it('the offset transform is the inverse of the rig', () => {
    const rig: Rig = { x: 2, y: -1.5, z: -3, yaw: 1.1 };
    const t = rigOffsetTransform(rig);
    // Apply the offset to the rig origin's world position: should land on the base origin.
    const [qx, qy, qz, qw] = t.orientation;
    expect(qx).toBe(0);
    expect(qz).toBe(0);
    const yaw = 2 * Math.atan2(qy, qw);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const p: Vec3 = [rig.x, rig.y, rig.z];
    const rotated: Vec3 = [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
    close([rotated[0] + t.position[0], rotated[1] + t.position[1], rotated[2] + t.position[2]], [0, 0, 0]);
  });

  it('the teleport arc falls to the floor', () => {
    const pts = teleportArc([0, 1.2, 0], [0, 0.5, -0.866]);
    expect(pts.length).toBeGreaterThan(5);
    expect(pts[pts.length - 1][1]).toBeLessThan(0);
    expect(pts[pts.length - 1][2]).toBeLessThan(-3);
  });
});
