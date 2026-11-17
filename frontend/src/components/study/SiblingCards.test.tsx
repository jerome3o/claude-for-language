/**
 * The ⋯ menu's other-card tiles (shared/decks/sibling-status.ts): one tile per OTHER card with its
 * symbol, status and strength; a missing card type is a disabled tile; a tile's sheet offers
 * ⚡ Study it today (a card-level bump handed to the session), the hold actions or Unsuspend, Forget
 * for a started card, and says why ⚡ can't be used when it can't.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db, type LocalCard } from '../../db/database';
import { SiblingCardSheet, SiblingTilesRow, type SiblingScope } from './SiblingCards';
import { track } from '../../services/analytics';

vi.mock('../../services/analytics', () => ({ track: vi.fn(), trackError: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 86_400_000;
const iso = () => new Date().toISOString();

function card(id: string, type: string, queue: number, dueMs: number | null = null, stability = 0): LocalCard {
  return {
    id, note_id: 'n-bank', deck_id: 'd1', card_type: type, queue, stability, difficulty: 5, lapses: 0,
    learning_step: 0, ease_factor: 2.5, interval: queue ? 12 : 0, repetitions: queue ? 3 : 0,
    next_review_at: dueMs ? new Date(dueMs).toISOString() : null, due_timestamp: dueMs,
    created_at: iso(), updated_at: iso(), _synced_at: null,
  } as LocalCard;
}

const scope = (extra: Partial<SiblingScope> = {}): SiblingScope => ({
  noteId: 'n-bank', currentCardId: 'c-h', currentCardType: 'hanzi_to_meaning', inToday: new Set(), canBump: true, ...extra,
});

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(node);
  });
}

const q = (id: string) => host!.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe('SiblingTilesRow / SiblingCardSheet', () => {
  beforeEach(async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await Promise.all([db.cards.clear(), db.reviewEvents.clear(), db.studyBumps.clear(), db.cardHolds.clear()]);
    await db.cards.bulkPut([
      card('c-h', 'hanzi_to_meaning', 2, Date.now() - DAY, 30),
      card('c-m', 'meaning_to_hanzi', 0),
      card('c-a', 'audio_to_hanzi', 2, Date.now() + 40 * DAY, 60),
    ]);
    vi.mocked(track).mockClear();
  });
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it('shows one tile per other card: symbol, name, status, strength', async () => {
    const onOpen = vi.fn();
    await mount(<SiblingTilesRow scope={scope()} onOpen={onOpen} />);
    await vi.waitFor(() => expect(q('sibling-tile-meaning_to_hanzi')).not.toBeNull());
    expect(q('sibling-tile-hanzi_to_meaning')).toBeNull();
    expect(q('sibling-tile-meaning_to_hanzi')!.textContent).toContain('写Write');
    expect(q('sibling-tile-meaning_to_hanzi')!.textContent).toContain('Not started');
    expect(q('sibling-tile-audio_to_hanzi')!.textContent).toMatch(/Known · next in \d+d/);
    expect(q('sibling-tile-audio_to_hanzi')!.getAttribute('aria-label')).toMatch(/^Listen card \(听\): Known · next in \d+d\. Strength 3 of 3\.$/);
    expect(q('sibling-tile-audio_to_hanzi')!.querySelectorAll('.sibling-strength-step.is-on').length).toBe(3);
    await act(async () => { q('sibling-tile-meaning_to_hanzi')!.click(); });
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ card_id: 'c-m', status: 'not_started' }));
    expect(track).toHaveBeenCalledWith('study.sibling_open', { card_type: 'meaning_to_hanzi', status: 'not_started' });
  });

  it('a word with no listening card: a disabled tile says so', async () => {
    await db.cards.delete('c-a');
    await mount(<SiblingTilesRow scope={scope()} onOpen={vi.fn()} />);
    await vi.waitFor(() => expect(q('sibling-tile-audio_to_hanzi')).not.toBeNull());
    expect(q('sibling-tile-audio_to_hanzi')!.getAttribute('aria-disabled')).toBe('true');
    expect(q('sibling-tile-audio_to_hanzi')!.textContent).toContain('No listening card (no audio)');
  });

  it('⚡ Study it today: a card-level bump of that card, handed to the session', async () => {
    const onBumped = vi.fn();
    await mount(
      <SiblingCardSheet scope={scope()} cardId="c-m" hanzi="银行" inSession onBumped={onBumped} onHold={vi.fn()} onForget={vi.fn()} onDetails={vi.fn()} onClose={vi.fn()} />
    );
    await vi.waitFor(() => expect(q('sibling-sheet')).not.toBeNull());
    expect(q('sibling-sheet')!.textContent).toContain('English → 汉字 · 银行');
    expect(q('sibling-sheet-status')!.textContent).toContain('Not started');
    // NEW card: no Forget; Snooze / Suspend; details.
    expect(q('sibling-action-forget')).toBeNull();
    expect(q('sibling-action-snooze')).not.toBeNull();
    expect(q('sibling-action-details')).not.toBeNull();
    await act(async () => { (q('sibling-action-bump') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(onBumped).toHaveBeenCalledWith(['c-m']));
    const bump = await db.studyBumps.where('note_id').equals('n-bank').first();
    expect(bump).toMatchObject({ card_types: ['meaning_to_hanzi'], pending: 'add', source: 'study_card' });
    expect(q('sibling-sheet-done')!.textContent).toBe('✓ English → 汉字 comes up in a few cards');
    expect(track).toHaveBeenCalledWith('study.sibling_action', { card_type: 'meaning_to_hanzi', action: 'bump' });
  });

  it('already in today → ⚡ disabled with the reason; a started card offers Forget', async () => {
    await mount(
      <SiblingCardSheet scope={scope({ inToday: new Set(['c-a']) })} cardId="c-a" hanzi="银行" inSession onHold={vi.fn()} onForget={vi.fn()} onClose={vi.fn()} />
    );
    await vi.waitFor(() => expect(q('sibling-sheet')).not.toBeNull());
    expect(q('sibling-sheet-status')!.textContent).toContain('⚡ In today’s study');
    const bump = q('sibling-action-bump') as HTMLButtonElement;
    expect(bump.disabled).toBe(true);
    expect(bump.textContent).toContain('Already in today’s study');
    expect(q('sibling-action-forget')).not.toBeNull();
  });

  it('a suspended card: Unsuspend instead of Snooze / Suspend', async () => {
    await db.cardHolds.put({ id: 'h1', card_id: 'c-m', kind: 'suspend', until: null, created_at: iso(), pending: null });
    const onRelease = vi.fn();
    await mount(
      <SiblingCardSheet scope={scope()} cardId="c-m" hanzi="银行" inSession onHold={vi.fn()} onRelease={onRelease} onClose={vi.fn()} />
    );
    await vi.waitFor(() => expect(q('sibling-sheet-status')?.textContent).toContain('Suspended'));
    expect(q('sibling-action-snooze')).toBeNull();
    expect((q('sibling-action-bump') as HTMLButtonElement).textContent).toContain('Suspended — unsuspend it first');
    await act(async () => { q('sibling-action-release')!.click(); });
    expect(onRelease).toHaveBeenCalledWith(expect.objectContaining({ card_id: 'c-m', release: 'unsuspend' }));
    expect(track).toHaveBeenCalledWith('study.sibling_action', { card_type: 'meaning_to_hanzi', action: 'unsuspend' });
  });

  it('in a homework pass: the status only, no ⚡', async () => {
    await mount(<SiblingCardSheet scope={scope({ canBump: false })} cardId="c-m" hanzi="银行" inSession={false} onClose={vi.fn()} />);
    await vi.waitFor(() => expect(q('sibling-sheet')).not.toBeNull());
    expect(q('sibling-action-bump')).toBeNull();
  });
});
