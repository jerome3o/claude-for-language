/**
 * The Character view says first whether the character ITSELF is one of the learner's cards
 * (Jerome: "in the explorer, it's hard to tell if I already have a card for a single
 * character"): "📚 You have 性 as a card in …" / "✓ Known — …" with Open card → and ⚡ Study it
 * today, else "+ Add 性 as a card" — and a quiet placeholder while the device is read.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Own = { status: 'known' | 'in_decks' | 'none'; note_ids: string[]; decks: string[] };
const state = vi.hoisted(() => ({ resolveOwn: (_o: Record<string, unknown>) => {} }));

vi.mock('../../services/analytics', () => ({ track: vi.fn(), trackError: vi.fn() }));
vi.mock('../../services/charDict', () => ({
  lookupChar: vi.fn(async () => ({
    status: 'ok',
    offline: false,
    record: {
      char: '性',
      readings: [{ pinyin: 'xìng', english: 'nature; character; sex' }],
      meaning: 'nature, character',
      radical: '忄',
      radical_meaning: 'heart',
      components: [],
      strokes: 8,
      rank: 120,
      etymology: '',
      words: [],
    },
  })),
  charWordStatuses: vi.fn(async () => []),
  explainChar: vi.fn(),
  ownCardsFor: vi.fn(() => new Promise((r) => { state.resolveOwn = r as (o: Record<string, unknown>) => void; })),
}));
vi.mock('../../services/wordFrequency', () => ({ loadWordFrequency: vi.fn(async () => null) }));
vi.mock('../../services/readerWords', () => ({ invalidateKnownHanzi: vi.fn() }));

import { MemoryRouter } from 'react-router-dom';
import { CharacterView } from './CharacterView';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
});

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

async function render(own?: Own) {
  container = document.createElement('div');
  document.body.append(container);
  await act(async () => {
    root = createRoot(container!);
    root.render(
      <MemoryRouter>
        <CharacterView char="性" onClose={() => {}} />
      </MemoryRouter>,
    );
  });
  await tick();
  if (own) {
    await act(async () => {
      state.resolveOwn({ 性: own });
    });
    await tick();
  }
  return container!.querySelector('[data-testid="explorer-char-own"]') as HTMLElement;
}

describe('CharacterView: is the character itself a card?', () => {
  it('a placeholder while the cards are read — never "+ Add" for one he has', async () => {
    const block = await render();
    expect(block.getAttribute('data-status')).toBe('checking');
    expect(block.querySelector('[data-testid="explorer-char-own-checking"]')).not.toBeNull();
    expect(block.querySelector('[data-testid="explorer-char-add"]')).toBeNull();
  });

  it('in your decks: the line, Open card → and ⚡ Study it today', async () => {
    const block = await render({ status: 'in_decks', note_ids: ['n1'], decks: ['HSK 5'] });
    expect(block.getAttribute('data-status')).toBe('in_decks');
    expect(block.textContent).toContain('📚 You have 性 as a card in HSK 5');
    const buttons = [...block.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toContain('Open card →');
    expect(buttons.some((b) => b?.includes('Study it today'))).toBe(true);
  });

  it('known: says so in words', async () => {
    const block = await render({ status: 'known', note_ids: ['n1'], decks: ['HSK 5', 'Food'] });
    expect(block.getAttribute('data-status')).toBe('known');
    expect(block.textContent).toContain('✓ Known — you have 性 as a card in HSK 5, Food');
  });

  it('no card of its own: "+ Add 性 as a card"', async () => {
    const block = await render({ status: 'none', note_ids: [], decks: [] });
    expect(block.getAttribute('data-status')).toBe('none');
    expect(block.querySelector('[data-testid="explorer-char-add"]')!.textContent).toBe('+ Add 性 as a card');
  });
});
