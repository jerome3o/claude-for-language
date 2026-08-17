import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getLocalNoteSentences,
  getLocalSentenceCounts,
  putLocalNoteSentences,
  clearLocalNoteSentences,
  syncSentenceSets,
  resetSentenceSetSyncCursor,
  topUpSentenceSets,
  getSentenceExplanation,
  getTextExplanation,
  ensureSentenceSetForNote,
} from './sentence-sets';
import { db, LocalNote, LocalCard } from '../db/database';
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
    explanation: null,
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

describe('topUpSentenceSets', () => {
  function makeCard(id: string, noteId: string, dueTimestamp: number | null, queue = 2): LocalCard {
    return {
      id,
      note_id: noteId,
      deck_id: 'deck-1',
      card_type: 'hanzi_to_meaning',
      queue,
      stability: 1,
      difficulty: 5,
      lapses: 0,
      learning_step: 0,
      ease_factor: 2.5,
      interval: 1,
      repetitions: 1,
      next_review_at: null,
      due_timestamp: dueTimestamp,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
      _synced_at: Date.now(),
    } as LocalCard;
  }

  function mockPrefetch() {
    return vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/sentences/prefetch')) {
          const body = JSON.parse(String(init?.body ?? '{}'));
          return new Response(
            JSON.stringify({ queued: body.note_ids?.length ?? 0, remaining: 0, echo: body }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );
  }

  function sentNoteIds(): string[] {
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const init = calls[0][1] as RequestInit;
    return JSON.parse(String(init.body)).note_ids as string[];
  }

  it('prioritises the notes whose cards are due soonest', async () => {
    const now = Date.now();
    await db.cards.bulkPut([
      makeCard('c-late', 'note-late', now + 60 * 60 * 1000),
      makeCard('c-overdue', 'note-overdue', now - 60 * 60 * 1000),
      makeCard('c-mid', 'note-mid', now + 10 * 60 * 1000),
    ]);
    mockPrefetch();

    await topUpSentenceSets();

    expect(sentNoteIds()).toEqual(['note-overdue', 'note-mid', 'note-late']);
  });

  it('lists each note once even when several of its cards are due', async () => {
    const now = Date.now();
    await db.cards.bulkPut([
      makeCard('c-1', 'note-1', now - 1000),
      makeCard('c-2', 'note-1', now - 500),
      makeCard('c-3', 'note-2', now - 100),
    ]);
    mockPrefetch();

    await topUpSentenceSets();

    expect(sentNoteIds()).toEqual(['note-1', 'note-2']);
  });

  it('falls back to new cards when nothing is due', async () => {
    await db.cards.put(makeCard('c-new', 'note-new', null, 0));
    mockPrefetch();

    await topUpSentenceSets();

    expect(sentNoteIds()).toEqual(['note-new']);
  });

  it('throttles repeat runs', async () => {
    await db.cards.put(makeCard('c-1', 'note-1', Date.now()));
    mockPrefetch();

    const first = await topUpSentenceSets();
    const second = await topUpSentenceSets();

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(1);
  });

  it('does nothing when offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    mockPrefetch();

    expect(await topUpSentenceSets()).toBeNull();

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });
});

describe('getSentenceExplanation', () => {
  it('returns the cached explanation without hitting the network', async () => {
    const explanation = {
      words: [{ hanzi: '明白', pinyin: 'míngbai', gloss: 'understand' }],
      construction: 'Subject + verb + 了.',
    };
    await putLocalNoteSentences('note-1', [
      makeSentence({ id: 's-1', explanation: JSON.stringify(explanation) }),
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('should not fetch'); }));

    expect(await getSentenceExplanation('s-1')).toEqual(explanation);
  });

  it('fetches and caches on the local row when not yet explained', async () => {
    await putLocalNoteSentences('note-1', [makeSentence({ id: 's-2' })]);
    const explanation = {
      words: [{ hanzi: '我', pinyin: 'wǒ', gloss: 'I' }],
      construction: 'Topic-comment.',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ explanation }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    expect(await getSentenceExplanation('s-2')).toEqual(explanation);

    const row = await db.noteSentences.get('s-2');
    expect(JSON.parse(row!.explanation!)).toEqual(explanation);
  });

  it('regenerates when the cached explanation is corrupt', async () => {
    await putLocalNoteSentences('note-1', [makeSentence({ id: 's-3', explanation: 'not json' })]);
    const explanation = { words: [{ hanzi: '好', pinyin: 'hǎo', gloss: 'good' }], construction: '.' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ explanation }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    expect(await getSentenceExplanation('s-3')).toEqual(explanation);
  });
});

describe('getTextExplanation', () => {
  const sentence = { hanzi: '我明白了。', pinyin: 'Wǒ míngbai le.', translation: 'I understand.' };
  const explanation = {
    words: [{ hanzi: '明白', pinyin: 'míngbai', gloss: 'understand' }],
    construction: 'Verb + 了 for a change of state.',
  };

  function mockExplainText() {
    return vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/api/sentences/explain-text')) {
          return new Response(JSON.stringify({ explanation }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`Unexpected fetch: ${input}`);
      })
    );
  }

  it('fetches and caches by sentence text', async () => {
    mockExplainText();

    expect(await getTextExplanation(sentence)).toEqual(explanation);

    const cached = await db.sentenceTextExplanations.get(sentence.hanzi);
    expect(JSON.parse(cached!.explanation)).toEqual(explanation);
  });

  it('serves the second look from the cache', async () => {
    mockExplainText();
    await getTextExplanation(sentence);
    await getTextExplanation(sentence);

    expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(1);
  });

  it('treats a different sentence as a different key', async () => {
    mockExplainText();
    await getTextExplanation(sentence);
    await getTextExplanation({ ...sentence, hanzi: '他明白了。' });

    expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(2);
  });

  it('refetches when the cached value is corrupt', async () => {
    await db.sentenceTextExplanations.put({
      key: sentence.hanzi,
      explanation: 'not json',
      cached_at: Date.now(),
    });
    mockExplainText();

    expect(await getTextExplanation(sentence)).toEqual(explanation);
  });
});

describe('ensureSentenceSetForNote', () => {
  const generated = [
    { ...makeSentence({ id: 'g1', position: 0, hanzi: '第一句' }) },
    { ...makeSentence({ id: 'g2', position: 1, hanzi: '第二句' }) },
  ];

  function mockGenerate() {
    return vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/sentences/generate')) {
          return new Response(JSON.stringify({ sentences: generated }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`Unexpected fetch: ${input}`);
      })
    );
  }

  function fetchCalls(): number {
    return (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
  }

  it('generates and stores a set for a note that has none', async () => {
    mockGenerate();

    await ensureSentenceSetForNote('note-fail-1');

    expect((await getLocalNoteSentences('note-fail-1')).map((r) => r.hanzi)).toEqual([
      '第一句',
      '第二句',
    ]);
  });

  it('does nothing when the note already has a set', async () => {
    await putLocalNoteSentences('note-has-set', [makeSentence({ id: 'existing' })]);
    mockGenerate();

    await ensureSentenceSetForNote('note-has-set');

    expect(fetchCalls()).toBe(0);
    expect((await getLocalNoteSentences('note-has-set')).map((r) => r.id)).toEqual(['existing']);
  });

  it('only starts one generation per note, however many times it is failed', async () => {
    mockGenerate();

    await ensureSentenceSetForNote('note-repeat');
    await ensureSentenceSetForNote('note-repeat');
    await ensureSentenceSetForNote('note-repeat');

    expect(fetchCalls()).toBe(1);
  });

  it('does nothing when offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    mockGenerate();

    await ensureSentenceSetForNote('note-offline');

    expect(fetchCalls()).toBe(0);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('swallows failures and lets a later attempt retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));

    await expect(ensureSentenceSetForNote('note-retry')).resolves.toBeUndefined();
    expect(fetchCalls()).toBe(1);

    mockGenerate();
    await ensureSentenceSetForNote('note-retry');
    expect((await getLocalNoteSentences('note-retry'))).toHaveLength(2);
  });
});
