/**
 * Settings → New cards → "Order new cards by" (web): the switches in the shared order and words,
 * "Everyday words before formal ones" among them (on by default, before "Most common first"); a
 * flip saves that one switch (PUT /api/profile/new-card-order), caches the answer on the device
 * and tracks `settings.new_card_order` with `everyday_first`; a failed save puts it back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_NEW_CARD_ORDER, NEW_CARD_ORDER_OPTIONS, newCardOrderInfo } from '@shared/decks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const analytics = vi.hoisted(() => ({ track: vi.fn(), trackError: vi.fn() }));
vi.mock('../../services/analytics', () => analytics);
// PUT /api/profile/new-card-order (the test setup already loads the real services/newCardOrder
// through db/database, so the save is replaced here; the caching is the real one).
const api = vi.hoisted(() => ({ updateNewCardOrder: vi.fn() }));
vi.mock('../../services/newCardOrder', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../services/newCardOrder')>();
  return {
    ...real,
    saveNewCardOrder: async (update: Parameters<typeof real.saveNewCardOrder>[0]) => {
      const info = await api.updateNewCardOrder(update);
      real.writeNewCardOrder(info);
      return info;
    },
  };
});

import { NewCardOrderSection } from './NewCardOrderSection';
import { readNewCardOrder } from '../../services/newCardOrder';

const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};

describe('NewCardOrderSection', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    analytics.track.mockClear();
    api.updateNewCardOrder.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = () => act(() => root.render(<NewCardOrderSection />));
  const sw = (key: string) => host.querySelector<HTMLInputElement>(`[data-testid="nco-switch-${key}"]`)!;

  it('shows "Everyday words before formal ones" on by default, right before "Most common first"', () => {
    render();
    const titles = [...host.querySelectorAll('.nco-list > li .nco-title')].map((n) => n.textContent);
    expect(titles).toEqual([...NEW_CARD_ORDER_OPTIONS.map((o) => o.label), 'Then your deck order']);
    expect(titles.indexOf('Everyday words before formal ones')).toBe(titles.indexOf('Most common first') - 1);
    expect(sw('everyday_first').checked).toBe(true);
    expect(host.querySelector('[data-testid="nco-everyday_first"] .nco-hint')?.textContent).toMatch(/daily life come before formal or literary ones/);
    expect(host.querySelector('[data-testid="nco-reset"]')).toBeNull();
  });

  it('switching it off saves only that switch, caches it and tracks it', async () => {
    api.updateNewCardOrder.mockResolvedValue(newCardOrderInfo({ ...DEFAULT_NEW_CARD_ORDER, everyday_first: false }));
    render();
    await act(async () => sw('everyday_first').click());
    await flush();
    expect(api.updateNewCardOrder).toHaveBeenCalledWith({ everyday_first: false });
    expect(sw('everyday_first').checked).toBe(false);
    expect(readNewCardOrder().everyday_first).toBe(false);
    expect(analytics.track).toHaveBeenCalledWith('settings.new_card_order', expect.objectContaining({ field: 'everyday_first', everyday_first: false, reset: false }));
    expect(host.querySelector('[data-testid="nco-reset"]')).not.toBeNull();
  });

  it('a failed save puts the switch back', async () => {
    api.updateNewCardOrder.mockRejectedValue(new Error('Server said no'));
    render();
    await act(async () => sw('everyday_first').click());
    await flush();
    expect(sw('everyday_first').checked).toBe(true);
    expect(readNewCardOrder().everyday_first).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });
});
