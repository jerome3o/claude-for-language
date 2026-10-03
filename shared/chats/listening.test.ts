import { describe, expect, it } from 'vitest';
import {
  HIDE_ALL_SINCE,
  LISTENING_PREVIEW,
  addRevealed,
  effectiveListening,
  estimateSpeechSeconds,
  formatListeningDuration,
  listeningBars,
  listeningCandidate,
  listeningPreview,
  listeningThreshold,
  prefetchSelection,
  shouldHideMessage,
  sinceWhenTurnedOn,
  type ListeningMessage,
} from './listening';

const ME = 'me';
const THEM = 'them';
const msg = (id: string, over: Partial<ListeningMessage> = {}): ListeningMessage => ({
  id,
  sender_id: THEM,
  content: '你今天去哪儿了？',
  created_at: `2026-10-03T10:0${id.slice(-1)}:00.000Z`,
  ...over,
});

describe('listeningCandidate', () => {
  it('hides only the other person’s plain Chinese text', () => {
    expect(listeningCandidate(msg('m1'), ME)).toBe(true);
    expect(listeningCandidate(msg('m1', { sender_id: ME }), ME)).toBe(false);
    expect(listeningCandidate(msg('m1', { content: 'see you at 5' }), ME)).toBe(false);
    expect(listeningCandidate(msg('m1', { attachment_kind: 'image' }), ME)).toBe(false);
    expect(listeningCandidate(msg('m1', { attachment_kind: 'voice' }), ME)).toBe(false);
    expect(listeningCandidate(msg('m1', { deleted_at: '2026-10-03T11:00:00Z' }), ME)).toBe(false);
    expect(listeningCandidate(msg('m1', { content: 'ok 好的' }), ME)).toBe(true);
  });
});

describe('shouldHideMessage', () => {
  const on = { on: true, since: '2026-10-03T10:02:00.000Z' };
  it('hides messages after `since`, keeps older history visible', () => {
    expect(shouldHideMessage(msg('m1'), { viewerId: ME, setting: on, revealed: [] })).toBe(false);
    expect(shouldHideMessage(msg('m2'), { viewerId: ME, setting: on, revealed: [] })).toBe(false);
    expect(shouldHideMessage(msg('m3'), { viewerId: ME, setting: on, revealed: [] })).toBe(true);
  });
  it('never hides when off, revealed, or mine', () => {
    expect(shouldHideMessage(msg('m3'), { viewerId: ME, setting: { on: false, since: on.since }, revealed: [] })).toBe(false);
    expect(shouldHideMessage(msg('m3'), { viewerId: ME, setting: on, revealed: new Set(['m3']) })).toBe(false);
    expect(shouldHideMessage(msg('m3', { sender_id: ME }), { viewerId: ME, setting: on, revealed: [] })).toBe(false);
  });
  it('Hide all hides every candidate', () => {
    const all = { on: true, since: HIDE_ALL_SINCE };
    expect(shouldHideMessage(msg('m1'), { viewerId: ME, setting: all, revealed: [] })).toBe(true);
  });
  it('an undecided default-on setting hides what was unread when the chat opened', () => {
    const undecided = effectiveListening(null, true);
    expect(undecided).toEqual({ on: true, since: null });
    const ctx = { viewerId: ME, setting: undecided, readMarkerAtOpen: '2026-10-03T10:01:00.000Z', revealed: [] };
    expect(shouldHideMessage(msg('m1'), ctx)).toBe(false);
    expect(shouldHideMessage(msg('m2'), ctx)).toBe(true);
    expect(listeningThreshold(undecided, null)).toBe(HIDE_ALL_SINCE);
  });
  it('a conversation row wins over the default', () => {
    expect(effectiveListening({ on: false, since: null }, true)).toEqual({ on: false, since: null });
    expect(effectiveListening(null, false)).toEqual({ on: false, since: null });
  });
});

describe('sinceWhenTurnedOn', () => {
  it('uses the newest message on screen, else now', () => {
    expect(sinceWhenTurnedOn([msg('m1'), msg('m3'), msg('m2')], 'NOW')).toBe('2026-10-03T10:03:00.000Z');
    expect(sinceWhenTurnedOn([], '2026-10-03T12:00:00.000Z')).toBe('2026-10-03T12:00:00.000Z');
  });
});

describe('addRevealed', () => {
  it('appends once and caps', () => {
    expect(addRevealed(['a', 'b'], 'a')).toEqual(['b', 'a']);
    expect(addRevealed(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });
});

describe('listeningPreview', () => {
  const last = { id: 'm3', sender_id: THEM, created_at: '2026-10-03T10:03:00.000Z', preview: '晚上一起吃饭吗？' };
  const setting = { on: true, since: '2026-10-03T10:00:00.000Z' };
  it('spoils nothing while hidden', () => {
    expect(listeningPreview(last, { viewerId: ME, setting, revealed: [] })).toBe(LISTENING_PREVIEW);
  });
  it('shows the text once revealed, for photos, or with the mode off', () => {
    expect(listeningPreview(last, { viewerId: ME, setting, revealed: ['m3'] })).toBeNull();
    expect(listeningPreview({ ...last, attachment_kind: 'image' }, { viewerId: ME, setting, revealed: [] })).toBeNull();
    expect(listeningPreview(last, { viewerId: ME, setting: { on: false, since: null }, revealed: [] })).toBeNull();
    expect(listeningPreview(null, { viewerId: ME, setting, revealed: [] })).toBeNull();
  });
  it('an undecided setting hides only unread', () => {
    const undecided = { on: true, since: null };
    expect(listeningPreview(last, { viewerId: ME, setting: undecided, readMarker: '2026-10-03T10:03:00.000Z', revealed: [] })).toBeNull();
    expect(listeningPreview(last, { viewerId: ME, setting: undecided, readMarker: '2026-10-03T10:02:00.000Z', revealed: [] })).toBe(LISTENING_PREVIEW);
  });
});

describe('prefetchSelection', () => {
  it('takes the newest of the other person’s Chinese text messages', () => {
    const list = [msg('m1'), msg('m2', { sender_id: ME }), msg('m3', { attachment_kind: 'voice' }), msg('m4'), msg('m5', { content: 'hi' }), msg('m6')];
    expect(prefetchSelection(list, ME).map((m) => m.id)).toEqual(['m6', 'm4', 'm1']);
    expect(prefetchSelection(list, ME, 2).map((m) => m.id)).toEqual(['m6', 'm4']);
  });
});

describe('placeholder', () => {
  it('estimates a duration and formats it', () => {
    expect(estimateSpeechSeconds('你今天去哪儿了？')).toBe(2);
    expect(estimateSpeechSeconds('好')).toBe(1);
    expect(estimateSpeechSeconds('我们 meet at 5 好吗')).toBe(3);
    expect(formatListeningDuration(4)).toBe('0:04');
    expect(formatListeningDuration(75.4)).toBe('1:15');
  });
  it('bars are stable per id and within range', () => {
    const a = listeningBars('msg-1');
    expect(a).toHaveLength(24);
    expect(listeningBars('msg-1')).toEqual(a);
    expect(listeningBars('msg-2')).not.toEqual(a);
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0.25);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
