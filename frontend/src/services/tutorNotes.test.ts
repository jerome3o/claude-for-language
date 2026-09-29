import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TutorNote } from '@shared/tutor-notes';
import { db, type LocalCard } from '../db/database';
import { loadTutorNotes, markTutorNotesSeen, syncTutorNotes } from './tutorNotes';
import { practiceCounts, ratePracticeCard } from './tutorNotesPractice';
import { CardQueue } from '../types';

vi.mock('./sync', () => ({ syncService: { syncEvents: vi.fn(async () => undefined) } }));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  vi.stubGlobal('fetch', fetchMock);
});

function tutorNote(id: string, over: Partial<TutorNote> = {}): TutorNote {
  return {
    id,
    kind: 'recording',
    card_id: `card-${id}`,
    card_type: 'hanzi_to_meaning',
    note_id: `note-${id}`,
    deck_id: 'deck-1',
    hanzi: '中国',
    pinyin: 'Zhōngguó',
    english: 'China',
    comment: '国 is second tone',
    tutor_name: '明慧老师',
    updated_at: '2026-09-28T10:00:00Z',
    seen_at: null,
    recording_url: `recordings/${id}.webm`,
    student_message: null,
    ...over,
  };
}

function card(over: Partial<LocalCard> = {}): LocalCard {
  return {
    id: 'c1',
    note_id: 'n1',
    deck_id: 'd1',
    card_type: 'hanzi_to_meaning',
    queue: CardQueue.REVIEW,
    stability: 5,
    difficulty: 5,
    lapses: 0,
    learning_step: 0,
    ease_factor: 2.5,
    interval: 5,
    repetitions: 2,
    next_review_at: new Date(Date.now() - 86_400_000).toISOString(),
    due_timestamp: null,
    last_reviewed_at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    _synced_at: 0,
    ...over,
  };
}

describe('tutor notes on the device', () => {
  it('syncTutorNotes mirrors the full list (seen ones included), replacing the old copy', async () => {
    await db.tutorNotes.put(tutorNote('stale'));
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ notes: [tutorNote('a'), tutorNote('b', { seen_at: '2026-09-27T00:00:00Z' })], next_cursor: null }) });
    expect(await syncTutorNotes()).toEqual({ notes: 2, more: false });
    expect(fetchMock.mock.calls[0][0]).toContain('/api/me/tutor-notes?include_seen=1');
    expect((await db.tutorNotes.toArray()).map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('loadTutorNotes: the unseen feed decides "new"; blanks are filled from the local note', async () => {
    await db.tutorNotes.bulkPut([tutorNote('a'), tutorNote('b', { updated_at: '2026-09-20T00:00:00Z', seen_at: '2026-09-21T00:00:00Z' })]);
    await db.recordingNotes.bulkPut([
      { id: 'a', kind: 'recording', card_id: 'card-a', note_id: 'note-a', hanzi: '中国', comment: '国 is second tone', tutor_name: '明慧老师', updated_at: '2026-09-28T10:00:00Z', seen_at: null, _synced: 1 },
      { id: 'fresh', kind: 'flag', card_id: null, note_id: 'n-local', hanzi: '刮风', comment: '刮 = to blow', tutor_name: '明慧老师', updated_at: '2026-09-29T08:00:00Z', seen_at: null, _synced: 1 },
    ]);
    await db.notes.put({ id: 'n-local', deck_id: 'd9', hanzi: '刮风', pinyin: 'guā fēng', english: 'windy' } as never);
    const list = await loadTutorNotes();
    expect(list.fresh.map((n) => n.id)).toEqual(['fresh', 'a']);
    expect(list.fresh[0]).toMatchObject({ pinyin: 'guā fēng', english: 'windy', deck_id: 'd9' });
    expect(list.earlier.map((n) => n.id)).toEqual(['b']);
  });

  it('markTutorNotesSeen: hidden from the card back at once, the server is told, the list reads it as earlier', async () => {
    await db.tutorNotes.put(tutorNote('a'));
    await db.recordingNotes.put({ id: 'a', kind: 'recording', card_id: 'card-a', note_id: 'note-a', hanzi: '中国', comment: 'x', tutor_name: null, updated_at: '2026-09-28T10:00:00Z', seen_at: null, _synced: 1 });
    await markTutorNotesSeen(['a']);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/me/recording-notes/a/seen'), expect.objectContaining({ method: 'POST' }));
    expect((await db.recordingNotes.toArray()).filter((n) => n.seen_at === null)).toEqual([]);
    expect((await db.tutorNotes.get('a'))?.seen_at).toBeTruthy();
    const list = await loadTutorNotes();
    expect(list.fresh).toEqual([]);
    expect(list.earlier.map((n) => n.id)).toEqual(['a']);
  });
});

describe('practice: a rating is a review only when the card is due', () => {
  it('a card not due yet: practice only — no review event, the card is untouched', async () => {
    const notDue = card({ next_review_at: new Date(Date.now() + 5 * 86_400_000).toISOString() });
    await db.cards.put(notDue);
    expect(practiceCounts(notDue)).toBe(false);
    const r = await ratePracticeCard(notDue, 0, { timeSpentMs: 3000, recordingBlob: new Blob(['x']) });
    expect(r.counted).toBe(false);
    expect(await db.reviewEvents.count()).toBe(0);
    expect(await db.pendingRecordings.count()).toBe(0);
    expect(await db.cards.get('c1')).toEqual(notDue);
  });

  it('a NEW card is never introduced by practice', async () => {
    const fresh = card({ queue: CardQueue.NEW, next_review_at: null, repetitions: 0, interval: 0, last_reviewed_at: null });
    await db.cards.put(fresh);
    const r = await ratePracticeCard(fresh, 2);
    expect(r.counted).toBe(false);
    expect(await db.reviewEvents.count()).toBe(0);
  });

  it('a card due today: the rating is a normal review (event + recomputed state)', async () => {
    const due = card();
    await db.cards.put(due);
    expect(practiceCounts(due)).toBe(true);
    const r = await ratePracticeCard(due, 2, { timeSpentMs: 4000, userAnswer: '中国' });
    expect(r.counted).toBe(true);
    const events = await db.reviewEvents.toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ card_id: 'c1', rating: 2, user_answer: '中国', _synced: 0 });
    expect(r.card.queue).not.toBe(CardQueue.NEW);
  });
});
