import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  __analyticsQueueForTests,
  __resetAnalyticsForTests,
  clearAnalyticsQueue,
  flushAnalytics,
  setSharingUsage,
  track,
  trackError,
  trackScreen,
} from './analytics';

let clock = Date.parse('2026-10-03T09:00:00Z');
const tick = (ms: number) => { clock += ms; };

beforeEach(async () => {
  localStorage.clear();
  __resetAnalyticsForTests(() => clock);
  await clearAnalyticsQueue();
  setSharingUsage(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const events = async () => (await __analyticsQueueForTests()).map((e) => e.event);

describe('analytics queue', () => {
  it('records catalogue events with context, and opens a session once', async () => {
    track('study.session_start', { scope: 'all', due: 24 });
    track('study.card_rated', { rating: 'good', card_type: 'hanzi_to_meaning' });
    const q = await __analyticsQueueForTests();
    expect(q.map((e) => e.event)).toEqual(['app.open', 'study.session_start', 'study.card_rated']);
    expect(new Set(q.map((e) => e.session_id)).size).toBe(1);
    expect(q[1]).toMatchObject({ platform: 'web', props: { scope: 'all', due: 24 } });
    // 31 minutes later: a new session
    tick(31 * 60 * 1000);
    track('chat.open', { is_ai: false });
    const q2 = await __analyticsQueueForTests();
    expect(q2.slice(-2).map((e) => e.event)).toEqual(['app.open', 'chat.open']);
    expect(q2[q2.length - 1].session_id).not.toBe(q[0].session_id);
  });

  it('PRIVACY: a message body, card content, an answer or an email never reaches the queue', async () => {
    track('chat.send', { kind: 'text', text: '老师我明天不能来上课', content: 'see you tomorrow', body: 'hi' });
    track('study.card_rated', { rating: 'again', answer: '你好', hanzi: '你好', email: 'minghui@example.com' });
    track('chat.menu_action', { action: 'translate this sentence please' });
    trackError('chat', new Error('Could not send 我想你'));
    const stored = JSON.stringify(await __analyticsQueueForTests());
    for (const secret of ['老师', 'see you', '"hi"', '你好', 'minghui@', 'translate this', '我想你']) {
      expect(stored).not.toContain(secret);
    }
    const q = await __analyticsQueueForTests();
    expect(q.find((e) => e.event === 'chat.send')!.props).toEqual({ kind: 'text' });
    expect(q.find((e) => e.event === 'chat.menu_action')!.props).toEqual({});
    expect(q.find((e) => e.event === 'error.shown')!.props).toEqual({ where: 'chat', status: null, code: 'Error' });
  });

  it('ignores unknown and server-only events', async () => {
    track('made.up' as never);
    track('server.ai_call' as never);
    expect(await events()).toEqual([]);
  });

  it('screen views carry the screen LEFT and the time spent on it; ids become :id', async () => {
    trackScreen('/decks/abcdef123456?x=1');
    tick(5000);
    trackScreen('/connections/3f1c2b9a-1234-4cde-9abc-0123456789ab/chat/zz99887766aa');
    tick(2000);
    trackScreen('/');
    const views = (await __analyticsQueueForTests()).filter((e) => e.event === 'app.screen_view');
    expect(views.map((v) => [v.screen, v.props.duration_ms])).toEqual([
      ['/decks/:id', 5000],
      ['/connections/:id/chat/:id', 2000],
    ]);
  });

  it('opt-out clears the queue and stops recording', async () => {
    track('chat.open', {});
    setSharingUsage(false);
    await new Promise((r) => setTimeout(r, 0));
    track('chat.open', {});
    expect(await events()).toEqual([]);
  });
});

describe('upload', () => {
  it('offline → kept; online 2xx → sent and removed; dedupe is the server\'s (same ids resent)', async () => {
    track('chat.open', { is_ai: false });
    track('chat.send', { kind: 'voice' });
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await flushAnalytics()).toEqual({ sent: 0 });
    expect(await events()).toHaveLength(3);
    const firstIds = JSON.parse(fetchMock.mock.calls[0][1].body).events.map((e: { id: string }) => e.id);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ accepted: 3, stored: 3 }), { status: 200 }));
    expect(await flushAnalytics()).toEqual({ sent: 3 });
    const secondIds = JSON.parse(fetchMock.mock.calls[1][1].body).events.map((e: { id: string }) => e.id);
    expect(secondIds).toEqual(firstIds); // the retry resends the same ids, so the server stores each once
    // Not /api/analytics/events: content blockers refuse that path (EasyPrivacy "/analytics/event").
    expect(fetchMock.mock.calls[1][0]).toContain('/api/me/usage-events');
    expect(await events()).toEqual([]);
  });

  it('a permanent 400 drops the batch; a 503 keeps it', async () => {
    track('chat.open', {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    await flushAnalytics();
    expect(await events()).toHaveLength(2);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })));
    await flushAnalytics();
    expect(await events()).toEqual([]);
  });

  it('the server saying opted_out turns sharing off', async () => {
    track('chat.open', {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ opted_out: true }), { status: 200 })));
    await flushAnalytics();
    track('chat.open', {});
    expect(await events()).toEqual([]);
  });
});
