import { describe, it, expect } from 'vitest';
import {
  advanceCursor,
  countNewFromOthers,
  deliveredClientIds,
  firstUnreadId,
  fitImage,
  formatDuration,
  lastMessagePreview,
  mergeMessages,
  messageVersion,
  newestVersion,
  receiptFor,
  scaleToFit,
  shouldSendTyping,
} from './chatThread';

type TM = { id: string; sender_id: string; created_at: string; content?: string; updated_at?: string; client_id?: string; deleted_at?: string };
const m = (id: string, sender: string, created: string, extra: Partial<TM> = {}): TM => ({
  id,
  sender_id: sender,
  created_at: `2026-10-02T10:${created}.000Z`,
  ...extra,
});

describe('mergeMessages', () => {
  it('appends new messages and keeps the same array when nothing changed', () => {
    const a = [m('1', 'me', '00:00')];
    expect(mergeMessages(a, [])).toBe(a);
    expect(mergeMessages(a, [a[0]])).toBe(a);
    const b = mergeMessages(a, [m('2', 'you', '00:05')]);
    expect(b.map((x) => x.id)).toEqual(['1', '2']);
  });

  it('replaces by id with the newer version, ignores an older one', () => {
    const base = m('1', 'me', '00:00', { content: 'a' });
    const edited = { ...base, content: 'b', updated_at: '2026-10-02T10:01:00.000Z' };
    const merged = mergeMessages([base], [edited]);
    expect(merged[0].content).toBe('b');
    // A slow poll brings the old copy back: ignored.
    expect(mergeMessages(merged, [base])[0].content).toBe('b');
    // Equal version (optimistic local change, same updated_at) replaces.
    const local = { ...edited, content: 'c' };
    expect(mergeMessages(merged, [local])[0].content).toBe('c');
  });

  it('keeps oldest-first order when an older message arrives late', () => {
    const merged = mergeMessages([m('2', 'me', '00:05')], [m('1', 'you', '00:01'), m('3', 'you', '00:09')]);
    expect(merged.map((x) => x.id)).toEqual(['1', '2', '3']);
  });
});

describe('cursor', () => {
  it('only moves forward', () => {
    expect(advanceCursor(null, 'a')).toBe('a');
    expect(advanceCursor('b', 'a')).toBe('b');
    expect(advanceCursor('b', null)).toBe('b');
    expect(advanceCursor('b', 'c')).toBe('c');
  });
  it('uses updated_at when newer', () => {
    const x = m('1', 'me', '00:00', { updated_at: '2026-10-02T11:00:00.000Z' });
    expect(messageVersion(x)).toBe('2026-10-02T11:00:00.000Z');
    expect(newestVersion([m('2', 'me', '30:00'), x])).toBe('2026-10-02T11:00:00.000Z');
  });
});

describe('receiptFor', () => {
  const msgs = [m('1', 'you', '00:00'), m('2', 'me', '01:00'), m('3', 'me', '02:00')];
  it('Sent under my newest message until they read it, then Seen', () => {
    expect(receiptFor(msgs, 'me', null)).toEqual({ messageId: '3', kind: 'sent' });
    expect(receiptFor(msgs, 'me', '2026-10-02T10:01:00.000Z')).toEqual({ messageId: '3', kind: 'sent' });
    expect(receiptFor(msgs, 'me', '2026-10-02T10:02:00.000Z')).toEqual({ messageId: '3', kind: 'seen' });
  });
  it('nothing once they replied; deleted messages are skipped', () => {
    expect(receiptFor([...msgs, m('4', 'you', '03:00')], 'me', null)).toBeNull();
    expect(receiptFor([...msgs, m('4', 'me', '03:00', { deleted_at: 'x' })], 'me', null)).toEqual({ messageId: '3', kind: 'sent' });
    expect(receiptFor([], 'me', null)).toBeNull();
  });
});

describe('unread', () => {
  const msgs = [m('1', 'you', '00:00'), m('2', 'me', '01:00'), m('3', 'you', '02:00'), m('4', 'you', '03:00')];
  it('divider at the first message from them after my marker', () => {
    expect(firstUnreadId(msgs, 'me', '2026-10-02T10:00:00.000Z')).toBe('3');
    expect(firstUnreadId(msgs, 'me', '2026-10-02T10:03:00.000Z')).toBeNull();
    expect(firstUnreadId(msgs, 'me', null)).toBeNull();
  });
  it('counts new messages from them for the pill', () => {
    expect(countNewFromOthers(msgs, 'me', '2026-10-02T10:01:00.000Z')).toBe(2);
    expect(countNewFromOthers(msgs, 'me', null)).toBe(0);
  });
  it('delivered client ids are mine only', () => {
    const s = deliveredClientIds([m('1', 'me', '00:00', { client_id: 'a' }), m('2', 'you', '00:01', { client_id: 'b' })], 'me');
    expect([...s]).toEqual(['a']);
  });
});

describe('image sizing', () => {
  it('fits inside the box keeping the ratio, never upscales big ones', () => {
    expect(fitImage(1600, 1200, 280, 340)).toEqual({ width: 280, height: 210 });
    expect(fitImage(900, 1600, 280, 340)).toEqual({ width: 191, height: 340 });
    expect(fitImage(200, 100, 280, 340)).toEqual({ width: 200, height: 100 });
  });
  it('tiny pictures get a minimum size, missing sizes a default box', () => {
    expect(fitImage(20, 10, 280, 340)).toEqual({ width: 96, height: 48 });
    expect(fitImage(0, 0, 280, 340)).toEqual({ width: 240, height: 180 });
  });
  it('compression target: longest side 1600', () => {
    expect(scaleToFit(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(scaleToFit(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});

describe('small helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(7000)).toBe('0:07');
    expect(formatDuration(83_400)).toBe('1:23');
  });
  it('previews for the conversation list', () => {
    expect(lastMessagePreview({ content: '', attachment_kind: 'image' })).toBe('📷 Photo');
    expect(lastMessagePreview({ content: '看', attachment: '{"kind":"image"}' })).toBe('📷 看');
    expect(lastMessagePreview({ content: '', attachment: { kind: 'voice' } })).toBe('🎤 Voice message');
    expect(lastMessagePreview({ content: 'x', deleted_at: 'y' })).toBe('Message deleted');
    expect(lastMessagePreview({ content: '你好' })).toBe('你好');
    expect(lastMessagePreview(null)).toBe('');
  });
  it('typing frames are throttled and need text', () => {
    expect(shouldSendTyping('', 0, 10_000)).toBe(false);
    expect(shouldSendTyping('你', 0, 10_000)).toBe(true);
    expect(shouldSendTyping('你好', 9000, 10_000)).toBe(false);
    expect(shouldSendTyping('你好', 7500, 10_000)).toBe(true);
  });
});
