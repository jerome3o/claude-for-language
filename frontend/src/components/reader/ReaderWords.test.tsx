/**
 * Reader word chips (web): a page with words shows chips, punctuation stays
 * plain, a word already in a deck is marked; tapping a chip opens the language
 * explorer's Word view (without hiding the Chinese) with the chip's pinyin,
 * gloss and sentence, "More about this word" shows the explanation, and
 * "+ Add as card" creates the note with the explanation's card fields.
 * A page without words is plain text until the backfill brings them, and
 * they are kept on the device for offline.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReaderWord } from '@shared/reader/words';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  backfillReaderWords: vi.fn(),
  explainReaderWord: vi.fn(),
  createNote: vi.fn(),
  generatePracticeTTS: vi.fn(),
  getDecks: vi.fn(),
  fetchWordRecords: vi.fn(),
  fetchCharRecord: vi.fn(),
  fetchCharRecords: vi.fn(),
  apiErrorStatus: (err: unknown) => (err as { status?: number } | null)?.status,
}));
vi.mock('../../api/client', () => api);
vi.mock('../../services/analytics', () => ({ track: vi.fn(), trackError: vi.fn() }));

import { MemoryRouter } from 'react-router-dom';
import { db } from '../../db/database';
import { ReaderWordsText } from './ReaderWords';
import { ExplorerProvider } from '../explorer/ExplorerContext';

const TEXT = '早上好。我叫小徐。';
const WORDS: ReaderWord[] = [
  { text: '早上', pinyin: 'zǎoshang', gloss: 'morning' },
  { text: '好', pinyin: 'hǎo', gloss: 'good' },
  { text: '。', pinyin: '', gloss: '' },
  { text: '我', pinyin: 'wǒ', gloss: 'I' },
  { text: '叫', pinyin: 'jiào', gloss: 'am called' },
  { text: '小徐', pinyin: 'Xiǎo Xú', gloss: 'Xiao Xu' },
  { text: '。', pinyin: '', gloss: '' },
];

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};

describe('ReaderWordsText', () => {
  let host: HTMLDivElement;
  let root: Root;
  const hide = vi.fn();

  const render = async (page: { id: string; content_chinese: string; words?: ReaderWord[] | null }) => {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <ExplorerProvider>
            <div onClick={hide}>
              <ReaderWordsText readerId="r1" page={page} />
            </div>
          </ExplorerProvider>
        </MemoryRouter>,
      ),
    );
    await flush();
  };
  const chips = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.reader-word-chip'));
  const click = async (el: Element | null | undefined) => {
    expect(el).toBeTruthy();
    await act(async () => (el as HTMLElement).click());
    await flush();
  };
  const byText = (sel: string, text: string) => Array.from(document.querySelectorAll(sel)).find((e) => e.textContent?.includes(text));

  beforeEach(async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    hide.mockReset();
    Object.values(api).forEach((f) => (f as { mockReset?: () => void }).mockReset?.());
    await db.decks.put({ id: 'd1', name: 'Readers', description: null, created_at: '', updated_at: '' } as never);
    await db.notes.put({ id: 'n1', deck_id: 'd1', hanzi: '早上', pinyin: 'zǎoshang', english: 'morning' } as never);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = '';
  });

  it('shows word chips; punctuation is plain; a known word is marked', async () => {
    await render({ id: 'p1', content_chinese: TEXT, words: WORDS });
    expect(chips().map((c) => c.textContent)).toEqual(['早上', '好', '我', '叫', '小徐']);
    expect(document.querySelector('[data-testid="reader-words"]')?.textContent).toBe(TEXT);
    expect(chips()[0].classList.contains('known')).toBe(true);
    expect(chips()[1].classList.contains('known')).toBe(false);
    expect(api.backfillReaderWords).not.toHaveBeenCalled();
  });

  it('tap → Word view with the chip\'s pinyin / gloss / sentence → More about this word → Add as card', async () => {
    api.explainReaderWord.mockResolvedValue({
      word: '小徐',
      pinyin: 'Xiǎo Xú',
      english: 'Xiao Xu (a name)',
      explanation: '小 little + 徐 a surname: a friendly way to call someone Xu.',
      fun_facts: '小 (xiǎo) little + 徐 (Xú) surname.',
      sentence_clue: '我叫小徐。',
      sentence_clue_pinyin: 'wǒ jiào Xiǎo Xú',
      sentence_clue_translation: 'My name is Xiao Xu.',
    });
    api.createNote.mockResolvedValue({ id: 'n2' });
    api.getDecks.mockResolvedValue([{ id: 'd1', name: 'Readers', study_priority: 0, created_at: '' }]);
    api.fetchWordRecords.mockResolvedValue({ version: 1, records: {}, missing: ['小徐'] });
    api.fetchCharRecords.mockResolvedValue({ version: 1, records: {}, missing: [] });
    await render({ id: 'p1', content_chinese: TEXT, words: WORDS });

    await click(chips()[4]);
    expect(hide).not.toHaveBeenCalled(); // the tap doesn't hide the Chinese
    const view = document.querySelector('[role="dialog"][aria-label="The word 小徐"]');
    expect(view).toBeTruthy();
    expect(view?.querySelector('.xp-word-pinyin')?.textContent).toBe('Xiǎo Xú');
    expect(view?.querySelector('.xp-word-english')?.textContent).toBe('Xiao Xu');
    expect(view?.textContent).toContain('我叫小徐。');

    await click(byText('button', 'More about this word'));
    expect(api.explainReaderWord).toHaveBeenCalledWith({ word: '小徐', sentence: '我叫小徐。', pinyin: 'Xiǎo Xú', gloss: 'Xiao Xu' });
    expect(document.querySelector('[data-testid="explorer-word-more"]')?.textContent).toContain('a surname');
    // the explanation is now on the device: offline it opens instantly
    expect(await db.sentenceTextExplanations.get('reader-word:小徐|我叫小徐。')).toBeTruthy();

    await click(byText('button', '+ Add as card'));
    await click(byText('button', 'Add to deck'));
    expect(api.createNote).toHaveBeenCalledWith('d1', {
      hanzi: '小徐',
      pinyin: 'Xiǎo Xú',
      english: 'Xiao Xu (a name)',
      fun_facts: '小 (xiǎo) little + 徐 (Xú) surname.',
      sentence_clue: '我叫小徐。',
      sentence_clue_pinyin: 'wǒ jiào Xiǎo Xú',
      sentence_clue_translation: 'My name is Xiao Xu.',
    });
    expect(hide).not.toHaveBeenCalled();
  });

  it('a word I already have says so and offers ⚡ Study it today', async () => {
    api.fetchWordRecords.mockResolvedValue({ version: 1, records: {}, missing: ['早上'] });
    api.fetchCharRecords.mockResolvedValue({ version: 1, records: {}, missing: [] });
    await render({ id: 'p1', content_chinese: TEXT, words: WORDS });
    await click(chips()[0]);
    await flush();
    expect(byText('.xp-have-line', 'You have this card in Readers')).toBeTruthy();
    expect(byText('.bump-btn', 'Study it today')).toBeTruthy();
    expect(byText('button', 'Open card')).toBeTruthy();
  });

  it('plain text until the backfill brings the words, which are kept on the device', async () => {
    await db.readers.put({ id: 'r1', pages: [{ id: 'p2', page_number: 1, content_chinese: TEXT, content_pinyin: '', content_english: '', image_url: null, image_prompt: null }] } as never);
    let resolve!: (v: unknown) => void;
    api.backfillReaderWords.mockReturnValue(new Promise((r) => (resolve = r)));
    await render({ id: 'p2', content_chinese: TEXT, words: null });
    expect(chips()).toHaveLength(0);
    expect(document.body.textContent).toContain(TEXT);
    expect(api.backfillReaderWords).toHaveBeenCalledWith({ reader_id: 'r1' });

    await act(async () => resolve({ pages: [{ id: 'p2', reader_id: 'r1', words: WORDS }], remaining: 0 }));
    await flush();
    expect(chips()).toHaveLength(5);
    const local = await db.readers.get('r1');
    expect(local?.pages[0].words).toEqual(WORDS);
  });

  it('stale words (the page text changed) are not shown', async () => {
    api.backfillReaderWords.mockResolvedValue({ pages: [], remaining: 0 });
    await render({ id: 'p3', content_chinese: '早上好！', words: WORDS });
    expect(chips()).toHaveLength(0);
    expect(document.body.textContent).toContain('早上好！');
  });
});
