/**
 * The Word view's card tie-in while this device's cards are still being read: a quiet
 * "Checking your cards…" placeholder — never nothing, never "+ Add as card" for a word the
 * learner has — then the right section as soon as the lookup answers (Jerome: the first tap on
 * 学习 in the Lab app's podcast player showed no card section at all).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Existing = Array<{ note: { id: string; hanzi: string; pinyin: string; english: string; deck_id: string }; deckName: string }>;
let resolveExisting: (e: Existing) => void = () => {};
// Characters of the word that are cards of their own (shared charOwnCards), per test.
const ownCards = vi.hoisted(() => ({}) as Record<string, { status: string; note_ids: string[]; decks: string[] }>);

vi.mock('../../services/analytics', () => ({ track: vi.fn(), trackError: vi.fn() }));
vi.mock('../../services/studyBumps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/studyBumps')>()),
  findExistingNotes: vi.fn(() => new Promise<Existing>((r) => { resolveExisting = r; })),
}));
vi.mock('../../services/wordDict', () => ({ lookupWord: vi.fn(async () => ({ status: 'offline' })) }));
vi.mock('../../services/charDict', () => ({
  lookupChar: vi.fn(async () => ({ status: 'missing' })),
  prefetchChars: vi.fn(async () => 0),
  charWordStatuses: vi.fn(async () => []),
  ownCardsFor: vi.fn(async (chars: string[]) => Object.fromEntries(chars.map((c) => [c, ownCards[c] ?? { status: 'none', note_ids: [], decks: [] }]))),
}));
vi.mock('../../services/wordFrequency', () => ({ loadWordFrequency: vi.fn(async () => null) }));
vi.mock('../../services/readerWords', () => ({
  cachedWordExplanation: vi.fn(async () => null),
  getWordExplanation: vi.fn(),
  invalidateKnownHanzi: vi.fn(),
}));
vi.mock('../../services/idioms', () => ({ hasCachedIdiom: vi.fn(async () => false) }));

import { MemoryRouter } from 'react-router-dom';
import { WordView } from './WordView';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  for (const k of Object.keys(ownCards)) delete ownCards[k];
  act(() => root?.unmount());
  container?.remove();
  root = null;
});

async function render() {
  container = document.createElement('div');
  const footer = document.createElement('div');
  document.body.append(container, footer);
  await act(async () => {
    root = createRoot(container!);
    root.render(
      <MemoryRouter>
        <WordView item={{ kind: 'word', hanzi: '学习', pinyin: 'xuéxí', gloss: 'to study', sentence: '我们一起学习中文。' }} onClose={() => {}} footer={footer} />
      </MemoryRouter>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  return footer;
}

describe('WordView card tie-in', () => {
  it('shows a placeholder while the cards are read, then the card', async () => {
    const footer = await render();
    expect(footer.querySelector('[data-testid="explorer-checking-cards"]')).not.toBeNull();
    expect(footer.querySelector('[data-testid="explorer-add-card"]')).toBeNull();

    await act(async () => {
      resolveExisting([{ note: { id: 'n1', hanzi: '学习', pinyin: 'xué xí', english: 'to study, learn', deck_id: 'd1' }, deckName: 'Legacy — Homework (not urgent) Pt 1' }]);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(footer.querySelector('[data-testid="explorer-checking-cards"]')).toBeNull();
    expect(footer.textContent).toContain('You have this card in Legacy — Homework (not urgent) Pt 1');
    expect(footer.querySelector('[data-testid="explorer-add-card"]')).toBeNull();
  });

  it('offers + Add as card once it knows the word is new', async () => {
    const footer = await render();
    await act(async () => {
      resolveExisting([]);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(footer.querySelector('[data-testid="explorer-checking-cards"]')).toBeNull();
    expect(footer.querySelector('[data-testid="explorer-add-card"]')).not.toBeNull();
  });

  it('marks a character chip that is a card of its own (📚 / ✓, said in the label too)', async () => {
    ownCards['学'] = { status: 'known', note_ids: ['c1'], decks: ['HSK 1'] };
    ownCards['习'] = { status: 'in_decks', note_ids: ['c2'], decks: ['HSK 2'] };
    await render();
    const chips = [...container!.querySelectorAll('[data-testid="explorer-char-chip"]')];
    expect(chips.map((c) => c.getAttribute('data-own'))).toEqual(['known', 'in_decks']);
    expect(chips.map((c) => c.querySelector('[data-testid="explorer-char-chip-own"]')?.textContent)).toEqual(['✓', '📚']);
    expect(chips[0].getAttribute('aria-label')).toBe('The character 学, xué — you have it as a card, known');
    expect(chips[1].getAttribute('aria-label')).toBe('The character 习, xí — you have it as a card');
  });

  it('a character with no card of its own has no badge', async () => {
    await render();
    const chips = [...container!.querySelectorAll('[data-testid="explorer-char-chip"]')];
    expect(chips).toHaveLength(2);
    expect(container!.querySelector('[data-testid="explorer-char-chip-own"]')).toBeNull();
    expect(chips[0].getAttribute('aria-label')).toBe('The character 学, xué');
  });
});
