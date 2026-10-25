import { describe, expect, it } from 'vitest';
import { ringPose, VR_RING } from '@shared/vr';
import {
  EMPTY_WINDOWS,
  fromStored,
  initialWindows,
  loadStoredWindows,
  saveStoredWindows,
  toStored,
  VR_MAX_WINDOWS,
  VR_STORAGE_KEY,
  windowsReducer,
  type HeadPose,
  type VrWindowsState,
} from './windowStore';

const HEAD: HeadPose = { position: { x: 0, y: 1.6, z: 0 }, yaw: 0 };

function openAll(...kinds: Array<'study' | 'reader' | 'homework'>): VrWindowsState {
  return kinds.reduce((s, kind) => windowsReducer(s, { type: 'open', spec: { kind }, head: HEAD }), EMPTY_WINDOWS);
}

describe('windowsReducer', () => {
  it('opens windows in ring slots and focuses the new one', () => {
    const s = openAll('study', 'reader');
    expect(s.windows[0].pose).toEqual(ringPose(0, HEAD.position, 0));
    expect(s.windows[1].pose).toEqual(ringPose(1, HEAD.position, 0));
    expect(s.focusedId).toBe(s.windows[1].id);
  });

  it('opening what is open focuses it with the new parameters', () => {
    let s = windowsReducer(EMPTY_WINDOWS, { type: 'open', spec: { kind: 'explorer', text: '银' }, head: HEAD });
    s = windowsReducer(s, { type: 'open', spec: { kind: 'study' }, head: HEAD });
    s = windowsReducer(s, { type: 'open', spec: { kind: 'explorer', text: '行' }, head: HEAD });
    expect(s.windows).toHaveLength(2);
    expect(s.windows[0].spec).toEqual({ kind: 'explorer', text: '行' });
    expect(s.focusedId).toBe(s.windows[0].id);
  });

  it('a closed slot is reused', () => {
    let s = openAll('study', 'reader', 'homework');
    s = windowsReducer(s, { type: 'close', id: s.windows[1].id });
    s = windowsReducer(s, { type: 'open', spec: { kind: 'feedback' }, head: HEAD });
    expect(s.windows.find((w) => w.spec.kind === 'feedback')!.pose).toEqual(ringPose(1, HEAD.position, 0));
  });

  it('closing the focused window focuses the last one', () => {
    let s = openAll('study', 'reader', 'homework');
    s = windowsReducer(s, { type: 'close', id: s.focusedId! });
    expect(s.focusedId).toBe(s.windows[1].id);
    expect(windowsReducer(s, { type: 'close', id: 'nope' })).toBe(s);
  });

  it('never more than VR_MAX_WINDOWS: the oldest unfocused one makes room', () => {
    let s = EMPTY_WINDOWS;
    for (let i = 0; i < VR_MAX_WINDOWS + 2; i++) {
      s = windowsReducer(s, { type: 'open', spec: { kind: 'lesson_spec', lesson_id: `l${i}` }, head: HEAD });
    }
    expect(s.windows).toHaveLength(VR_MAX_WINDOWS);
    expect(s.windows.some((w) => w.key === 'lesson:l0')).toBe(false);
  });

  it('moving remembers the position by panel key, clamped, and reopening uses it', () => {
    let s = openAll('study');
    const id = s.windows[0].id;
    s = windowsReducer(s, { type: 'move', id, pose: { x: 0.5, y: 1.4, z: -0.8, yaw: 0 }, head: HEAD });
    expect(s.remembered.study.x).toBeCloseTo(0.5);
    s = windowsReducer(s, { type: 'close', id });
    s = windowsReducer(s, { type: 'open', spec: { kind: 'study' }, head: HEAD });
    expect(s.windows[0].pose.x).toBeCloseTo(0.5);
    // a far-away drop is pulled back in reach
    s = windowsReducer(s, { type: 'move', id: s.windows[0].id, pose: { x: 0, y: 1.5, z: -20, yaw: 0 }, head: HEAD });
    expect(Math.hypot(s.windows[0].pose.x, s.windows[0].pose.z)).toBeCloseTo(VR_RING.maxDistance);
    // NaN never lands
    const before = s;
    s = windowsReducer(s, { type: 'move', id: s.windows[0].id, pose: { x: NaN, y: 1, z: 0, yaw: 0 }, head: HEAD });
    expect(s).toBe(before);
  });

  it('recall puts every window back in the ring, the focused one in front', () => {
    let s = openAll('study', 'reader');
    s = windowsReducer(s, { type: 'move', id: s.windows[0].id, pose: { x: 2, y: 1, z: 2, yaw: 0 }, head: HEAD });
    s = windowsReducer(s, { type: 'focus', id: s.windows[0].id });
    const head: HeadPose = { position: { x: 1, y: 1.2, z: 1 }, yaw: Math.PI };
    s = windowsReducer(s, { type: 'recall', head });
    expect(s.windows[0].pose).toEqual(ringPose(0, head.position, head.yaw));
    expect(s.windows[1].pose).toEqual(ringPose(1, head.position, head.yaw));
    expect(s.remembered.study).toBeUndefined();
  });

  it('focus ignores unknown ids', () => {
    const s = openAll('study');
    expect(windowsReducer(s, { type: 'focus', id: 'zzz' })).toBe(s);
  });
});

describe('per-device memory', () => {
  it('round-trips positions and open windows (not feedback, not inline lessons)', () => {
    let s = openAll('study', 'homework');
    s = windowsReducer(s, { type: 'open', spec: { kind: 'feedback' }, head: HEAD });
    s = windowsReducer(s, { type: 'move', id: s.windows[0].id, pose: { x: 0.3, y: 1.5, z: -0.7, yaw: 0 }, head: HEAD });
    const stored = toStored(s);
    expect(stored.open).toEqual([{ kind: 'study' }, { kind: 'homework' }]);
    const back = fromStored(JSON.stringify(stored));
    expect(back.open).toEqual(stored.open);
    expect(back.remembered.study.x).toBeCloseTo(0.3);
  });

  it('drops anything malformed piece by piece (specs go through the validator)', () => {
    expect(fromStored(null)).toEqual({ remembered: {}, open: [] });
    expect(fromStored('{not json')).toEqual({ remembered: {}, open: [] });
    expect(fromStored('42')).toEqual({ remembered: {}, open: [] });
    const out = fromStored(JSON.stringify({
      remembered: { study: { x: 0, y: 1, z: -1, yaw: 0 }, bad: { x: 'a' }, nan: { x: null, y: 1, z: 0, yaw: 0 } },
      open: [{ kind: 'study' }, { kind: 'iframe', src: 'https://evil.example' }, { kind: 'reader', reader_id: 'javascript:alert(1)' }],
    }));
    expect(Object.keys(out.remembered)).toEqual(['study']);
    expect(out.open).toEqual([{ kind: 'study' }]);
  });

  it('storage that throws is survived', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadStoredWindows(throwing)).toEqual({ remembered: {}, open: [] });
    expect(() => saveStoredWindows(openAll('study'), throwing)).not.toThrow();
  });

  it('saves to and reopens from storage', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveStoredWindows(openAll('reader', 'homework'), storage);
    expect(mem.has(VR_STORAGE_KEY)).toBe(true);
    const s = initialWindows(HEAD, loadStoredWindows(storage));
    expect(s.windows.map((w) => w.spec.kind)).toEqual(['reader', 'homework']);
  });
});
