/**
 * 📝 Reader word recap, end to end on the web (docs/STUDY_SESSION.md "Reader word recap"): words
 * tapped and read aloud wrong while reading → "Story finished ✓ — 📝 Recap N words" → the one-off
 * pass in story order (Not yet comes back) → every switch OFF by default → Done adds ONLY the
 * switched-on new words as cards (+ Up next) and bumps the switched-on word he already has.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fake = vi.hoisted(() => ({ current: null as { land: (t: string) => void } | null }));
vi.mock('../../hooks/useVoiceDictation', async () => {
  const React = await import('react');
  return {
    useVoiceDictation: (opts: { onSubmit: (a: { text: string; source: string; transcript: string | null; via?: string }) => void }) => {
      const [phase, setPhase] = React.useState<string>('idle');
      const latest = React.useRef(opts);
      latest.current = opts;
      fake.current = { land: (t) => { setPhase('idle'); latest.current.onSubmit({ text: t, source: 'spoken', transcript: t, via: 'live' }); } };
      return {
        state: { mode: 'voice', phase, failure: null, blocked: null },
        finalText: '', partialText: '', listening: phase === 'listening', busy: false, level: 0,
        say: () => setPhase('listening'), stop: () => setPhase('finishing'), cancel: () => setPhase('idle'),
        retake: vi.fn(), retryUpload: vi.fn(), edit: vi.fn(), type: vi.fn(), submit: vi.fn(), canSubmit: false, reset: vi.fn(),
      };
    },
  };
});
const track = vi.fn();
vi.mock('../../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: vi.fn() }));
const api = vi.hoisted(() => ({
  createDeck: vi.fn(async (name: string) => ({ id: 'deck-recap', name })),
  getDecks: vi.fn(async () => []),
  moveDeck: vi.fn(async () => ({})),
  glossWords: vi.fn(async (w: Array<{ hanzi: string; pinyin?: string; english?: string }>) => w.map((x) => ({ hanzi: x.hanzi, pinyin: x.pinyin ?? '', english: x.english ?? 'gloss' }))),
  enrichWords: vi.fn(async (w: Array<{ hanzi: string }>) => w.map((x) => ({ hanzi: x.hanzi, fun_facts: `${x.hanzi} explained`, sentence_clue: '', sentence_clue_pinyin: '', sentence_clue_translation: '' }))),
  createNotesBatch: vi.fn(async (_deck: string, notes: Array<{ hanzi: string }>) => ({ created: notes.map((n, i) => ({ id: `new-${i}`, hanzi: n.hanzi })), failed: [] })),
  addUpNextApi: vi.fn(async () => ({})),
}));
vi.mock('../../api/client', () => ({
  backfillReaderWords: vi.fn(), apiErrorStatus: () => undefined, generateReaderPageImage: vi.fn(),
  createDeck: api.createDeck, getDecks: api.getDecks, moveDeck: api.moveDeck, glossWords: api.glossWords,
  enrichWords: api.enrichWords, createNotesBatch: api.createNotesBatch,
  bumpNotesRemote: vi.fn(), addStudyBumps: vi.fn(async () => ({ bumps: [] })),
}));
vi.mock('../../api/upNext', () => ({ addUpNextApi: api.addUpNextApi }));
vi.mock('../../services/studyBumps', async () => {
  const { db } = await import('../../db/database');
  return {
    bumpNotes: vi.fn(async (ids: string[], source: string) => {
      for (const id of ids) await db.studyBumps.put({ id: `b-${id}`, note_id: id, created_at: new Date().toISOString(), source, bumped_by_name: null, pending: 'add' } as never);
      return { added: ids, already: [], message: '' };
    }),
  };
});
vi.mock('../../services/wordDict', () => ({ lookupWords: vi.fn(async () => new Map()) }));
vi.mock('../../contexts/NetworkContext', () => ({ useNetwork: () => ({ isOnline: true }) }));
vi.mock('../../services/chineseSegmenter', () => ({ useSegmentedWords: () => null, preloadSegmenter: () => {} }));
vi.mock('../../services/readerSync', () => ({ cacheReaderNarration: vi.fn(async () => {}), updateLocalReaderPageImage: vi.fn() }));
vi.mock('../../hooks/useCachedImageUrl', () => ({ useCachedImageUrl: () => null }));
vi.mock('../editor/useLessonSpeak', () => ({ useLessonSpeak: () => vi.fn() }));
vi.mock('../Confetti', () => ({ Confetti: () => <div data-testid="confetti" /> }));
vi.mock('../ReaderAudioScrubber', () => ({
  ReaderAudioScrubber: ({ controlsExtra }: { controlsExtra?: React.ReactNode }) => <div data-testid="scrubber">{controlsExtra}</div>,
}));
const explorerOpen = vi.fn();
vi.mock('../explorer/ExplorerContext', () => ({
  useExplorer: () => ({ open: explorerOpen, push: vi.fn(), inside: false }),
  ExplorerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { db } from '../../db/database';
import { ReaderView, type ReaderViewData } from '../reader/ReaderView';
import { ReaderRecapOffer } from './ReaderRecapOffer';
import { ReaderRecapPage } from '../../pages/ReaderRecapPage';
import { offerRecap, recapDb } from '../../services/wordRecap';

const w = (text: string, pinyin = '', gloss = '') => ({ text, pinyin, gloss });
const page = (id: string, zh: string, en: string, words: ReturnType<typeof w>[]) => ({
  id, reader_id: 'r-cd', page_number: 0, content_chinese: zh, content_pinyin: '', content_english: en, image_url: null, image_prompt: null, words,
}) as unknown as ReaderViewData['pages'][number];
const READER: ReaderViewData = {
  id: 'r-cd', title_chinese: '成都的一天', title_english: 'A day in Chengdu',
  pages: [
    page('p1', '他在春熙路采耳。', 'He gets his ears cleaned on Chunxi Road.', [w('他', 'tā', 'he'), w('在', 'zài', 'at'), w('春熙路', 'Chūnxī Lù', 'Chunxi Road'), w('采耳', "cǎi'ěr", 'ear cleaning'), w('。')]),
    page('p2', '我们去成都吃麻辣兔头。', 'We go to Chengdu to eat spicy rabbit heads.', [w('我们', 'wǒmen', 'we'), w('去', 'qù', 'go'), w('成都', 'Chéngdū', 'Chengdu'), w('吃', 'chī', 'eat'), w('麻辣', 'málà', 'numbing and spicy'), w('兔头', 'tùtóu', 'rabbit head'), w('。')]),
  ],
};

let host: HTMLDivElement;
let root: Root;
const finish = vi.fn();
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
  await flush();
};
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) ?? null;
const chip = (text: string) => [...host.querySelectorAll('.reader-word-chip')].find((b) => b.textContent === text) ?? null;

beforeEach(async () => {
  await recapDb().runs.clear();
  await recapDb().adds.clear();
  await db.studyBumps.clear();
  // 采耳 is already one of his cards: its switch is ⚡ Study it today.
  await db.notes.put({ id: 'note-caier', deck_id: 'd1', hanzi: '采耳', pinyin: "cǎi'ěr", english: 'ear cleaning' } as never);
  Object.values(api).forEach((f) => f.mockClear());
  track.mockClear();
  finish.mockClear();
  offerRecap(null);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/read']}>
      <Routes>
        <Route path="/read" element={<ReaderView reader={READER} source="library" topbarStart={null} topbarEnd={null} isFinishing={false} onFinish={finish} />} />
        <Route path="/readers/:id/recap" element={<ReaderRecapPage />} />
      </Routes>
      <ReaderRecapOffer />
    </MemoryRouter>,
  ));
  await flush();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('reader word recap', () => {
  it('collects taps and read-aloud mistakes, recaps them and adds only the switched-on words', async () => {
    // Page 1: tap 采耳 (→ the explorer, and into the recap).
    await click(host.querySelector('.reader-chinese-reveal-box'));
    await click(chip('采耳'));
    expect(explorerOpen).toHaveBeenCalledTimes(1);
    await click(button('Next'));
    // Page 2: read aloud — 成都 heard as 程度 (a tone slip on 都), 麻辣 missed.
    await click(q('reader-read-aloud'));
    await click(q('reader-read-aloud-stop-footer'));
    await act(async () => fake.current!.land('我们去程度吃兔头'));
    await flush();
    await click(q('reader-finish'));
    expect(finish).toHaveBeenCalledTimes(1);

    // The offer, over whatever comes next.
    const start = q('recap-offer-start');
    expect(start?.textContent).toBe('📝 Recap 3 words');
    expect(q('recap-offer')?.textContent).toContain('1 you tapped · 2 you read aloud differently');
    await click(start);
    expect(track).toHaveBeenCalledWith('reader.word_recap_start', { from: 'finish', words: 3 });
    expect(q('recap-offer')).toBeNull();

    // Story order: 采耳 (page 1), 成都, 麻辣.
    expect(q('recap-card')?.textContent).toContain('采耳');
    expect(q('recap-sentence')?.textContent).toBe('他在春熙路采耳。');
    await click(q('recap-show'));
    expect(q('recap-why')?.textContent).toContain('You tapped it while reading');
    // Already his: the switch is ⚡ Study it today, OFF by default.
    const caierSwitch = q('recap-keep-switch') as HTMLInputElement;
    expect(q('recap-keep')?.textContent).toContain('⚡ Study it today');
    expect(caierSwitch.checked).toBe(false);
    await click(caierSwitch);
    await click(q('recap-got-it'));

    expect(q('recap-card')?.textContent).toContain('成都');
    await click(q('recap-show'));
    expect(q('recap-why')?.textContent).toContain('Read aloud: 都 dū → you said dù (4th tone instead of 1st)');
    expect(q('recap-keep')?.textContent).toContain('Add to my long-term review');
    await click(q('recap-keep-switch'));
    await click(q('recap-not-yet'));

    expect(q('recap-card')?.textContent).toContain('麻辣');
    await click(q('recap-show'));
    await click(q('recap-got-it'));
    // 成都 comes back until Got it.
    expect(q('recap-card')?.textContent).toContain('成都');
    expect(q('recap-retry')?.textContent).toBe('Trying again · 1 left');
    await click(q('recap-show'));
    await click(q('recap-got-it'));

    // The list: every word with its switch (麻辣 left off).
    expect(q('recap-summary')?.textContent).toContain('Recap done');
    expect(q('recap-summary')?.textContent).toContain('2 right first time');
    const switches = [...host.querySelectorAll('[data-testid="recap-row-keep-switch"]')] as HTMLInputElement[];
    expect(switches.map((s) => s.checked)).toEqual([true, true, false]);

    await click(q('recap-done'));
    await flush();
    expect(q('recap-done-line')?.textContent).toBe('1 word added to your long-term review · 1 for today ⚡');
    expect(api.createDeck).toHaveBeenCalledWith('From my readers', expect.any(String));
    expect(api.moveDeck).toHaveBeenCalledWith('deck-recap', 'bottom');
    expect(api.createNotesBatch).toHaveBeenCalledTimes(1);
    const [deckId, notes, opts] = api.createNotesBatch.mock.calls[0] as unknown as [string, Array<Record<string, string>>, { skipExisting: boolean }];
    expect(deckId).toBe('deck-recap');
    expect(opts).toEqual({ skipExisting: true });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ hanzi: '成都', english: 'Chengdu', sentence_clue: '我们去成都吃麻辣兔头。', fun_facts: '成都 explained' });
    expect(api.addUpNextApi).toHaveBeenCalledWith({ note_ids: ['new-0'], position: 'bottom', source: 'reader_recap' });
    expect((await db.studyBumps.toArray()).map((b) => b.note_id)).toEqual(['note-caier']);
    expect(await recapDb().adds.count()).toBe(0);
    expect(track).toHaveBeenCalledWith('reader.word_recap_finish', { words: 3, got_it_first_time: 2, added: 1, bumped: 1 });
  });

  it('offers nothing when nothing was tapped or read wrong', async () => {
    await click(button('Next'));
    await click(q('reader-finish'));
    expect(finish).toHaveBeenCalledTimes(1);
    expect(q('recap-offer')).toBeNull();
  });
});
