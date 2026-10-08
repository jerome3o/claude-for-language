import { describe, expect, it } from 'vitest';
import { ALBUM_LEGACY_GAP_MS, albumCounter, albumTiles, layoutBubbles, type BubbleMessage } from './bubbles';
import { albumMenu, messageMenu } from './messageMenu';

const t0 = Date.parse('2026-10-08T09:00:00.000Z');
const at = (ms: number) => new Date(t0 + ms).toISOString();
const photo = (id: string, ms: number, extra: Partial<BubbleMessage> = {}): BubbleMessage => ({
  id,
  sender_id: 'me',
  created_at: at(ms),
  attachment_kind: 'image',
  content: '',
  ...extra,
});
const shape = (l: ReturnType<typeof layoutBubbles>) => l.map((x) => [x.kind, x.messageIds.join(','), x.captionId, x.tick]);

describe('photo albums', () => {
  it('photos with one album_id are one bubble, the caption is the last one', () => {
    const msgs = [
      { id: 't', sender_id: 'me', created_at: at(0), content: 'look' },
      photo('a', 1000, { album_id: 'al1', content: 'first' }),
      photo('b', 30_000, { album_id: 'al1' }),
      photo('c', 60_000, { album_id: 'al1', content: '我们的猫' }),
      photo('d', 61_000),
    ];
    const l = layoutBubbles(msgs, 'me', null, 0);
    expect(shape(l)).toEqual([
      ['message', 't', null, 'sent'],
      ['album', 'a,b,c', 'c', 'sent'],
      ['message', 'd', null, 'sent'],
    ]);
    // The album is one bubble of the group: first / last of the group around it.
    expect(l.map((x) => [x.firstInGroup, x.lastInGroup])).toEqual([[true, false], [false, false], [false, true]]);
  });

  it('a deleted photo is hidden inside its album; a fully deleted album is one deleted bubble', () => {
    const msgs = [
      photo('a', 0, { album_id: 'x' }),
      photo('b', 100, { album_id: 'x', deleted_at: at(5000), attachment_kind: null }),
      photo('c', 200, { album_id: 'x' }),
      photo('d', 300, { album_id: 'y', deleted_at: at(5000), attachment_kind: null }),
      photo('e', 400, { album_id: 'y', deleted_at: at(5000), attachment_kind: null }),
      photo('f', 500, { album_id: 'z', deleted_at: at(5000), attachment_kind: null }),
      photo('g', 600, { album_id: 'z' }),
    ];
    expect(shape(layoutBubbles(msgs, 'me', null, 0))).toEqual([
      ['album', 'a,c', null, 'sent'],
      ['message', 'd', null, 'none'],
      // One photo left: an ordinary photo bubble.
      ['message', 'g', null, 'sent'],
    ]);
  });

  it('album ids only join the same sender, consecutively', () => {
    const msgs = [
      photo('a', 0, { album_id: 'x' }),
      photo('b', 10, { album_id: 'x', sender_id: 'them' }),
      photo('c', 20, { album_id: 'x' }),
      { id: 'v', sender_id: 'me', created_at: at(30), attachment_kind: 'voice', album_id: 'x' },
      photo('d', 40, { album_id: 'x' }),
    ];
    expect(shape(layoutBubbles(msgs, 'me', null, 0)).map((s) => s[1])).toEqual(['a', 'b', 'c', 'v', 'd']);
  });

  it('ticks: failed beats pending beats the last photo', () => {
    const base = [photo('a', 0, { album_id: 'x' }), photo('b', 10, { album_id: 'x' }), photo('c', 20, { album_id: 'x' })];
    expect(layoutBubbles(base, 'me', at(20), 0)[0].tick).toBe('read');
    expect(layoutBubbles(base, 'me', at(15), 0)[0].tick).toBe('sent');
    const pending = base.map((m, i) => (i === 2 ? { ...m, pending: 'sending' as const } : m));
    expect(layoutBubbles(pending, 'me', at(30), 0)[0].tick).toBe('pending');
    const failed = base.map((m, i) => (i === 0 ? { ...m, pending: 'failed' as const } : i === 2 ? { ...m, pending: 'sending' as const } : m));
    expect(layoutBubbles(failed, 'me', at(30), 0)[0].tick).toBe('failed');
    expect(layoutBubbles(base.map((m) => ({ ...m, sender_id: 'them' })), 'me', at(30), 0)[0].tick).toBe('none');
  });

  it('old photos without an album id group within 10 s, uncaptioned, same day', () => {
    const msgs = [
      photo('a', 0, { content: 'our trip' }),
      photo('b', ALBUM_LEGACY_GAP_MS),
      photo('c', 2 * ALBUM_LEGACY_GAP_MS + 1),
      photo('d', 2 * ALBUM_LEGACY_GAP_MS + 2, { content: 'new caption' }),
      photo('e', 2 * ALBUM_LEGACY_GAP_MS + 3),
      photo('f', 2 * ALBUM_LEGACY_GAP_MS + 4, { sender_id: 'them' }),
      photo('g', 2 * ALBUM_LEGACY_GAP_MS + 5, { pending: 'sending' }),
      photo('h', 2 * ALBUM_LEGACY_GAP_MS + 6, { pending: 'sending' }),
    ];
    expect(shape(layoutBubbles(msgs, 'me', null, 0)).map((s) => [s[0], s[1], s[2]])).toEqual([
      ['album', 'a,b', 'a'],
      ['message', 'c', null],
      ['album', 'd,e', 'd'],
      ['message', 'f', null],
      ['message', 'g', null],
      ['message', 'h', null],
    ]);
  });

  it('an old-style album never crosses midnight', () => {
    const late = Date.parse('2026-10-08T23:59:58.000Z') - t0;
    const msgs = [photo('a', late), photo('b', late + 1000), photo('c', late + 3000)];
    expect(shape(layoutBubbles(msgs, 'me', null, 0)).map((s) => s[1])).toEqual(['a,b', 'c']);
    // …at this offset all three are on one day.
    expect(shape(layoutBubbles(msgs, 'me', null, -60)).map((s) => s[1])).toEqual(['a,b,c']);
  });

  it('day pills and groups compare the album’s last photo with the next bubble', () => {
    const msgs = [
      photo('a', 0, { album_id: 'x' }),
      photo('b', 5 * 60_000, { album_id: 'x' }),
      { id: 'n', sender_id: 'me', created_at: at(5 * 60_000 + 1000), content: 'hi' },
    ];
    const l = layoutBubbles(msgs, 'me', null, 0);
    expect(l.map((x) => [x.id, x.firstInGroup, x.lastInGroup, x.newDay])).toEqual([
      ['a', true, false, true],
      ['n', false, true, false],
    ]);
  });

  it('the album menu: whole-album actions only, relabelled', () => {
    const mine = albumMenu(messageMenu({ sender_id: 'me', content: '我们的猫', attachment: { kind: 'image' } }, 'student', false, 'me'), 3);
    expect(mine.reactions).toBe(true);
    expect(mine.items.map((i) => [i.id, i.label])).toEqual([
      ['reply', 'Reply'],
      ['copy', 'Copy'],
      ['forward', 'Forward all 3'],
      ['explain', 'Explain'],
      ['save_card', 'Save as flashcard'],
      ['pin', 'Pin'],
      ['info', 'Info'],
      ['edit', 'Edit caption'],
      ['delete', 'Delete all 3'],
    ]);
    const theirs = albumMenu(messageMenu({ sender_id: 'them', content: '', attachment: { kind: 'image' } }, 'tutor', false, 'me'), 2);
    expect(theirs.items.map((i) => i.id)).toEqual(['reply', 'forward', 'pin', 'info']);
  });

  it('collage tiles and the viewer counter', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(albumTiles)).toEqual([
      { tiles: 0, more: 0 },
      { tiles: 1, more: 0 },
      { tiles: 2, more: 0 },
      { tiles: 3, more: 0 },
      { tiles: 4, more: 0 },
      { tiles: 4, more: 1 },
      { tiles: 4, more: 6 },
    ]);
    expect(albumCounter(0, 5)).toBe('1 / 5');
    expect(albumCounter(4, 5)).toBe('5 / 5');
    expect(albumCounter(9, 5)).toBe('5 / 5');
    expect(albumCounter(-1, 3)).toBe('1 / 3');
    expect(albumCounter(0, 1)).toBe('');
  });
});
