import { describe, expect, it } from 'vitest';
import { createMockD1 } from './d1-mock';
import {
  DebugReportError,
  compareStoredReports,
  readUploadBody,
  sliceDebugReport,
  storeDebugReport,
  r2KeyFor,
} from '../debug-reports';
import { DEBUG_CARD_COLUMNS, eventIdHash, type DebugReport } from '@shared/debug';
import type { Env } from '../../types';

function fakeBucket() {
  const store = new Map<string, string>();
  const deleted: string[] = [];
  return {
    store,
    deleted,
    async put(key: string, value: string) {
      store.set(key, value);
      return {};
    },
    async get(key: string) {
      const v = store.get(key);
      return v === undefined ? null : { json: async () => JSON.parse(v), text: async () => v };
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        deleted.push(k);
        store.delete(k);
      }
    },
  };
}

function report(client: 'lab' | 'web', homeTotal: number, eventIds: string[]): DebugReport {
  const now = Date.parse('2026-09-27T10:00:00Z');
  return {
    version: 1,
    client,
    app_version: 'test',
    generated_at: new Date(now).toISOString(),
    timezone: { iana: 'UTC', offset_minutes: 0 },
    now_ms: now,
    cutoff: { ms: now + 3600_000, iso: new Date(now + 3600_000).toISOString() },
    day_start: { ms: now - 36000_000, iso: '2026-09-27T00:00:00.000Z', local_date: '2026-09-27' },
    introduced_basis: 'events',
    budget: { new_cards_per_day: 3, secondary_cards_per_day: 6 },
    bonus: { all: 0, by_deck: {}, day_key: '2026-09-27' },
    sync: {},
    totals: { decks: 1, notes: 1, cards: 2, events: eventIds.length, unsynced_events: 0, pending_deletions: 0, orphan_events: 0, earliest_reviewed_at: null, latest_reviewed_at: null },
    home: { total: homeTotal, counts: { new: homeTotal, secondaryNew: 0, learning: 0, review: 0 }, extras: {} },
    queue: { due_cards: homeTotal, from_due_cards: { new: homeTotal, secondaryNew: 0, learning: 0, review: 0 }, reported: { new: homeTotal, secondaryNew: 0, learning: 0, review: 0 } },
    decks: [],
    card_columns: DEBUG_CARD_COLUMNS,
    cards: [
      ['c1', 'n1', 'd1', 'hanzi_to_meaning', 0, null, 0, 0, 0, 1, null],
      ['c2', 'n1', 'd1', 'meaning_to_hanzi', 2, now, 2, 0, eventIds.length, client === 'web' ? 1 : 0, now - 86400000],
    ],
    event_hashes: eventIds.map(eventIdHash).sort(),
  };
}

function env() {
  const DB = createMockD1();
  const bucket = fakeBucket();
  return { DB, bucket, env: { DB, AUDIO_BUCKET: bucket } as unknown as Env };
}

describe('storeDebugReport', () => {
  it('stores the JSON in R2, indexes it in D1 with a summary and prunes old reports', async () => {
    const { DB, bucket, env: e } = env();
    DB.addAllResult('LIMIT -1 OFFSET', [{ id: 'old-1', r2_key: 'debug/u1/old-1.json' }]);
    const row = await storeDebugReport(e, 'u1', { client: 'lab', app_version: '0.9', report: report('lab', 5, ['e1']) }, 100);
    expect(row.client).toBe('lab');
    expect(bucket.store.get(r2KeyFor('u1', row.id))).toContain('"client":"lab"');
    const insert = DB.getQueries().find(q => q.sql.includes('INSERT INTO debug_reports'))!;
    expect(insert.params.slice(1, 4)).toEqual(['u1', 'lab', '0.9']);
    expect(JSON.parse(insert.params[7])).toMatchObject({ home_total: 5, cards: 2, events: 1 });
    const prune = DB.getQueries().find(q => q.sql.includes('LIMIT -1 OFFSET'))!;
    expect(prune.params).toEqual(['u1', 'lab', 20]);
    expect(bucket.deleted).toEqual(['debug/u1/old-1.json']);
    expect(DB.getQueries().some(q => q.sql.includes('DELETE FROM debug_reports') && q.params[0] === 'old-1')).toBe(true);
  });

  it('refuses a bad client, a mismatched report and a malformed report', async () => {
    const { env: e } = env();
    await expect(storeDebugReport(e, 'u1', { client: 'ios', report: report('lab', 1, []) }, 10)).rejects.toThrow('client must be');
    await expect(storeDebugReport(e, 'u1', { client: 'web', report: report('lab', 1, []) }, 10)).rejects.toThrow('does not match');
    const err = await storeDebugReport(e, 'u1', { client: 'web', report: { client: 'web' } }, 10).catch(x => x);
    expect(err).toBeInstanceOf(DebugReportError);
    expect(err.problems).toContain('cards must be an array');
    await expect(storeDebugReport(e, 'u1', { client: 'web', report: report('web', 1, []) }, 17 * 1024 * 1024)).rejects.toThrow('too large');
  });
});

describe('sliceDebugReport', () => {
  const r = report('web', 3, ['e1', 'e2']);
  it('overview drops the per-card rows and hashes', () => {
    const o = sliceDebugReport(r, {});
    expect(o.section).toBe('overview');
    expect(o).not.toHaveProperty('cards');
    expect(o).toMatchObject({ card_rows: 2, event_hash_count: 2 });
  });
  it('cards pages and filters', () => {
    expect(sliceDebugReport(r, { section: 'cards', in_due_queue: '1' })).toMatchObject({ total: 2 });
    expect(sliceDebugReport(r, { section: 'cards', queue: '2' })).toMatchObject({ total: 1, cards: [expect.arrayContaining(['c2'])] });
    expect(sliceDebugReport(r, { section: 'cards', offset: 1, limit: 1 })).toMatchObject({ total: 2, offset: 1, cards: [expect.arrayContaining(['c2'])] });
    expect(sliceDebugReport(r, { section: 'cards', card_id: 'n1' })).toMatchObject({ total: 2 });
  });
  it('events pages the hashes', () => {
    expect(sliceDebugReport(r, { section: 'events', limit: 1 })).toMatchObject({ total: 2, event_hashes: [expect.any(String)] });
  });
});

describe('compareStoredReports', () => {
  it('defaults to the newest lab vs the newest web report and adds the server truth', async () => {
    const { DB, bucket, env: e } = env();
    bucket.store.set('debug/u1/L.json', JSON.stringify(report('lab', 5, ['e1'])));
    bucket.store.set('debug/u1/W.json', JSON.stringify(report('web', 6, ['e1', 'e2'])));
    DB.addResultOnce("client = ? ORDER BY created_at DESC", { id: 'L' });
    DB.addResultOnce("client = ? ORDER BY created_at DESC", { id: 'W' });
    DB.addResultOnce('FROM debug_reports WHERE id = ? AND user_id = ?', { id: 'L', client: 'lab', r2_key: 'debug/u1/L.json', summary: null, size_bytes: 1, created_at: 'x', app_version: null, install_kind: null });
    DB.addResultOnce('FROM debug_reports WHERE id = ? AND user_id = ?', { id: 'W', client: 'web', r2_key: 'debug/u1/W.json', summary: null, size_bytes: 1, created_at: 'x', app_version: null, install_kind: null });
    DB.addAllResult('FROM review_events WHERE user_id = ?', [
      { id: 'e1', card_id: 'c2', reviewed_at: '2026-09-26T09:00:00Z' },
      { id: 'e2', card_id: 'c2', reviewed_at: '2026-09-27T09:00:00Z' },
    ]);
    DB.addAllResult('JOIN decks d', [{ id: 'c1' }, { id: 'c2' }]);

    const cmp = await compareStoredReports(e, 'u1', {});
    expect(cmp.a).toMatchObject({ id: 'L', client: 'lab' });
    expect(cmp.b).toMatchObject({ id: 'W', client: 'web' });
    expect(cmp.headline['home.total']).toEqual({ a: 5, b: 6, diff: 1 });
    expect(cmp.events.server).toMatchObject({ total: 2, missing_from_a: 1, missing_from_b: 0 });
    expect(cmp.cards.listed[0]).toMatchObject({ card_id: 'c2', server_events: 2 });
  });

  it('says what is missing when there is no report to compare', async () => {
    const { env: e } = env();
    await expect(compareStoredReports(e, 'u1', {})).rejects.toThrow('Need two reports');
  });
});

describe('readUploadBody', () => {
  it('reads plain JSON and gzip-compressed JSON', async () => {
    const body = { client: 'web', report: { a: 1 } };
    const plain = await readUploadBody(new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
    expect(plain.body).toEqual(body);
    const gz = await new Response(
      new Blob([JSON.stringify(body)]).stream().pipeThrough(new CompressionStream('gzip'))
    ).arrayBuffer();
    const zipped = await readUploadBody(new Request('http://x', { method: 'POST', body: gz, headers: { 'Content-Type': 'application/gzip' } }));
    expect(zipped.body).toEqual(body);
  });
  it('rejects a body that is not JSON', async () => {
    await expect(readUploadBody(new Request('http://x', { method: 'POST', body: 'nope' }))).rejects.toThrow('not valid JSON');
  });
});
