import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { DesktopBridge, OverlayEvent, OverlaySnapshot, SharedSource } from '@shared/desktop/bridge';
import { AnnotationStore } from './annotations';
import { overlaySnapshot, useDesktopOverlay, type DesktopOverlayActions } from './desktopOverlay';

vi.mock('../analytics', () => ({ track: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeBridge(source: SharedSource | null) {
  const listeners = new Set<(e: OverlayEvent) => void>();
  const snapshots: OverlaySnapshot[] = [];
  const bridge = {
    isDesktop: true as const,
    version: '0.1.0',
    platform: 'darwin',
    lastSharedSource: vi.fn(async () => source),
    overlay: {
      show: vi.fn(async () => true),
      hide: vi.fn(),
      annotations: vi.fn((s: OverlaySnapshot) => snapshots.push(s)),
      setDrawMode: vi.fn(),
      onEvent: (l: (e: OverlayEvent) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
  } satisfies DesktopBridge;
  const emit = (e: unknown) => listeners.forEach((l) => l(e as OverlayEvent));
  return { bridge, snapshots, emit, listeners };
}

let latest: ReturnType<typeof useDesktopOverlay> | null = null;
function Harness({ stream, store, actions }: { stream: MediaStream | null; store: AnnotationStore; actions: DesktopOverlayActions }) {
  latest = useDesktopOverlay(stream, store, actions);
  return null;
}

const actions = (): DesktopOverlayActions => ({ stroke: vi.fn(), ping: vi.fn(), text: vi.fn(), clear: vi.fn() });
const stream = {} as MediaStream;

afterEach(() => {
  delete (window as { desktopBridge?: unknown }).desktopBridge;
  latest = null;
});

describe('overlaySnapshot', () => {
  it('carries only what is still visible, with the sharer pen colour', () => {
    const store = new AnnotationStore();
    store.setPersist(false, 0);
    const pts: [number, number][] = [[0.1, 0.1]];
    store.upsert({ id: 'old', color: '#f43f5e', width: 0.006, points: pts, done: true }, 'u1', 0);
    store.upsert({ id: 'new', color: '#f43f5e', width: 0.006, points: pts, done: false }, 'u1', 10_000);
    store.ping('u1', 0.5, 0.5, 9_500);
    const snap = overlaySnapshot(store, 10_000);
    expect(snap.strokes.map((s) => s.id)).toEqual(['new']);
    expect(snap.pings).toHaveLength(1);
    expect(snap.persist).toBe(false);
    expect(snap.color).toBe('#38bdf8');
  });
});

describe('useDesktopOverlay', () => {
  it('does nothing in a browser', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Harness stream={stream} store={new AnnotationStore()} actions={actions()} />));
    expect(latest?.shown).toBe(false);
    await act(async () => root.unmount());
  });

  it('opens the overlay for a shared SCREEN, feeds it, relays her strokes and closes with the share', async () => {
    const { bridge, snapshots, emit, listeners } = fakeBridge({ kind: 'screen', displayId: '42', name: 'Built-in Display' });
    (window as { desktopBridge?: unknown }).desktopBridge = bridge;
    const store = new AnnotationStore();
    const a = actions();
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Harness stream={stream} store={store} actions={a} />));
    expect(bridge.overlay.show).toHaveBeenCalledWith('42');
    expect(latest?.shown).toBe(true);
    expect(snapshots).toHaveLength(1);

    // The other person draws: the overlay gets it (throttled).
    vi.useFakeTimers();
    store.upsert({ id: 's', color: '#f43f5e', width: 0.006, points: [[0.2, 0.2]], done: false }, 'u1');
    store.upsert({ id: 's', color: '#f43f5e', width: 0.006, points: [[0.2, 0.2], [0.3, 0.3]], done: false }, 'u1');
    vi.advanceTimersByTime(40);
    vi.useRealTimers();
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].strokes[0].points).toHaveLength(2);

    // She draws on the overlay: it goes out through the call's annotation actions (cleaned first).
    emit({ kind: 'stroke', stroke: { id: 'm', color: '#38bdf8', width: 0.006, points: [[0.5, 0.5]], done: true } });
    emit({ kind: 'stroke', stroke: { id: 'bad', color: 'blue', width: 0.006, points: [] } });
    emit({ kind: 'ping', x: 0.4, y: 0.6 });
    emit({ kind: 'clear' });
    expect(a.stroke).toHaveBeenCalledTimes(1);
    expect(a.ping).toHaveBeenCalledWith(0.4, 0.6);
    expect(a.clear).toHaveBeenCalled();

    await act(async () => latest!.setDrawing(true));
    expect(bridge.overlay.setDrawMode).toHaveBeenCalledWith(true);
    expect(latest?.drawing).toBe(true);
    await act(async () => emit({ kind: 'draw_mode', on: false })); // "Stop drawing" on the overlay toolbar
    expect(latest?.drawing).toBe(false);

    // The share stops: the overlay goes.
    await act(async () => root.render(<Harness stream={null} store={store} actions={a} />));
    expect(bridge.overlay.hide).toHaveBeenCalled();
    expect(latest?.shown).toBe(false);
    expect(listeners.size).toBe(0);
    await act(async () => root.unmount());
  });

  it('leaves a shared WINDOW alone (it moves under any overlay)', async () => {
    const { bridge } = fakeBridge({ kind: 'window', displayId: null, name: 'Keynote' });
    (window as { desktopBridge?: unknown }).desktopBridge = bridge;
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Harness stream={stream} store={new AnnotationStore()} actions={actions()} />));
    expect(bridge.overlay.show).not.toHaveBeenCalled();
    expect(latest?.shown).toBe(false);
    await act(async () => root.unmount());
  });
});
