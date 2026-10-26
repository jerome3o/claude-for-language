import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __clearFeedbackForTests } from '../services/feedback';
import { sendFeedback } from './feedback';

describe('VR feedback', () => {
  beforeEach(async () => {
    await __clearFeedbackForTests();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('goes to POST /api/feedback as platform vr, via vr, with the screenshot', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ feedback: { id: 'f1' }, created: true }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await sendFeedback({ message: '[Hard to read] the pinyin is small', kind: 'feedback', screenshot: new Blob(['x'], { type: 'image/jpeg' }), immersive: true });
    expect(out.sent).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/feedback$/);
    const form = init.body as FormData;
    const ctx = JSON.parse(String(form.get('context')));
    expect(ctx).toMatchObject({ platform: 'vr', via: 'vr', device: 'VR headset (immersive)' });
    expect(form.get('message')).toBe('[Hard to read] the pinyin is small');
    expect(form.get('screenshot')).toBeInstanceOf(File);
  });

  it('offline: kept in the outbox (queued, not lost)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const out = await sendFeedback({ message: '', kind: 'bug', screenshot: new Blob(['x'], { type: 'image/jpeg' }), immersive: false });
    expect(out.sent).toBe(false);
  });
});
