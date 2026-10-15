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
});
