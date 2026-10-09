/**
 * Golden vectors for chat photo albums (docs/CHAT.md "Photo albums"): layoutBubbles over threads
 * full of photos — album ids (with deleted / pending / failed members, other senders and kinds
 * in between), old photos grouped by the 10 s rule (captions, midnight, gaps around the limit,
 * garbage times) — plus albumTiles / albumCounter.
 * Writes chat-albums.json; checked by core/…/ChatAlbumsParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ALBUM_LEGACY_GAP_MS, ALBUM_MAX_PHOTOS, GROUP_GAP_MS, albumCounter, albumTiles, layoutBubbles, type BubbleMessage } from '../../../shared/chats/bubbles';
import { albumMenu, messageMenu, type MenuMessage } from '../../../shared/chats/messageMenu';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

// mulberry32
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261008);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const MIN = 60_000;
const offsets = [0, 60, -300, 480, 330, -720, 840];
const kinds = ['image', 'image', 'image', 'image', null, 'voice', 'file', 'video', ''];
const captions = ['', '', '', '  ', '我们的猫', 'look!', '\n', '　'];
const albumIds = ['al-1', 'al-2', 'al-3', '', null];
const layouts: unknown[] = [];
for (let s = 0; s < 300; s++) {
  let t = Date.UTC(2026, int(0, 11), int(1, 28), pick([0, 23, int(0, 23)]), int(0, 59), int(0, 59)) + int(0, 999);
  const n = int(1, 16);
  const msgs: BubbleMessage[] = [];
  const senders = pick([['me', 'them'], ['me'], ['them']]);
  let sender = pick(senders);
  let album = pick(albumIds);
  for (let i = 0; i < n; i++) {
    const gap = pick([0, 1, 500, 1000, ALBUM_LEGACY_GAP_MS - 1, ALBUM_LEGACY_GAP_MS, ALBUM_LEGACY_GAP_MS + 1, 30_000, GROUP_GAP_MS, GROUP_GAP_MS + 1, 10 * MIN, 24 * 60 * MIN, -1000]);
    t += gap;
    if (rand() < 0.2) sender = pick(senders);
    if (rand() < 0.3) album = pick(albumIds);
    const m: BubbleMessage = { id: `m${s}-${i}`, sender_id: sender, created_at: new Date(t).toISOString() };
    const kind = pick(kinds);
    if (kind !== null) m.attachment_kind = kind;
    const caption = pick(captions);
    if (caption || rand() < 0.5) m.content = caption;
    if (album !== null && rand() < 0.8) m.album_id = album;
    const r = rand();
    if (r < 0.1) {
      // A deleted photo: no attachment any more (the server clears it).
      m.deleted_at = new Date(t + MIN).toISOString();
      m.attachment_kind = null;
      m.content = '';
    } else if (r < 0.15) m.pending = 'sending';
    else if (r < 0.18) m.pending = 'failed';
    else if (r < 0.2) m.created_at = pick(['not a date', '', '2026-10-01 10:00:00', `${new Date(t).toISOString().slice(0, 19)}+08:00`]);
    msgs.push(m);
  }
  const readAt = pick([null, '', msgs[int(0, msgs.length - 1)].created_at, new Date(t + MIN).toISOString(), new Date(t - 2 * MIN).toISOString()]);
  const offset = pick(offsets);
  layouts.push({ messages: msgs, viewer: 'me', readAt, offset, result: layoutBubbles(msgs, 'me', readAt, offset) });
}

// Hand-written threads: the cases the rules were written for.
const at = (ms: number) => new Date(Date.UTC(2026, 9, 8, 9) + ms).toISOString();
const photo = (id: string, ms: number, extra: Partial<BubbleMessage> = {}): BubbleMessage => ({ id, sender_id: 'me', created_at: at(ms), attachment_kind: 'image', content: '', ...extra });
const named = [
  [photo('a', 0, { album_id: 'x' }), photo('b', 10, { album_id: 'x' }), photo('c', 20, { album_id: 'x', content: '猫' })],
  [photo('a', 0, { album_id: 'x' }), photo('b', 10, { album_id: 'x', deleted_at: at(99), attachment_kind: null }), photo('c', 20, { album_id: 'x' })],
  [photo('a', 0, { album_id: 'x', deleted_at: at(99), attachment_kind: null }), photo('b', 10, { album_id: 'x', deleted_at: at(99), attachment_kind: null })],
  [photo('a', 0, { content: 'trip' }), photo('b', ALBUM_LEGACY_GAP_MS), photo('c', 2 * ALBUM_LEGACY_GAP_MS), photo('d', 3 * ALBUM_LEGACY_GAP_MS + 1)],
  [photo('a', 0), photo('b', 1, { content: 'second' }), photo('c', 2)],
  [photo('a', 0, { album_id: 'x', pending: 'sending' }), photo('b', 1, { album_id: 'x', pending: 'failed' }), photo('c', 2, { album_id: 'x' })],
  [photo('a', 0, { sender_id: 'them', album_id: 'x' }), photo('b', 1, { sender_id: 'them', album_id: 'x' }), photo('c', 2, { album_id: 'x' })],
];
for (const msgs of named) for (const offset of [0, 600]) layouts.push({ messages: msgs, viewer: 'me', readAt: at(10), offset, result: layoutBubbles(msgs, 'me', at(10), offset) });

const tiles = [-1, 0, 1, 2, 3, 4, 5, 6, 9, 10, 25].map((count) => ({ count, result: albumTiles(count) }));
const counters: unknown[] = [];
for (const count of [0, 1, 2, 3, 5, 10]) for (const index of [-2, -1, 0, 1, 2, 4, 9, 12]) counters.push({ index, count, text: albumCounter(index, count) });

// The album bubble's menu: albumMenu(messageMenu(the album's photo)).
const albumMenus: unknown[] = [];
for (const content of ['', '我们的猫', 'look!', '  '])
  for (const mine of [true, false])
    for (const role of ['student', 'tutor'] as const)
      for (const ai of [false, true])
        for (const pinned of [null, '2026-10-08T09:00:00.000Z'])
          for (const count of [2, 3, 7]) {
            const message: MenuMessage = { sender_id: mine ? 'me' : 'them', content, attachment: { kind: 'image' }, pinned_at: pinned };
            albumMenus.push({ message, role, ai, count, result: albumMenu(messageMenu(message, role, ai, 'me'), count) });
          }

writeFileSync(
  join(OUT, 'chat-albums.json'),
  JSON.stringify({ legacyGapMs: ALBUM_LEGACY_GAP_MS, maxPhotos: ALBUM_MAX_PHOTOS, layouts, tiles, counters, albumMenus }),
);
