/**
 * Practice per example sentence on the device (services/sentencePractice.ts): events written first,
 * uploaded (accepted → synced, refused → never retried), every device's events downloaded after the
 * cursor, and the "more sentences" ask once a day — waiting for the next sync offline.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./analytics', () => ({ track: vi.fn() }));
vi.mock('../api/client', () => ({ API_BASE: '', getAuthHeaders: () => ({}), getLocalDateString: () => '2026-10-24' }));

const calls: Array<{ path: string; body: any }> = [];
let serverEvents: any[] = [];

beforeEach(async () => {
  calls.length = 0;
  serverEvents = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, '');
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ path, body });
    if (path.startsWith('/me/sentence-practice') && init?.method === 'POST') {
      const ids = body.events.map((e: { id: string }) => e.id);
      return new Response(JSON.stringify({ accepted: ids.filter((id: string) => id !== 'bad'), rejected: [], stored: ids.length }));
    }
    if (path.startsWith('/me/sentence-practice')) {
      return new Response(JSON.stringify({ events: serverEvents, cursor: serverEvents.length ? '2026-10-24T10:00:00.000Z' : null, more: false }));
    }
    if (path === '/sentences/top-up') return new Response(JSON.stringify({ queued: 1, note_ids: body.note_ids }));
    return new Response('{}', { status: 404 });
  }));
  const m = await import('./sentencePractice');
  await m.resetSentencePracticeForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sentencePractice', () => {
  it('records, uploads and downloads events; stats fold them', async () => {
    const m = await import('./sentencePractice');
    m.recordSentenceAttempt('n1', 'clue:n1', 'read', 'right');
    await m.hideSentence('n1', 's2', 'weird', 'list');
    await m.uploadPendingSentencePractice();
    const posted = calls.filter((c) => c.body?.events).flatMap((c) => c.body.events);
    expect(posted.map((e: any) => `${e.kind}:${e.sentence_key}`).sort()).toEqual(['attempt:clue', 'hide:s2']);
    serverEvents = [{ id: 'other-device', note_id: 'n1', sentence_key: 'clue', kind: 'attempt', mode: 'translate', result: 'close', at: '2026-10-24T09:00:00.000Z' }];
    await m.syncSentencePractice();
    expect(calls.some((c) => c.path === '/me/sentence-practice')).toBe(true);
  });

  it('asks for more sentences once a day; offline the ask waits for the sync', async () => {
    const m = await import('./sentencePractice');
    m.requestMoreSentences('n1', 'known');
    m.requestMoreSentences('n1', 'known');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.filter((c) => c.path === '/sentences/top-up')).toHaveLength(1);
    expect(m.sentencesComing('n1')).toBe(true);
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    m.requestMoreSentences('n2', 'few');
    expect(calls.filter((c) => c.path === '/sentences/top-up')).toHaveLength(1);
    expect(m.sentencesComing('n2')).toBe(true);
    online.mockReturnValue(true);
    await m.syncSentencePractice();
    expect(calls.filter((c) => c.path === '/sentences/top-up').at(-1)!.body).toEqual({ note_ids: ['n2'], reason: 'few' });
    online.mockRestore();
  });
});
