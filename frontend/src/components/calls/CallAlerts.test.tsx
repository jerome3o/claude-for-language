/**
 * The "📹 … is calling — Join" bar and the ring follow presence: they show
 * while the other person is really in the call, and clear on the next poll
 * once they've left (or the call ended) — and a stale bar can be hidden.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { CallListItem } from '../../types/calls';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let liveCalls: CallListItem[] = [];
vi.mock('../../hooks/useLiveCalls', () => ({ useLiveCalls: () => liveCalls }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', call_alerts: 'ring' }, isAuthenticated: true }) }));
vi.mock('../../services/push', () => ({ callAlertsMode: () => 'ring', rememberCallAlerts: () => {}, refreshPushSubscription: async () => {} }));
const ring = { on: false };
vi.mock('../../services/calls/ringtone', () => ({
  isRinging: () => ring.on,
  startRinging: vi.fn(() => {
    ring.on = true;
  }),
  stopRinging: vi.fn(() => {
    ring.on = false;
  }),
}));

import { CallAlerts } from './CallAlerts';

const NOW = Date.parse('2026-09-30T08:42:50Z');
const call = (over: Partial<CallListItem> = {}): CallListItem => ({
  id: 'c1',
  relationship_id: 'rel-1',
  created_by: 'minghui',
  title: null,
  status: 'live',
  processing_status: 'none',
  started_at: null,
  ended_at: null,
  created_at: '2026-09-30 08:42:38',
  other_user_name: '明慧老师',
  segment_count: 0,
  has_summary: false,
  ...over,
});

describe('CallAlerts (web)', () => {
  let host: HTMLDivElement;
  let root: Root;
  const render = async () => {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={['/decks']}>
          <CallAlerts />
        </MemoryRouter>,
      ),
    );
  };
  const bar = () => host.querySelector('[data-testid="call-alert-banner"]');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    localStorage.clear();
    sessionStorage.clear();
    ring.on = false;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it('shows and rings while she is in the call; both clear once she has left', async () => {
    liveCalls = [call({ present_user_ids: ['minghui'] })];
    await render();
    expect(bar()?.textContent).toContain('明慧老师 is calling');
    expect(ring.on).toBe(true);

    liveCalls = [call({ present_user_ids: [] })]; // next poll: the room says nobody is there
    await render();
    expect(bar()).toBeNull();
    expect(ring.on).toBe(false);
  });

  it('clears when the call ends (it drops out of the live list)', async () => {
    liveCalls = [call({ present_user_ids: ['minghui'] })];
    await render();
    expect(bar()).not.toBeNull();
    liveCalls = [];
    await render();
    expect(bar()).toBeNull();
    expect(ring.on).toBe(false);
  });

  it('never shows the live-but-empty call hours later (the bug), nor one I am already in', async () => {
    vi.setSystemTime(NOW + 3 * 3600_000);
    liveCalls = [call({ created_by: 'me', present_user_ids: [] }), call({ id: 'c2', present_user_ids: ['me', 'minghui'] })];
    await render();
    expect(bar()).toBeNull();
    expect(ring.on).toBe(false);
  });

  it('a banner can be hidden with ✕', async () => {
    liveCalls = [call({ present_user_ids: ['minghui'] })];
    await render();
    const close = host.querySelector('button[aria-label="Hide"]') as HTMLButtonElement;
    await act(async () => close.click());
    expect(bar()).toBeNull();
    expect(ring.on).toBe(false);
  });
});
