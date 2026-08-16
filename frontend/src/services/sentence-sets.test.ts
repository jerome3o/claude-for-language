import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getLocalNoteSentences,
  getLocalSentenceCounts,
  putLocalNoteSentences,
  clearLocalNoteSentences,
  syncSentenceSets,
  resetSentenceSetSyncCursor,
} from './sentence-sets';
import { db, LocalNote } from '../db/database';
import { NoteSentence } from '../types';

function makeSentence(overrides: Partial<NoteSentence> = {}): NoteSentence {
  return {
    id: overrides.id ?? `s-${Math.random().toString(36).slice(2, 8)}`,
    note_id: 'note-1',
    position: 0,
    hanzi: '我明白了。',
    pinyin: 'Wǒ míngbai le.',
    translation: 'I understand.',
    audio_url: null,
    focus: 'core',
    focus_note: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeNote(id: string): LocalNote {
  return {
    id,
    deck_id: 'deck-1',
    hanzi: '明白',
    pinyin: 'míngbai',
    english: 'to understand',
    audio_url: null,
    audio_provider: null,
    fun_facts: null,
    context: null,
    sentence_clue: null,
    sentence_clue_pinyin: null,
    sentence_clue_translation: null,
    sentence_clue_audio_url: null,
    multiple_choice_options: null,
    pinyin_only: 0,
    alternatives: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    _synced_at: Date.now(),
  } as LocalNote;
}

function mockChanges(sentences: NoteSentence[], serverTime = '2026-08-02T00:00:00.000Z') {
  return vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/sentences/changes')) {
        return new Response(JSON.stringify({ sentences, server_time: serverTime }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  resetSentenceSetSyncCursor();
});

describe('local sentence storage', () => {
  it('returns a note\'s sentences ordered by position', async () => {
    await putLocalNoteSentences('note-1', [
      makeSentence({ id: 'b', position: 2, hanzi: '第三' }),
      makeSentence({ id: 'a', position: 0, hanzi: '第一' }),
      makeSentence({ id: 'c', position: 1, hanzi: '第二' }),
    ]);

    const rows = await getLocalNoteSentences('note-1');
    expect(rows.map((r) => r.hanzi)).toEqual(['第一', '第二', '第三']);
  });

  it('replaces the whole set rather than merging', async () => {
    await putLocalNoteSentences('note-1', [
      makeSentence({ id: 'old-1', position: 0 }),
      makeSentence({ id: 'old-2', position: 1 }),
    ]);
    await putLocalNoteSentences('note-1', [makeSentence({ id: 'new-1', position: 0 })]);

    const rows = await getLocalNoteSentences('note-1');
    expect(rows.map((r) => r.id)).toEqual(['new-1']);
  });

  it('leaves other notes alone', async () => {
    await putLocalNoteSentences('note-1', [makeSentence({ id: 'a' })]);
    await putLocalNoteSentences('note-2', [makeSentence({ id: 'b', note_id: 'note-2' })]);

    await clearLocalNoteSentences('note-1');

    expect(await getLocalNoteSentences('note-1')).toHaveLength(0);
    expect(await getLocalNoteSentences('note-2')).toHaveLength(1);
  });

  it('counts sentences per note', async () => {
    await putLocalNoteSentences('note-1', [
      makeSentence({ id: 'a', position: 0 }),
      makeSentence({ id: 'b', position: 1 }),
    ]);
    await putLocalNoteSentences('note-2', [makeSentence({ id: 'c', note_id: 'note-2' })]);

    const counts = await getLocalSentenceCounts(['note-1', 'note-2', 'note-3']);
    expect(counts.get('note-1')).toBe(2);
    expect(counts.get('note-2')).toBe(1);
    expect(counts.has('note-3')).toBe(false);
  });
});

describe('syncSentenceSets', () => {
  it('stores downloaded sentences and records the cursor', async () => {
    await db.notes.put(makeNote('note-1'));
    mockChanges([
      makeSentence({ id: 'a', position: 0, hanzi: '第一' }),
      makeSentence({ id: 'b', position: 1, hanzi: '第二' }),
    ]);

    const result = await syncSentenceSets();

    expect(result.synced).toBe(2);
    expect((await getLocalNoteSentences('note-1')).map((r) => r.hanzi)).toEqual(['第一', '第二']);
    expect(localStorage.getItem('sentenceSetsLastSync')).toBe('2026-08-02T00:00:00.000Z');
  });

  it('sends the stored cursor on the next run', async () => {
    await db.notes.put(makeNote('note-1'));
    mockChanges([]);
    await syncSentenceSets();
    await syncSentenceSets();

    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(String(calls[0][0])).not.toContain('since=');
    expect(String(calls[1][0])).toContain('since=2026-08-02');
  });

  it('replaces a note\'s set wholesale, dropping rows the server no longer has', async () => {
    await db.notes.put(makeNote('note-1'));
    await putLocalNoteSentences('note-1', [
      makeSentence({ id: 'old-1', position: 0 }),
      makeSentence({ id: 'old-2', position: 1 }),
      makeSentence({ id: 'old-3', position: 2 }),
    ]);

    mockChanges([makeSentence({ id: 'fresh', position: 0, hanzi: '新句子' })]);
    await syncSentenceSets();

    const rows = await getLocalNoteSentences('note-1');
    expect(rows.map((r) => r.id)).toEqual(['fresh']);
  });

  it('only touches notes present in the response', async () => {
    await db.notes.bulkPut([makeNote('note-1'), makeNote('note-2')]);
    await putLocalNoteSentences('note-2', [makeSentence({ id: 'keep', note_id: 'note-2' })]);

    mockChanges([makeSentence({ id: 'fresh', note_id: 'note-1' })]);
    await syncSentenceSets();

    expect((await getLocalNoteSentences('note-2')).map((r) => r.id)).toEqual(['keep']);
  });

  it('prunes sentences whose note no longer exists locally', async () => {
    await db.notes.put(makeNote('note-1'));
    await putLocalNoteSentences('note-gone', [
      makeSentence({ id: 'orphan', note_id: 'note-gone' }),
    ]);

    mockChanges([]);
    await syncSentenceSets();

    expect(await getLocalNoteSentences('note-gone')).toHaveLength(0);
  });

  it('leaves local data untouched when the request fails', async () => {
    await db.notes.put(makeNote('note-1'));
    await putLocalNoteSentences('note-1', [makeSentence({ id: 'local' })]);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));

    await expect(syncSentenceSets()).rejects.toThrow();
    expect((await getLocalNoteSentences('note-1')).map((r) => r.id)).toEqual(['local']);
    expect(localStorage.getItem('sentenceSetsLastSync')).toBeNull();
  });
});
