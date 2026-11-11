/**
 * The add-card sheet without a deck picker (docs/STUDY_SESSION.md "Source decks"): a new word is
 * saved as soon as the sheet knows it is new — into its source deck — and says "✓ Added to … ·
 * Change"; Change moves the note; a word he already has is never added by itself (⚡ first,
 * "Add anyway" into the source deck).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Existing = Array<{ note: { id: string; hanzi: string }; deckName: string }>;
const h = vi.hoisted(() => ({
  existing: [] as Existing,
  createNote: vi.fn(async (deckRef: string) => ({
    id: 'new-note',
    deck_id: 'src-1',
    deck: { id: 'src-1', name: deckRef === 'source:sentences' ? 'From example sentences' : 'From chats', source_key: deckRef.slice('source:'.length) },
  })),
  moveNotesApi: vi.fn(async (ids: string[], deckId: string) => ({ moved: ids.length, note_ids: ids, deck_id: deckId })),
  getDecks: vi.fn(async () => [
    { id: 'hsk2', name: 'HSK 2', study_priority: 5, created_at: '2026-01-01' },
    { id: 'src-1', name: 'From example sentences', study_priority: 6, created_at: '2026-11-01' },
  ]),
  track: vi.fn(),
}));

vi.mock('../services/analytics', () => ({ track: h.track, trackError: vi.fn() }));
vi.mock('../services/studyBumps', () => ({
  findExistingNotes: vi.fn(async () => h.existing),
  bumpNotes: vi.fn(async () => ({ message: '⚡ first today' })),
  useBumps: () => new Set<string>(),
}));
vi.mock('../api/client', () => ({ createNote: h.createNote, moveNotesApi: h.moveNotesApi, getDecks: h.getDecks, createNotesBatch: vi.fn() }));
vi.mock('../services/sync', () => ({ syncService: { syncInBackground: vi.fn(async () => undefined) } }));

import { AddChunkModal } from './AddChunkModal';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  h.existing = [];
  h.createNote.mockClear();
  h.moveNotesApi.mockClear();
});

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function render(props: Partial<Parameters<typeof AddChunkModal>[0]> = {}) {
  container = document.createElement('div');
  document.body.append(container);
  const onAdded = vi.fn();
  await act(async () => {
    root = createRoot(container!);
    root.render(<AddChunkModal chunk={{ hanzi: '迟到', pinyin: 'chídào', english: 'to be late' }} onClose={() => {}} onAdded={onAdded} {...props} />);
  });
  await tick();
  return { onAdded };
}

describe('AddChunkModal (source decks)', () => {
  it('saves a new word at once into the source deck — no deck list — and says where it went', async () => {
    const { onAdded } = await render({ source: 'breakdown' });
    expect(document.body.querySelector('[role="radiogroup"]')).toBeNull();
    expect(h.createNote).toHaveBeenCalledTimes(1);
    expect(h.createNote).toHaveBeenCalledWith('source:sentences', expect.objectContaining({ hanzi: '迟到', pinyin: 'chídào', english: 'to be late' }));
    expect(q('added-to-deck')!.textContent).toContain('✓ Added to From example sentences');
    expect(onAdded).toHaveBeenCalledWith({ noteId: 'new-note', hanzi: '迟到', deckId: 'src-1', deckName: 'From example sentences' });
    expect(h.track).toHaveBeenCalledWith('deck.source_add', expect.objectContaining({ deck_key: 'sentences', source_deck: true }));
    expect(q('add-chunk-done')!.textContent).toBe('Done');
  });

  it('an explicit deckSource wins over the bump source', async () => {
    await render({ source: 'other', deckSource: 'chats' });
    expect(h.createNote).toHaveBeenCalledWith('source:chats', expect.anything());
  });

  it('Change moves the just-added note to the deck he picks', async () => {
    await render({ source: 'breakdown' });
    await act(async () => q('added-to-deck-change')!.click());
    await tick();
    const sheet = q('move-to-deck')!;
    const names = [...sheet.querySelectorAll('[role="radio"]')].map((b) => b.textContent);
    // Study-queue order; the deck it is in now is marked.
    expect(names).toEqual(['From example sentences', 'HSK 2']);
    const hsk = [...sheet.querySelectorAll('button')].find((b) => b.textContent === 'HSK 2')!;
    await act(async () => hsk.click());
    await tick();
    expect(h.moveNotesApi).toHaveBeenCalledWith(['new-note'], 'hsk2');
    expect(q('move-to-deck')).toBeNull();
    expect(q('added-to-deck')!.textContent).toContain('✓ Moved to HSK 2');
    expect(h.track).toHaveBeenCalledWith('deck.source_change', expect.objectContaining({ deck_key: 'sentences', count: 1 }));
  });

  it('a word he already has is never added by itself: ⚡ first, "Add anyway" into the source deck', async () => {
    h.existing = [{ note: { id: 'n1', hanzi: '迟到' }, deckName: 'HSK 2' }];
    await render({ source: 'chat' });
    expect(h.createNote).not.toHaveBeenCalled();
    expect(q('already-have')!.textContent).toContain('You already have 迟到 in HSK 2');
    await act(async () => q('add-chunk-add-anyway')!.click());
    await tick();
    expect(h.createNote).toHaveBeenCalledWith('source:chats', expect.anything());
    expect(q('added-to-deck')!.textContent).toContain('✓ Added to From chats');
  });
});
