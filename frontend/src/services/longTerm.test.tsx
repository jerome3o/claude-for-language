/**
 * "Add to my long-term review" on the web (docs/HOMEWORK.md §3a): the choice applies to the
 * study queue at once (offline too), goes up with PUT /api/notes/:id/long-term, and a sync
 * that rewrites the notes never flips an un-uploaded choice back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db, getStudyQueue, getQueueCounts, type LocalNote } from '../db/database';
import { CardQueue } from '../types';
import { applyPendingNotePrefs, setNoteLongTerm, uploadPendingNotePrefs } from './longTerm';
import { LongTermSwitch, longTermLine } from '../components/homework/LongTermSwitch';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn();

async function deck(id: string, caps: [number, number], priority = 0) {
  await db.decks.put({
    id, user_id: 'me', name: id, description: null,
    new_cards_per_day: caps[0], secondary_cards_per_day: caps[1], study_priority: priority,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', _synced_at: null,
  } as never);
}

async function word(id: string, deckId: string, hanzi: string, longTerm: 0 | 1 | null = null) {
  await db.notes.put({
    id, deck_id: deckId, hanzi, pinyin: '', english: '', audio_url: null, audio_provider: null, fun_facts: null,
    context: null, sentence_clue: null, sentence_clue_pinyin: null, sentence_clue_translation: null,
    sentence_clue_audio_url: null, multiple_choice_options: null, pinyin_only: 0, alternatives: null,
    long_term: longTerm, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', _synced_at: null,
  } satisfies LocalNote);
  await db.cards.put({
    id: `${id}-h`, note_id: id, deck_id: deckId, card_type: 'hanzi_to_meaning', queue: CardQueue.NEW,
    stability: 0, difficulty: 0, lapses: 0, learning_step: 0, ease_factor: 2.5, interval: 0, repetitions: 0,
    next_review_at: null, due_timestamp: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', _synced_at: null,
  } as never);
}

beforeEach(async () => {
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
  // A one-off-only homework copy (0 + 0) on top, a normal deck below.
  await deck('oneoff', [0, 0], 9);
  await deck('normal', [3, 6], 1);
  await word('o1', 'oneoff', '刮风');
  await word('o2', 'oneoff', '下雨');
  await word('n1', 'normal', '太阳');
  await word('n2', 'normal', '月亮');
});

const dueNotes = async () => (await getStudyQueue()).dueCards.map((c) => c.note_id);

describe('setNoteLongTerm', () => {
  it('switching a one-off word ON brings it into today\'s queue; OFF on a normal word keeps it out', async () => {
    // "Most common first" in the new-character tier: 月 (月亮) is more common than 太 (太阳).
    expect(await dueNotes()).toEqual(['n2', 'n1']);
    await setNoteLongTerm('o1', 1);
    await setNoteLongTerm('n2', 0);
    // Both bring new characters; the most common new character first: 太 before 风 / 刮 (the deck order only breaks ties).
    expect(await dueNotes()).toEqual(['n1', 'o1']);
    const counts = await getQueueCounts();
    expect(counts.new).toBe(2);
    expect(counts.hasMoreNew).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/notes/o1/long-term'), expect.objectContaining({ method: 'PUT', body: JSON.stringify({ long_term: 1 }) }));
  });

  it('offline: the choice applies at once, survives a sync rewriting the note, and goes up later', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });
    try {
      await setNoteLongTerm('n1', 0);
      expect(fetchMock).not.toHaveBeenCalled();
      // A sync writes the server's (older) row, then re-applies what is pending.
      await db.transaction('rw', [db.notes, db.pendingNotePrefs], async () => {
        await db.notes.update('n1', { long_term: null });
        await applyPendingNotePrefs();
      });
      expect((await db.notes.get('n1'))?.long_term).toBe(0);
      expect(await dueNotes()).toEqual(['n2']);
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
    }
    expect(await uploadPendingNotePrefs()).toEqual({ uploaded: 1, errors: [] });
    expect(await db.pendingNotePrefs.count()).toBe(0);
  });

  it('a failed upload stays queued; a deleted note (404) is dropped', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'busy' }) });
    await setNoteLongTerm('n1', 0);
    await uploadPendingNotePrefs();
    expect(await db.pendingNotePrefs.count()).toBe(1);
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Note not found' }) });
    expect((await uploadPendingNotePrefs()).uploaded).toBe(1);
    expect(await db.pendingNotePrefs.count()).toBe(0);
  });
});

describe('the pass switch', () => {
  it('renders on / off / started, and reports the new state', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onChange = vi.fn();
    await act(async () => root.render(<LongTermSwitch on={false} started={false} onChange={onChange} />));
    expect(host.textContent).toContain('Add to my long-term review');
    const input = host.querySelector('input[role="switch"]') as HTMLInputElement;
    expect(input.checked).toBe(false);
    await act(async () => input.click());
    expect(onChange).toHaveBeenCalledWith(true);
    await act(async () => root.render(<LongTermSwitch on started={false} onChange={onChange} />));
    expect(host.textContent).toContain('In my long-term review');
    await act(async () => root.render(<LongTermSwitch on started onChange={onChange} />));
    expect(host.textContent).toContain('Already in your reviews');
    expect(host.querySelector('input')).toBeNull();
    act(() => root.unmount());
  });

  it('says what the pass decided', () => {
    expect(longTermLine(12, 4)).toBe('12 words added to daily review · 4 left out');
    expect(longTermLine(16, 0)).toBe('All 16 words go into your daily review');
    expect(longTermLine(1, 0)).toBe('The word goes into your daily review');
    expect(longTermLine(0, 3)).toBe('3 words left out of daily review');
  });
});
