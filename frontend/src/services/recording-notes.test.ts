import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, LocalRecordingNote } from '../db/database';
import {
  syncRecordingNotes,
  uploadSeenRecordingNotes,
  getUnseenRecordingNotesForCard,
  markRecordingNoteSeen,
  ServerRecordingNote,
} from './recording-notes';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function serverNote(overrides: Partial<ServerRecordingNote> = {}): ServerRecordingNote {
  return {
    event_id: 'evt-1',
    card_id: 'card-1',
    note_id: 'note-1',
    hanzi: '点菜',
    comment: 'second tone, not fourth',
    tutor_name: 'Wang Laoshi',
    updated_at: '2026-09-17T10:00:00Z',
    ...overrides,
  };
}

function localNote(overrides: Partial<LocalRecordingNote> = {}): LocalRecordingNote {
  return {
    id: 'evt-1',
    card_id: 'card-1',
    note_id: 'note-1',
    hanzi: '点菜',
    comment: 'second tone, not fourth',
    tutor_name: 'Wang Laoshi',
    updated_at: '2026-09-17T10:00:00Z',
    seen_at: null,
    _synced: 1,
    ...overrides,
  };
}

/** Route GET (list) and POST (seen) calls; records which event ids were marked seen. */
function mockServer(notes: ServerRecordingNote[], opts: { failSeen?: boolean } = {}) {
  const seen: string[] = [];
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && /\/me\/recording-notes\/[^/]+\/seen$/.test(url)) {
      if (opts.failSeen) return { ok: false, status: 500, json: async () => ({}) };
      seen.push(decodeURIComponent(url.split('/').slice(-2)[0]));
      return { ok: true, status: 200, json: async () => ({ success: true, updated: true }) };
    }
    if (url.endsWith('/me/recording-notes')) {
      return { ok: true, status: 200, json: async () => ({ notes }) };
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
  return seen;
}

beforeEach(() => {
  mockFetch.mockReset();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
});

describe('syncRecordingNotes', () => {
  it('pulls unseen notes into IndexedDB so the card back can show them offline', async () => {
    mockServer([serverNote(), serverNote({ event_id: 'evt-2', card_id: 'card-2', hanzi: '东北', comment: 'clearer final' })]);

    const result = await syncRecordingNotes();

    expect(result).toEqual({ downloaded: 2, uploaded: 0 });
    const rows = await db.recordingNotes.toArray();
    expect(rows).toHaveLength(2);
    const first = await db.recordingNotes.get('evt-1');
    expect(first).toMatchObject({ card_id: 'card-1', comment: 'second tone, not fourth', tutor_name: 'Wang Laoshi', seen_at: null, _synced: 1 });
  });

  it('drops local unseen rows the server no longer returns (cleared or seen elsewhere)', async () => {
    await db.recordingNotes.put(localNote({ id: 'evt-old', card_id: 'card-9' }));
    mockServer([serverNote()]);

    await syncRecordingNotes();

    expect(await db.recordingNotes.get('evt-old')).toBeUndefined();
    expect(await db.recordingNotes.get('evt-1')).toBeDefined();
  });

  it('uploads "seen" marks made offline and does not resurrect them', async () => {
    await db.recordingNotes.put(localNote({ seen_at: '2026-09-17T12:00:00Z', _synced: 0 }));
    // Server still lists evt-1 as unseen (it has not heard about the mark yet)
    const seen = mockServer([serverNote()]);

    const result = await syncRecordingNotes();

    expect(seen).toEqual(['evt-1']);
    expect(result.uploaded).toBe(1);
    // Confirmed by the server → deleted locally, and not re-added from the list
    expect(await db.recordingNotes.get('evt-1')).toBeUndefined();
  });

  it('keeps a pending "seen" row when the upload fails, and still does not resurrect it', async () => {
    await db.recordingNotes.put(localNote({ seen_at: '2026-09-17T12:00:00Z', _synced: 0 }));
    mockServer([serverNote()], { failSeen: true });

    const result = await syncRecordingNotes();

    expect(result.uploaded).toBe(0);
    const row = await db.recordingNotes.get('evt-1');
    expect(row).toMatchObject({ seen_at: '2026-09-17T12:00:00Z', _synced: 0 });
  });

  it('uploadSeenRecordingNotes ignores unseen rows', async () => {
    await db.recordingNotes.put(localNote());
    const seen = mockServer([]);
    const result = await uploadSeenRecordingNotes();
    expect(result.uploaded).toBe(0);
    expect(seen).toEqual([]);
  });
});

describe('getUnseenRecordingNotesForCard', () => {
  it('returns only unseen notes for that card, newest first', async () => {
    await db.recordingNotes.bulkPut([
      localNote({ id: 'a', updated_at: '2026-09-01T00:00:00Z' }),
      localNote({ id: 'b', updated_at: '2026-09-05T00:00:00Z' }),
      localNote({ id: 'c', seen_at: '2026-09-06T00:00:00Z', _synced: 0 }),
      localNote({ id: 'd', card_id: 'other-card' }),
    ]);
    const notes = await getUnseenRecordingNotesForCard('card-1');
    expect(notes.map(n => n.id)).toEqual(['b', 'a']);
  });
});

describe('markRecordingNoteSeen', () => {
  it('online: tells the server and removes the row', async () => {
    await db.recordingNotes.put(localNote());
    const seen = mockServer([]);

    await markRecordingNoteSeen('evt-1');

    expect(seen).toEqual(['evt-1']);
    expect(await db.recordingNotes.get('evt-1')).toBeUndefined();
    expect(await getUnseenRecordingNotesForCard('card-1')).toEqual([]);
  });

  it('offline: marks locally (so it never shows twice) and leaves it for the next sync', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });
    await db.recordingNotes.put(localNote());

    await markRecordingNoteSeen('evt-1');

    expect(mockFetch).not.toHaveBeenCalled();
    const row = await db.recordingNotes.get('evt-1');
    expect(row?.seen_at).toBeTruthy();
    expect(row?._synced).toBe(0);
    expect(await getUnseenRecordingNotesForCard('card-1')).toEqual([]);
  });

  it('is a no-op for unknown or already-seen notes', async () => {
    mockServer([]);
    await markRecordingNoteSeen('missing');
    await db.recordingNotes.put(localNote({ seen_at: '2026-09-17T12:00:00Z', _synced: 0 }));
    await markRecordingNoteSeen('evt-1');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
