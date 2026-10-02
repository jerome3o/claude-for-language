import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../api/chat', () => ({
  sendChatText: vi.fn(),
  sendChatMedia: vi.fn(),
}));

import { sendChatText } from '../api/chat';
import {
  __resetOutboxForTests,
  enqueueOutbox,
  flushOutbox,
  isPermanentFailure,
  listOutbox,
  MAX_ATTEMPTS,
  onOutboxDelivered,
  outboxDue,
  outboxReduce,
  retryOutbox,
  type OutboxEntry,
} from './chatOutbox';

const mockText = vi.mocked(sendChatText);

const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  client_id: 'c1',
  conversation_id: 'conv',
  kind: 'text',
  content: '你好',
  created_at: '2026-10-02T10:00:00.000Z',
  status: 'pending',
  attempts: 0,
  ...over,
});

describe('outboxReduce', () => {
  it('pending → sending → removed on success', () => {
    const s = outboxReduce(entry(), { type: 'start' })!;
    expect(s.status).toBe('sending');
    expect(outboxReduce(s, { type: 'ok' })).toBeNull();
  });

  it('network / 5xx / 429 errors go back to pending with a backoff', () => {
    for (const status of [undefined, 500, 503, 429, 408]) {
      const e = outboxReduce(entry({ status: 'sending' }), { type: 'error', status, now: 1000 })!;
      expect(e.status).toBe('pending');
      expect(e.attempts).toBe(1);
      expect(e.next_attempt_at).toBeGreaterThan(1000);
    }
  });

  it('other 4xx fail at once; too many attempts fail too', () => {
    expect(outboxReduce(entry({ status: 'sending' }), { type: 'error', status: 413, now: 0 })!.status).toBe('failed');
    expect(outboxReduce(entry({ status: 'sending', attempts: MAX_ATTEMPTS - 1 }), { type: 'error', now: 0 })!.status).toBe('failed');
    expect(isPermanentFailure(403)).toBe(true);
    expect(isPermanentFailure(429)).toBe(false);
    expect(isPermanentFailure(undefined)).toBe(false);
  });

  it('retry resets a failed entry; reset brings back a stuck sending one', () => {
    const r = outboxReduce(entry({ status: 'failed', attempts: 6, error: 'x' }), { type: 'retry' })!;
    expect(r).toMatchObject({ status: 'pending', attempts: 0, error: null });
    expect(outboxReduce(entry({ status: 'sending' }), { type: 'reset' })!.status).toBe('pending');
    expect(outboxReduce(entry(), { type: 'retry' })!.status).toBe('pending');
  });

  it('due: pending and past its backoff, or forced', () => {
    expect(outboxDue(entry({ next_attempt_at: 5000 }), 4000)).toBe(false);
    expect(outboxDue(entry({ next_attempt_at: 5000 }), 4000, true)).toBe(true);
    expect(outboxDue(entry({ next_attempt_at: 5000 }), 6000)).toBe(true);
    expect(outboxDue(entry({ status: 'failed' }), 6000, true)).toBe(false);
  });
});

describe('flushOutbox', () => {
  beforeEach(async () => {
    await __resetOutboxForTests();
    mockText.mockReset();
  });

  it('sends with the client id, removes the entry and reports the server message', async () => {
    mockText.mockImplementation(async (_c, input) => ({ id: 'srv1', client_id: input.client_id }) as never);
    const delivered: string[] = [];
    const off = onOutboxDelivered((m) => delivered.push(m.id));
    const e = await enqueueOutbox({ conversation_id: 'conv', kind: 'text', content: '你好' });
    await flushOutbox({ force: true });
    off();
    expect(mockText).toHaveBeenCalledWith('conv', expect.objectContaining({ content: '你好', client_id: e.client_id }));
    expect(delivered).toEqual(['srv1']);
    expect(await listOutbox('conv')).toEqual([]);
  });

  it('a permanent failure stays as failed until retried', async () => {
    mockText.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    const e = await enqueueOutbox({ conversation_id: 'conv', kind: 'text', content: 'x' });
    await flushOutbox({ force: true });
    let rows = await listOutbox('conv');
    expect(rows[0]).toMatchObject({ client_id: e.client_id, status: 'failed', error: 'Forbidden' });
    mockText.mockResolvedValue({ id: 'srv2' } as never);
    await retryOutbox(e.client_id);
    await flushOutbox({ force: true });
    rows = await listOutbox('conv');
    expect(rows).toEqual([]);
  });

  it('a network failure keeps later messages of the chat waiting (order kept)', async () => {
    mockText.mockRejectedValue(new TypeError('Failed to fetch'));
    await enqueueOutbox({ conversation_id: 'conv', kind: 'text', content: 'first' });
    await enqueueOutbox({ conversation_id: 'conv', kind: 'text', content: 'second' });
    await flushOutbox({ force: true });
    const sent = mockText.mock.calls.map((c) => c[1].content);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((c) => c === 'first')).toBe(true);
    const rows = await listOutbox('conv');
    expect(rows.map((r) => [r.content, r.status])).toEqual([
      ['first', 'pending'],
      ['second', 'pending'],
    ]);
  });
});
