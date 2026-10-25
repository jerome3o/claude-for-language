import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __clearFeedbackForTests, feedbackContext, flushFeedback, pendingFeedbackCount, queueFeedback, shakeBlockedOn } from './feedback';

const ok = () => new Response(JSON.stringify({ feedback: { id: 'fb' }, created: true }), { status: 201 });

describe('the feedback outbox', () => {
  beforeEach(async () => {
    await __clearFeedbackForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends at once when online, as multipart with the client id', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const out = await queueFeedback({ message: ' The ⋯ menu covers the card ', kind: 'bug', context: { platform: 'web', screen: '/study' }, screenshot: new Blob(['x'], { type: 'image/jpeg' }) });
    expect(out.sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/feedback$/);
    const form = init.body as FormData;
    expect(form.get('message')).toBe('The ⋯ menu covers the card');
    expect(form.get('kind')).toBe('bug');
    expect(form.get('client_id')).toBe(out.client_id);
    expect(JSON.parse(String(form.get('context')))).toEqual({ platform: 'web', screen: '/study' });
    expect((form.get('screenshot') as File).name).toBe('screenshot.jpg');
    expect(await pendingFeedbackCount()).toBe(0);
  });

  it('keeps it when offline and sends the same item later', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const out = await queueFeedback({ message: 'Offline on the train', kind: 'feedback', context: {} });
    expect(out.sent).toBe(false);
    expect(await pendingFeedbackCount()).toBe(1);
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const flushed = await flushFeedback();
    expect(flushed.sentIds).toEqual([out.client_id]);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body instanceof FormData).toBe(true);
    expect(await pendingFeedbackCount()).toBe(0);
  });

  it('a refused item stops being retried; a busy server keeps it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'busy' }), { status: 429 })));
    await queueFeedback({ message: 'a', kind: 'feedback', context: {} });
    expect(await pendingFeedbackCount()).toBe(1);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Write a message' }), { status: 400 })));
    await flushFeedback();
    expect(await pendingFeedbackCount()).toBe(0);
  });
});

describe('feedbackContext', () => {
  it('carries diagnostics only, with the route pattern', () => {
    const ctx = feedbackContext('menu', '/decks/d-12?q=银行');
    expect(ctx.platform).toBe('web');
    expect(ctx.screen).toBe('/decks/:id');
    expect(ctx.via).toBe('menu');
    expect(JSON.stringify(ctx)).not.toContain('银行');
  });

  it('a shake never opens the sheet in a call', () => {
    expect(shakeBlockedOn('/calls/abc')).toBe(true);
    expect(shakeBlockedOn('/study')).toBe(false);
  });
});
