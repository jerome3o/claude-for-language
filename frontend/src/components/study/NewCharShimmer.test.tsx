/**
 * New characters shimmer (web): the seen set comes from the reviewed notes on the device (or the
 * study queue's own load), a card works out its new characters once — only those characters get
 * the shimmer span, the text and the explorer's per-character tap targets are unchanged — rating
 * makes them seen for the NEXT card while this one keeps its shimmer, and the Settings switch
 * turns it off.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../services/analytics', () => ({ track: vi.fn(), trackError: vi.fn() }));

import { MemoryRouter } from 'react-router-dom';
import { db, getStudyQueue, type LocalCard } from '../../db/database';
import { CardQueue } from '../../types';
import { ExplorableText } from '../explorer/ExplorableText';
import { ExplorerProvider } from '../explorer/ExplorerContext';
import { NewCharsLabel, shimmerText } from './NewCharShimmer';
import {
  noteCharactersSeen,
  primeSeenCharacters,
  resetSeenCharactersForTests,
  useNewCharacters,
  writeNewCharShimmerOn,
} from '../../services/newCharacters';

const iso = () => new Date().toISOString();

async function seed() {
  await db.decks.put({ id: 'd1', user_id: 'u1', name: 'HSK 2', new_cards_per_day: 3, secondary_cards_per_day: 6, created_at: iso(), updated_at: iso() } as never);
  for (const [id, hanzi] of [['n-silver', '银子'], ['n-bank', '银行'], ['n-hi', '你好']]) {
    await db.notes.put({ id, deck_id: 'd1', hanzi, pinyin: '', english: '', audio_url: null, fun_facts: null, created_at: iso(), updated_at: iso(), _synced_at: null } as never);
  }
  const card = (id: string, noteId: string, queue: CardQueue): LocalCard => ({
    id, note_id: noteId, deck_id: 'd1', card_type: 'hanzi_to_meaning', queue, stability: queue === CardQueue.NEW ? 0 : 3, difficulty: 5, lapses: 0,
    learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: 0, next_review_at: null, due_timestamp: null,
    created_at: iso(), updated_at: iso(), _synced_at: null,
  } as LocalCard);
  // 银子 and 你好 were reviewed (seen); 银行 is a new note: 行 is the new character.
  await db.cards.bulkPut([card('c-silver', 'n-silver', CardQueue.REVIEW), card('c-hi', 'n-hi', CardQueue.REVIEW), card('c-bank', 'n-bank', CardQueue.NEW)]);
}

function Card({ id, hanzi, inStudySession = true }: { id: string; hanzi: string; inStudySession?: boolean }) {
  const newChars = useNewCharacters(id, hanzi, inStudySession);
  return (
    <div>
      <div className="hanzi hanzi-large" data-testid={`front-${id}`}>{shimmerText(hanzi, newChars)}</div>
      <div className="hanzi hanzi-large" data-testid={`back-${id}`}>
        <ExplorableText text={hanzi} source="study" tapClassName="hanzi-char-clickable" newChars={newChars} />
      </div>
      <NewCharsLabel newChars={newChars} />
    </div>
  );
}

let root: Root | null = null;
let container: HTMLDivElement;

async function render(ui: ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<MemoryRouter><ExplorerProvider>{ui}</ExplorerProvider></MemoryRouter>);
  });
  // The seen set loads from IndexedDB the first time.
  for (let i = 0; i < 20 && !container.querySelector('[data-testid="new-char"]'); i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  }
}

const shimmering = (el: Element | null) => [...(el?.querySelectorAll('.new-char') ?? [])].map(e => e.textContent);

describe('new characters shimmer', () => {
  beforeEach(async () => {
    resetSeenCharactersForTests();
    localStorage.clear();
    await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear()]);
    await seed();
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
  });

  it('only the never-seen character shimmers, front and back, with the text and tap targets unchanged', async () => {
    await render(<Card id="c-bank" hanzi="银行" />);
    const front = container.querySelector('[data-testid="front-c-bank"]');
    const back = container.querySelector('[data-testid="back-c-bank"]');
    expect(shimmering(front)).toEqual(['行']);
    expect(shimmering(back)).toEqual(['行']);
    expect(front?.textContent).toBe('银行');
    // Still one tappable piece per character; the shimmer span sits inside 行's.
    const taps = back?.querySelectorAll('.hanzi-char-clickable') ?? [];
    expect([...taps].map(t => t.textContent)).toEqual(['银', '行']);
    expect(taps[1].querySelector('.new-char')).not.toBeNull();
    expect(container.querySelector('.new-char-sr')?.textContent).toBe('New character: 行');
  });

  it('a card of known characters has no shimmer and no label', async () => {
    await render(<Card id="c-hi" hanzi="你好" />);
    expect(container.querySelector('.new-char')).toBeNull();
    expect(container.querySelector('.new-char-sr')).toBeNull();
  });

  it('the study queue primes the same seen set', async () => {
    const queue = await getStudyQueue();
    expect([...queue.seenCharacters].sort()).toEqual(['你', '好', '子', '银'].sort());
  });

  it('rating makes the character seen for the next card; the card on screen keeps its shimmer', async () => {
    primeSeenCharacters((await getStudyQueue()).seenCharacters);
    await render(<Card id="c-bank" hanzi="银行" />);
    expect(shimmering(container)).toContain('行');
    act(() => noteCharactersSeen('银行'));
    // Re-render the same card: still shimmering (worked out once when it arrived).
    await act(async () => root!.render(<MemoryRouter><ExplorerProvider><Card id="c-bank" hanzi="银行" /></ExplorerProvider></MemoryRouter>));
    expect(shimmering(container.querySelector('[data-testid="front-c-bank"]'))).toEqual(['行']);
    // The next card with 行 no longer shimmers.
    await act(async () => root!.render(<MemoryRouter><ExplorerProvider><Card id="c-next" hanzi="行人" /></ExplorerProvider></MemoryRouter>));
    expect(shimmering(container.querySelector('[data-testid="front-c-next"]'))).toEqual(['人']);
  });

  it('Settings → Study → "Shimmer new characters" off: no shimmer', async () => {
    writeNewCharShimmerOn(false);
    await render(<Card id="c-bank" hanzi="银行" />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(container.querySelector('.new-char')).toBeNull();
    act(() => writeNewCharShimmerOn(true));
    expect(shimmering(container.querySelector('[data-testid="front-c-bank"]'))).toEqual(['行']);
  });

  it('outside the flashcard study session (homework pass, tutor-notes practice): never', async () => {
    await render(<Card id="c-bank" hanzi="银行" inStudySession={false} />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(container.querySelector('.new-char')).toBeNull();
    expect(container.querySelector('.new-char-sr')).toBeNull();
    // Even with the seen set in memory (a session ran before): still nothing.
    primeSeenCharacters(new Set());
    await act(async () => root!.render(<MemoryRouter><ExplorerProvider><Card id="c-x" hanzi="第一节课前半小时" inStudySession={false} /></ExplorerProvider></MemoryRouter>));
    expect(container.querySelector('.new-char')).toBeNull();
  });

  it('a seen set that could not be loaded is not "nothing seen": no shimmer at all', async () => {
    const spy = vi.spyOn(db.cards, 'where').mockImplementation(() => { throw new Error('IndexedDB unavailable'); });
    try {
      await render(<Card id="c-bank" hanzi="银行" />);
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });
      expect(container.querySelector('.new-char')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('an account with no reviews at all (loaded, empty) is real: every character is new', async () => {
    primeSeenCharacters(new Set());
    await render(<Card id="c-bank" hanzi="银行" />);
    expect(shimmering(container.querySelector('[data-testid="front-c-bank"]'))).toEqual(['银', '行']);
  });
});
