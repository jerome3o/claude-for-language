import { describe, expect, it } from 'vitest';
import {
  clampPose,
  dragPose,
  facingYaw,
  freeRingPose,
  bearingFrom,
  headYawFromForward,
  isFinitePose,
  localPoint,
  recallPoses,
  ringPose,
  ringSlotYawOffset,
  trayPose,
  validateVrPanelSpec,
  vrLessonCoverage,
  vrPanelKey,
  vrPanelTitle,
  VR_RING,
} from './index';

const HEAD = { x: 0, y: 1.6, z: 0 };
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

const LESSON = {
  title: '把字句',
  sections: [{ exercises: [
    { type: 'note', title: '把', body: '把 moves the object before the verb.', sentences: [{ hanzi: '我把门关了。', pinyin: 'Wǒ bǎ mén guān le.', english: 'I closed the door.' }] },
    { type: 'choice', question: 'Which is right?', options: [{ hanzi: '我把书看了。' }, { hanzi: '我看了把书。' }], correct: 0 },
    { type: 'scramble', english: 'I closed the door.', tiles: ['门', '我', '关了', '把'], correct_order: ['我', '把', '门', '关了'] },
    { type: 'translate', english: 'Close the window.', reference_hanzi: '把窗户关上。' },
  ] }],
};

describe('validateVrPanelSpec', () => {
  it('accepts every kind with its fields', () => {
    expect(validateVrPanelSpec({ kind: 'study' })).toEqual({ ok: true, spec: { kind: 'study' } });
    expect(validateVrPanelSpec({ kind: 'study', deck_id: 'deck_1' })).toEqual({ ok: true, spec: { kind: 'study', deck_id: 'deck_1' } });
    expect(validateVrPanelSpec({ kind: 'reader', reader_id: 'abc-123' }).ok).toBe(true);
    expect(validateVrPanelSpec({ kind: 'homework' }).ok).toBe(true);
    expect(validateVrPanelSpec({ kind: 'explorer', text: ' 银行 ' })).toEqual({ ok: true, spec: { kind: 'explorer', text: '银行' } });
    expect(validateVrPanelSpec({ kind: 'feedback' }).ok).toBe(true);
    expect(validateVrPanelSpec({ kind: 'lesson_spec', lesson_id: 'l1' }).ok).toBe(true);
    expect(validateVrPanelSpec({ kind: 'lesson_spec', spec: LESSON }).ok).toBe(true);
  });

  it('refuses unknown kinds, unknown keys and non-objects', () => {
    expect(validateVrPanelSpec(null).ok).toBe(false);
    expect(validateVrPanelSpec('study').ok).toBe(false);
    expect(validateVrPanelSpec([{ kind: 'study' }]).ok).toBe(false);
    expect(validateVrPanelSpec({ kind: 'iframe', url: 'https://evil.example' }).ok).toBe(false);
    const extra = validateVrPanelSpec({ kind: 'study', script: 'alert(1)' });
    expect(extra).toEqual({ ok: false, problems: ['"script" is not a study panel field'] });
    expect(validateVrPanelSpec({ kind: 'reader', html: '<b>x</b>' }).ok).toBe(false);
  });

  it('ids are plain tokens — never URLs or markup', () => {
    for (const bad of ['https://x.example/a', '../../etc', '<img>', 'a b', '', 'x'.repeat(65), 42]) {
      expect(validateVrPanelSpec({ kind: 'reader', reader_id: bad }).ok).toBe(false);
    }
  });

  it('explorer text: short, with Chinese in it', () => {
    expect(validateVrPanelSpec({ kind: 'explorer', text: '' }).ok).toBe(false);
    expect(validateVrPanelSpec({ kind: 'explorer', text: 'hello' }).ok).toBe(false);
    expect(validateVrPanelSpec({ kind: 'explorer', text: '中'.repeat(25) }).ok).toBe(false);
    expect(validateVrPanelSpec({ kind: 'explorer', text: 42 }).ok).toBe(false);
  });

  it('a lesson panel needs exactly one of lesson_id / spec, and the spec must be a valid lesson', () => {
    expect(validateVrPanelSpec({ kind: 'lesson_spec' }).ok).toBe(false);
    expect(validateVrPanelSpec({ kind: 'lesson_spec', lesson_id: 'l1', spec: LESSON }).ok).toBe(false);
    const bad = validateVrPanelSpec({ kind: 'lesson_spec', spec: { title: '', sections: [] } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems.every((p) => p.startsWith('spec: '))).toBe(true);
  });

  it('keys and titles', () => {
    expect(vrPanelKey({ kind: 'study', deck_id: 'd' })).toBe('study');
    expect(vrPanelKey({ kind: 'explorer', text: '银' })).toBe('explorer');
    expect(vrPanelKey({ kind: 'lesson_spec', lesson_id: 'l1' })).toBe('lesson:l1');
    expect(vrPanelTitle({ kind: 'lesson_spec', spec: LESSON as never })).toBe('把字句');
    expect(vrPanelTitle({ kind: 'homework' })).toBe('Homework');
  });

  it('lesson coverage counts the exercise types VR can play', () => {
    expect(vrLessonCoverage(LESSON as never)).toEqual({ playable: 3, total: 4 });
  });
});

describe('layout maths', () => {
  it('yaw from a forward vector: looking down −Z is 0, turning left is positive', () => {
    expect(headYawFromForward({ x: 0, y: 0, z: -1 })).toBe(0);
    expect(close(headYawFromForward({ x: -1, y: 0, z: 0 }), Math.PI / 2)).toBe(true);
    expect(close(headYawFromForward({ x: 1, y: 0, z: 0 }), -Math.PI / 2)).toBe(true);
    expect(headYawFromForward({ x: 0, y: -1, z: 0 })).toBe(0);
  });

  it('ring slots: centre, then right and left, widening', () => {
    expect(ringSlotYawOffset(0)).toBe(0);
    expect(ringSlotYawOffset(1)).toBeLessThan(0);
    expect(ringSlotYawOffset(2)).toBeGreaterThan(0);
    expect(close(ringSlotYawOffset(3), 2 * ringSlotYawOffset(1))).toBe(true);
    expect(ringSlotYawOffset(VR_RING.maxSlots)).toBe(0);
  });

  it('a ring window is at arm’s length straight ahead, its top just above the eyes, facing the head', () => {
    const p = ringPose(0, HEAD, 0);
    expect(close(p.x, 0)).toBe(true);
    expect(close(p.z, -VR_RING.radius)).toBe(true);
    expect(close(p.y, HEAD.y + VR_RING.topAboveEyes)).toBe(true);
    expect(close(p.yaw, facingYaw(p, HEAD))).toBe(true);
    const right = ringPose(1, HEAD, 0);
    expect(right.x).toBeGreaterThan(0); // to the right of someone looking down −Z
    expect(close(Math.hypot(right.x, right.z), VR_RING.radius)).toBe(true);
    expect(close(right.yaw, facingYaw(right, HEAD))).toBe(true);
  });

  it('turning the head turns the ring', () => {
    const p = ringPose(0, HEAD, Math.PI / 2); // looking down −X
    expect(close(p.x, -VR_RING.radius)).toBe(true);
    expect(close(p.z, 0)).toBe(true);
  });

  it('a new window takes the first ring slot around the current view that is free', () => {
    expect(freeRingPose([], HEAD, 0)).toEqual(ringPose(0, HEAD, 0));
    const front = ringPose(0, HEAD, 0);
    expect(freeRingPose([front], HEAD, 0)).toEqual(ringPose(1, HEAD, 0));
    expect(freeRingPose([front, ringPose(1, HEAD, 0)], HEAD, 0)).toEqual(ringPose(2, HEAD, 0));
    // turned to the left: the space in front of you is free again
    expect(freeRingPose([front], HEAD, Math.PI / 2)).toEqual(ringPose(0, HEAD, Math.PI / 2));
    expect(bearingFrom(HEAD, ringPose(1, HEAD, 0.3))).toBeCloseTo(ringPose(1, HEAD, 0.3).yaw);
  });

  it('clampPose keeps windows reachable and facing the head', () => {
    const far = clampPose({ x: 0, y: 9, z: -10, yaw: 1 }, HEAD);
    expect(close(Math.hypot(far.x, far.z), VR_RING.maxDistance)).toBe(true);
    expect(far.y).toBe(VR_RING.maxY);
    expect(close(far.yaw, 0)).toBe(true);
    const near = clampPose({ x: 0.05, y: 0, z: 0, yaw: 0 }, HEAD);
    expect(close(Math.hypot(near.x, near.z), VR_RING.minDistance)).toBe(true);
    expect(near.y).toBe(VR_RING.minY);
    const onHead = clampPose({ x: 0, y: 1.6, z: 0, yaw: 0 }, HEAD);
    expect(Number.isFinite(onHead.x) && Number.isFinite(onHead.z)).toBe(true);
  });

  it('localPoint inverts the window rotation', () => {
    const pose = ringPose(2, HEAD, 0.3);
    const local = { x: 0.2, y: -0.1 };
    const world = { x: pose.x + local.x * Math.cos(pose.yaw), y: pose.y + local.y, z: pose.z - local.x * Math.sin(pose.yaw) };
    const back = localPoint(pose, world);
    expect(close(back.x, local.x)).toBe(true);
    expect(close(back.y, local.y)).toBe(true);
  });

  it('dragging keeps the grabbed point under the ray', () => {
    const start = ringPose(0, HEAD, 0);
    const grab = { x: 0.1, y: -0.02 };
    // A ray from the head turned 30° to the left, at the grab distance.
    const yaw = (30 * Math.PI) / 180;
    const dir = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
    const moved = dragPose(HEAD, dir, 0.9, grab, HEAD);
    const hit = { x: HEAD.x + dir.x * 0.9, y: HEAD.y, z: HEAD.z + dir.z * 0.9 };
    const local = localPoint(moved, hit);
    expect(close(local.x, grab.x, 1e-4)).toBe(true);
    expect(close(local.y, grab.y, 1e-6)).toBe(true);
    expect(close(moved.yaw, facingYaw(moved, HEAD), 1e-9)).toBe(true);
    expect(isFinitePose(moved)).toBe(true);
    expect(start.yaw).toBe(0);
  });

  it('recall and tray poses', () => {
    const poses = recallPoses(3, HEAD, 0);
    expect(poses).toHaveLength(3);
    expect(poses[0]).toEqual(ringPose(0, HEAD, 0));
    const tray = trayPose(HEAD, 0);
    expect(tray.y).toBeLessThan(HEAD.y);
    expect(tray.z).toBeLessThan(0);
  });

  it('isFinitePose', () => {
    expect(isFinitePose({ x: 0, y: 1, z: 0, yaw: 0 })).toBe(true);
    expect(isFinitePose({ x: NaN, y: 1, z: 0, yaw: 0 })).toBe(false);
    expect(isFinitePose({ x: 0, y: 1, z: 0 })).toBe(false);
    expect(isFinitePose(null)).toBe(false);
  });
});
