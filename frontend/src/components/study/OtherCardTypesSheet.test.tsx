/**
 * ⋯ → "Practise this word other ways…": the note's card types with their state, the first NEW
 * sibling ticked, a started one offered early, "this card" / "in today" / whole-note bump with
 * nothing to do, and Add → a card-level ⚡ bump + the cards handed to the session.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db, type LocalCard } from '../../db/database';
import { OtherCardTypesSheet } from './OtherCardTypesSheet';
import { track } from '../../services/analytics';

vi.mock('../../services/analytics', () => ({ track: vi.fn(), trackError: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 86_400_000;
const iso = () => new Date().toISOString();

function card(id: string, type: string, queue: number, dueMs: number | null = null): LocalCard {
  return {
    id, note_id: 'n-bank', deck_id: 'd1', card_type: type, queue, stability: queue ? 20 : 0, difficulty: 5, lapses: 0,
    learning_step: 0, ease_factor: 2.5, interval: queue ? 12 : 0, repetitions: queue ? 3 : 0,
    next_review_at: dueMs ? new Date(dueMs).toISOString() : null, due_timestamp: dueMs,
    created_at: iso(), updated_at: iso(), _synced_at: null,
  } as LocalCard;
}

let root: Root | null = null;
let host: HTMLElement | null = null;

async function render(props: Partial<Parameters<typeof OtherCardTypesSheet>[0]> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const onAdded = vi.fn();
  const onClose = vi.fn();
  await act(async () => {
    root = createRoot(host!);
    root.render(
      <OtherCardTypesSheet
        noteId="n-bank" hanzi="银行" currentCardId="c-h" currentCardType="hanzi_to_meaning"
        inToday={new Set()} onAdded={onAdded} onClose={onClose} {...props}
      />
    );
  });
  await vi.waitFor(() => expect(host!.querySelectorAll('[data-testid^="other-card-row-"]').length).toBe(3));
  return { onAdded, onClose };
}

const row = (type: string) => host!.querySelector(`[data-testid="other-card-row-${type}"]`) as HTMLElement;
const box = (type: string) => row(type).querySelector('input') as HTMLInputElement | null;
const addButton = () => host!.querySelector('[data-testid="other-card-types-add"]') as HTMLButtonElement;

describe('OtherCardTypesSheet', () => {
  beforeEach(async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await Promise.all([db.cards.clear(), db.reviewEvents.clear(), db.studyBumps.clear()]);
    await db.cards.bulkPut([
      card('c-h', 'hanzi_to_meaning', 2, Date.now() - DAY),
      card('c-m', 'meaning_to_hanzi', 0),
      card('c-a', 'audio_to_hanzi', 2, Date.now() + 12 * DAY),
    ]);
  });
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  it('lists each card type with its state; the new sibling is ticked, the started one offered early', async () => {
    await render();
    expect(row('hanzi_to_meaning').textContent).toContain('Read → meaning');
    expect(row('hanzi_to_meaning').textContent).toContain('this card');
    expect(box('hanzi_to_meaning')).toBeNull();
    expect(row('meaning_to_hanzi').textContent).toContain('English → 汉字');
    expect(row('meaning_to_hanzi').textContent).toContain('⚡ Add to today');
    expect(box('meaning_to_hanzi')!.checked).toBe(true);
    expect(row('audio_to_hanzi').textContent).toMatch(/in review, due in 1[23] days/);
    expect(row('audio_to_hanzi').textContent).toContain('Review it early today');
    expect(box('audio_to_hanzi')!.checked).toBe(false);
    expect(addButton().textContent).toBe('⚡ Add 1 to today');
  });

  it('Add: a card-level bump of the ticked types, handed to the session, then a done line', async () => {
    const { onAdded } = await render();
    await act(async () => { box('audio_to_hanzi')!.click(); });
    expect(addButton().textContent).toBe('⚡ Add 2 to today');
    await act(async () => { addButton().click(); });
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledWith(['c-m', 'c-a']));
    const bump = await db.studyBumps.where('note_id').equals('n-bank').first();
    expect(bump).toMatchObject({ card_types: ['meaning_to_hanzi', 'audio_to_hanzi'], pending: 'add', source: 'study_card' });
    expect(host!.querySelector('[data-testid="other-card-types-done"]')!.textContent).toBe('⚡ English → 汉字 and Listen → 汉字 come up in a few cards');
    expect(track).toHaveBeenCalledWith('study.other_card_types', { types: 'meaning_to_hanzi/audio_to_hanzi', from_type: 'hanzi_to_meaning', count: 2, early: 1 });
  });

  it('cards already in today and a whole-note bump leave nothing to add', async () => {
    await db.studyBumps.put({ id: 'b1', note_id: 'n-bank', created_at: iso(), source: 'coach', bumped_by_name: null, card_types: null, pending: null });
    await render({ inToday: new Set(['c-m']) });
    expect(row('meaning_to_hanzi').textContent).toContain('⚡ in today’s study');
    await vi.waitFor(() => expect(box('audio_to_hanzi')).toBeNull());
    expect(addButton().disabled).toBe(true);
    expect(addButton().textContent).toBe('Nothing ticked');
  });
});
