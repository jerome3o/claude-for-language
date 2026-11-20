/**
 * The explorer's card variants (components/explorer/CardVariants.tsx): EVERY card of the word as the
 * study card ⋯ menu's tiles (shared/decks/sibling-status.ts) — 读 / 写 / 听 with status + strength from
 * this device; a tap opens the card's panel; ⚡ there is the card-level bump (source explorer); a card
 * in the ⚡ pocket shows as in today; a suspended card offers Unsuspend.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db, type LocalCard } from '../../db/database';
import { track } from '../../services/analytics';
import { bumpCardTypes } from '../../services/studyBumps';
import { CardVariants } from './CardVariants';

vi.mock('../../services/analytics', () => ({ track: vi.fn(), trackError: vi.fn() }));
vi.mock('../../services/studyBumps', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../services/studyBumps')>();
  return { ...real, bumpCardTypes: vi.fn(real.bumpCardTypes) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 86_400_000;
const iso = () => new Date().toISOString();

function card(id: string, type: string, queue: number, dueMs: number | null = null, stability = 0): LocalCard {
  return {
    id, note_id: 'n-dds', deck_id: 'd1', card_type: type, queue, stability, difficulty: 5, lapses: 0,
    learning_step: 0, ease_factor: 2.5, interval: queue ? 12 : 0, repetitions: queue ? 3 : 0,
    next_review_at: dueMs ? new Date(dueMs).toISOString() : null, due_timestamp: dueMs,
    created_at: iso(), updated_at: iso(), _synced_at: null,
  } as LocalCard;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
const q = (id: string) => host!.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function mount(onBumped = vi.fn()) {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(<CardVariants noteId="n-dds" hanzi="大多数" kind="word" onBumped={onBumped} />);
  });
  await vi.waitFor(() => expect(q('xp-variant-audio_to_hanzi')).not.toBeNull());
  return onBumped;
}

describe('CardVariants (explorer)', () => {
  beforeEach(async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await Promise.all([db.cards.clear(), db.reviewEvents.clear(), db.studyBumps.clear(), db.cardHolds.clear()]);
    await db.cards.bulkPut([
      card('c-h', 'hanzi_to_meaning', 2, Date.now() + 90 * DAY, 60), // read: known
      card('c-m', 'meaning_to_hanzi', 0), // write: not started
      card('c-a', 'audio_to_hanzi', 2, Date.now() - DAY, 10), // listen: due
    ]);
    vi.mocked(track).mockClear();
    vi.mocked(bumpCardTypes).mockClear();
  });
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it('shows all three cards of the word with the ⋯ menu’s status words', async () => {
    await mount();
    expect(q('xp-variant-hanzi_to_meaning')!.textContent).toMatch(/读Read.*Known · next in \d+mo/);
    expect(q('xp-variant-meaning_to_hanzi')!.textContent).toContain('Not started');
    expect(q('xp-variant-audio_to_hanzi')!.textContent).toContain('Due today');
    expect(q('xp-variant-hanzi_to_meaning')!.getAttribute('data-status')).toBe('known');
    expect(q('xp-variant-hanzi_to_meaning')!.querySelectorAll('.sibling-strength-step.is-on').length).toBe(3);
  });

  it('a tap opens the panel; ⚡ bumps that one card type and it shows as in today', async () => {
    const onBumped = await mount();
    await act(async () => { q('xp-variant-meaning_to_hanzi')!.click(); });
    expect(track).toHaveBeenCalledWith('explorer.card_variant_open', { kind: 'word', card_type: 'meaning_to_hanzi', status: 'not_started' });
    expect(q('xp-variant-panel')!.textContent).toContain('English → 汉字 · 大多数');
    await act(async () => { q('xp-variant-bump')!.click(); });
    await vi.waitFor(() => expect(onBumped).toHaveBeenCalledWith('⚡ English → 汉字 added to today'));
    expect(bumpCardTypes).toHaveBeenCalledWith('n-dds', ['meaning_to_hanzi'], 'explorer');
    expect(track).toHaveBeenCalledWith('explorer.card_variant_action', { kind: 'word', card_type: 'meaning_to_hanzi', action: 'bump' });
    const row = await db.studyBumps.where('note_id').equals('n-dds').first();
    expect(row?.card_types).toEqual(['meaning_to_hanzi']);
    await vi.waitFor(() => expect(q('xp-variant-meaning_to_hanzi')!.getAttribute('data-status')).toBe('new_today'));
    expect(q('xp-variant-panel')).toBeNull();
  });

  it('a card already due today: ⚡ is greyed with the reason', async () => {
    await mount();
    await act(async () => { q('xp-variant-audio_to_hanzi')!.click(); });
    expect((q('xp-variant-bump') as HTMLButtonElement).disabled).toBe(true);
    expect(q('xp-variant-panel')!.textContent).toContain('Already due today');
    await act(async () => { q('xp-variant-audio_to_hanzi')!.click(); });
    expect(q('xp-variant-panel')).toBeNull();
  });

  it('a suspended card offers Unsuspend', async () => {
    await db.cardHolds.put({ id: 'h1', card_id: 'c-m', kind: 'suspend', until: null, created_at: iso(), cleared_at: null } as never);
    await mount();
    await vi.waitFor(() => expect(q('xp-variant-meaning_to_hanzi')!.getAttribute('data-status')).toBe('suspended'));
    await act(async () => { q('xp-variant-meaning_to_hanzi')!.click(); });
    expect(q('xp-variant-panel')!.textContent).toContain('Suspended — unsuspend it first');
    await act(async () => { q('xp-variant-release')!.click(); });
    await vi.waitFor(() => expect(q('xp-variant-meaning_to_hanzi')!.getAttribute('data-status')).toBe('not_started'));
  });

  it('a word with no audio has a dashed Listen tile', async () => {
    await db.cards.delete('c-a');
    host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      root = createRoot(host!);
      root.render(<CardVariants noteId="n-dds" hanzi="大多数" kind="word" />);
    });
    await vi.waitFor(() => expect(q('xp-variant-audio_to_hanzi')).not.toBeNull());
    expect(q('xp-variant-audio_to_hanzi')!.getAttribute('data-status')).toBe('missing');
    expect(q('xp-variant-audio_to_hanzi')!.textContent).toContain('No listening card (no audio)');
  });
});
