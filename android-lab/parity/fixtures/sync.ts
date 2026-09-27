/**
 * Package K (sync) golden vectors, from the web app's own TypeScript:
 *   - shared/decks/ghosts.ts  parseServerTime / findGhostDecks (decks the server no longer
 *     has without a tombstone — `live_deck_ids` on /api/sync/changes)
 * Writes sync.json into process.argv[2]; core SyncParityTest asserts the Kotlin matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { findGhostDecks, parseServerTime } from '../../../shared/decks/ghosts';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: sync <out-dir>');
mkdirSync(OUT, { recursive: true });

const times: (string | null)[] = [
  '2026-09-21 06:10:11', '2026-09-21T06:10:11Z', '2026-09-21T06:10:11.123Z', '2026-09-21T06:10:11.5Z',
  '2026-09-21T06:10:11+02:00', '2026-09-21T06:10:11-0530', '2026-09-21T06:10:11', '2026-02-29 00:00:00',
  '2024-02-29 23:59:59', '1999-12-31 23:59:59', '', null, 'nonsense', '2026-13-01 00:00:00', '2026-09-21',
];
const parse = times.map((t) => {
  const v = parseServerTime(t);
  return { input: t, ms: Number.isNaN(v) ? null : v };
});

// Seeded ghost cases around the snapshot and its 60 s margin.
let seed = 20260927;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const snapshotMs = Date.parse('2026-09-24T10:47:00.000Z');
const sql = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const ghosts = [] as unknown[];
for (let c = 0; c < 40; c++) {
  const decks = Array.from({ length: 1 + Math.floor(rand() * 8) }, (_, i) => {
    const r = rand();
    const offset = Math.floor((rand() - 0.7) * 400_000); // mostly before, some within / after the margin
    const created_at = r < 0.08 ? null : r < 0.14 ? 'garbage' : r < 0.5 ? sql(snapshotMs + offset) : new Date(snapshotMs + offset).toISOString();
    return { id: `d${c}-${i}`, created_at };
  });
  const live = decks.filter(() => rand() < 0.4).map((d) => d.id);
  const at = c % 13 === 12 ? null : c % 7 === 6 ? '2026-09-24 10:47:00' : '2026-09-24T10:47:00.000Z';
  ghosts.push({ decks, live, at, ghosts: findGhostDecks(decks, live, at) });
}
writeFileSync(join(OUT, 'sync.json'), JSON.stringify({ parse, ghosts }, null, 1));
