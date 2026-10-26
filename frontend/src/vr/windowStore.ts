/**
 * The VR windows: which are open, where they stand, which one has focus. A pure reducer
 * (windowStore.test.ts) + per-device memory in localStorage (`vr-windows-v1`): each window's
 * position by its panel key, and which windows were open — read back through
 * `validateVrPanelSpec`, so even a hand-edited entry can only ever name a known panel.
 */
import {
  clampPose,
  freeRingPose,
  isFinitePose,
  ringPose,
  validateVrPanelSpec,
  vrPanelKey,
  type Vec3,
  type VrPanelSpec,
  type VrPose,
} from '@shared/vr';

export interface VrWindow {
  id: string;
  key: string;
  spec: VrPanelSpec;
  pose: VrPose;
}

export interface VrWindowsState {
  windows: VrWindow[];
  focusedId: string | null;
  /** Positions by panel key, remembered across visits. */
  remembered: Record<string, VrPose>;
}

export interface HeadPose {
  position: Vec3;
  yaw: number;
}

export type VrWindowsAction =
  | { type: 'open'; spec: VrPanelSpec; head: HeadPose; id?: string }
  | { type: 'close'; id: string }
  | { type: 'focus'; id: string }
  | { type: 'move'; id: string; pose: VrPose; head: HeadPose }
  | { type: 'recall'; head: HeadPose }
  | { type: 'update_spec'; id: string; spec: VrPanelSpec };

export const VR_MAX_WINDOWS = 6;

export const EMPTY_WINDOWS: VrWindowsState = { windows: [], focusedId: null, remembered: {} };

let counter = 0;
function newId(): string {
  counter += 1;
  return `w${Date.now().toString(36)}${counter}`;
}

export function windowsReducer(state: VrWindowsState, action: VrWindowsAction): VrWindowsState {
  switch (action.type) {
    case 'open': {
      const key = vrPanelKey(action.spec);
      const existing = state.windows.find((w) => w.key === key);
      if (existing) {
        // Opening what is already open focuses it, with the new parameters (another word, another reader).
        return {
          ...state,
          focusedId: existing.id,
          windows: state.windows.map((w) => (w.id === existing.id ? { ...w, spec: action.spec } : w)),
        };
      }
      let windows = state.windows;
      if (windows.length >= VR_MAX_WINDOWS) {
        // The oldest unfocused window makes room.
        const drop = windows.find((w) => w.id !== state.focusedId) ?? windows[0];
        windows = windows.filter((w) => w !== drop);
      }
      const remembered = state.remembered[key];
      const pose = remembered && isFinitePose(remembered)
        ? clampPose(remembered, action.head.position)
        : freeRingPose(windows.map((w) => w.pose), action.head.position, action.head.yaw);
      const win: VrWindow = { id: action.id ?? newId(), key, spec: action.spec, pose };
      return { ...state, windows: [...windows, win], focusedId: win.id };
    }
    case 'close': {
      const windows = state.windows.filter((w) => w.id !== action.id);
      if (windows.length === state.windows.length) return state;
      const focusedId = state.focusedId === action.id ? (windows[windows.length - 1]?.id ?? null) : state.focusedId;
      return { ...state, windows, focusedId };
    }
    case 'focus':
      if (state.focusedId === action.id || !state.windows.some((w) => w.id === action.id)) return state;
      return { ...state, focusedId: action.id };
    case 'move': {
      const win = state.windows.find((w) => w.id === action.id);
      if (!win || !isFinitePose(action.pose)) return state;
      const pose = clampPose(action.pose, action.head.position);
      return {
        ...state,
        windows: state.windows.map((w) => (w.id === action.id ? { ...w, pose } : w)),
        remembered: { ...state.remembered, [win.key]: pose },
      };
    }
    case 'recall': {
      // Everything back in the ring in front of where the learner looks now (focused window centre).
      const ordered = [...state.windows].sort((a, b) => (a.id === state.focusedId ? -1 : b.id === state.focusedId ? 1 : 0));
      const poses = new Map(ordered.map((w, i) => [w.id, ringPose(i, action.head.position, action.head.yaw)]));
      const remembered = { ...state.remembered };
      for (const w of state.windows) delete remembered[w.key];
      return {
        ...state,
        remembered,
        windows: state.windows.map((w) => ({ ...w, pose: poses.get(w.id)! })),
      };
    }
    case 'update_spec':
      return { ...state, windows: state.windows.map((w) => (w.id === action.id ? { ...w, spec: action.spec } : w)) };
  }
}

// ── per-device memory ───────────────────────────────────────────────────

export const VR_STORAGE_KEY = 'vr-windows-v1';

interface StoredWindows {
  remembered: Record<string, VrPose>;
  open: unknown[];
}

/** What to persist: positions + the specs of the open windows (never inline lesson specs). */
export function toStored(state: VrWindowsState): StoredWindows {
  return {
    remembered: state.remembered,
    open: state.windows
      .filter((w) => !(w.spec.kind === 'lesson_spec' && !w.spec.lesson_id) && w.spec.kind !== 'feedback')
      .map((w) => w.spec),
  };
}

/** Parses the stored value; anything malformed is dropped piece by piece. */
export function fromStored(raw: string | null): { remembered: Record<string, VrPose>; open: VrPanelSpec[] } {
  const out = { remembered: {} as Record<string, VrPose>, open: [] as VrPanelSpec[] };
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof parsed !== 'object' || parsed === null) return out;
  const p = parsed as Partial<StoredWindows>;
  if (p.remembered && typeof p.remembered === 'object') {
    for (const [key, pose] of Object.entries(p.remembered)) {
      if (key.length <= 80 && isFinitePose(pose)) out.remembered[key] = { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw };
    }
  }
  if (Array.isArray(p.open)) {
    for (const s of p.open.slice(0, VR_MAX_WINDOWS)) {
      const r = validateVrPanelSpec(s);
      if (r.ok) out.open.push(r.spec);
    }
  }
  return out;
}

export function loadStoredWindows(storage: Pick<Storage, 'getItem'> | null = safeStorage()): ReturnType<typeof fromStored> {
  try {
    return fromStored(storage?.getItem(VR_STORAGE_KEY) ?? null);
  } catch {
    return fromStored(null);
  }
}

export function saveStoredWindows(state: VrWindowsState, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(VR_STORAGE_KEY, JSON.stringify(toStored(state)));
  } catch {
    /* private window / storage full: positions just aren't remembered */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The starting state: remembered positions, and the windows that were open last time. */
export function initialWindows(head: HeadPose, stored = loadStoredWindows()): VrWindowsState {
  let state: VrWindowsState = { ...EMPTY_WINDOWS, remembered: stored.remembered };
  for (const spec of stored.open) state = windowsReducer(state, { type: 'open', spec, head });
  return state;
}
