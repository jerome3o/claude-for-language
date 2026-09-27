import { describe, expect, it } from 'vitest';
import {
  DEBUG_CARD_COLUMNS,
  EVENT_HASH_VECTORS,
  eventIdHash,
  summarizeDebugReport,
  validateDebugReport,
  type DebugCardRow,
  type DebugReport,
} from './report';
import { compareDebugReports, serverTruthFromRows } from './compare';

const NOW = Date.parse('2026-09-27T10:00:00.000Z');
const CUTOFF = Date.parse('2026-09-27T22:59:59.999Z');

function report(client: 'lab' | 'web', over: Partial<DebugReport> = {}): DebugReport {
  const base: DebugReport = {
    version: 1,
    client,
    app_version: client === 'lab' ? '0.7' : '2026-09-27T09:00:00Z',
    generated_at: new Date(NOW).toISOString(),
    timezone: { iana: 'Europe/London', offset_minutes: 60 },
    now_ms: NOW,
    cutoff: { ms: CUTOFF, iso: new Date(CUTOFF).toISOString() },
    day_start: { ms: Date.parse('2026-09-26T23:00:00.000Z'), iso: '2026-09-26T23:00:00.000Z', local_date: '2026-09-27' },
    introduced_basis: 'events',
    budget: { new_cards_per_day: 3, secondary_cards_per_day: 6 },
    bonus: { all: 0, by_deck: {}, day_key: '2026-09-27' },
    sync: {},
    totals: {
      decks: 1,
      notes: 2,
      cards: 3,
      events: 3,
      unsynced_events: 0,
      pending_deletions: 0,
      orphan_events: 0,
      earliest_reviewed_at: null,
      latest_reviewed_at: null,
    },
    home: { total: 2, counts: { new: 1, secondaryNew: 0, learning: 0, review: 1 }, extras: {} },
    queue: {
      due_cards: 2,
      from_due_cards: { new: 1, secondaryNew: 0, learning: 0, review: 1 },
      reported: { new: 1, secondaryNew: 0, learning: 0, review: 1 },
    },
    decks: [
      {
        id: 'd1',
        name: '汉语 1',
        priority: 0,
        created_at: '2026-01-01',
        caps: { primary: 3, secondary: 6 },
        introduced_today: { primary: 0, secondary: 0 },
        pools: { totalNew: 1, totalSecondaryNew: 0, learning: 0, review: 1 },
        allocation: { primary: 1, secondary: 0 },
        counts: { new: 1, secondaryNew: 0, learning: 0, review: 1 },
        note_count: 2,
        card_count: 3,
      },
    ],
    card_columns: DEBUG_CARD_COLUMNS,
    cards: [
      ['c1', 'n1', 'd1', 'hanzi_to_meaning', 2, NOW - 1000, 3, 0, 3, 1, NOW - 86400000 * 9],
      ['c2', 'n2', 'd1', 'hanzi_to_meaning', 0, null, 0, 0, 0, 1, null],
      ['c3', 'n2', 'd1', 'meaning_to_hanzi', 0, null, 0, 0, 0, 0, null],
    ],
    event_hashes: ['e1', 'e2', 'e3'].map(eventIdHash).sort(),
  };
  return { ...base, ...over };
}

describe('eventIdHash', () => {
  it('matches the shared vectors (the Kotlin port checks the same list)', () => {
    for (const [input, hash] of EVENT_HASH_VECTORS) expect(eventIdHash(input)).toBe(hash);
  });
});

describe('validateDebugReport / summarizeDebugReport', () => {
  it('accepts a well-formed report and summarises it', () => {
    const r = report('lab');
    expect(validateDebugReport(r)).toEqual([]);
    expect(summarizeDebugReport(r)).toMatchObject({ home_total: 2, cards: 3, events: 3, queue_due_cards: 2 });
  });
  it('lists what is wrong with a broken one', () => {
    expect(validateDebugReport({ client: 'ios' })).toEqual(
      expect.arrayContaining(['client must be "lab" or "web"', 'cards must be an array'])
    );
    expect(validateDebugReport(null)).toEqual(['report must be an object']);
  });
});

describe('compareDebugReports', () => {
  it('finds nothing between identical reports', () => {
    const cmp = compareDebugReports(report('lab'), report('web'));
    expect(cmp.cards.differing).toBe(0);
    expect(cmp.decks.differing).toEqual([]);
    expect(cmp.events.only_a.count).toBe(0);
    expect(cmp.hints).toEqual(['No differences found.']);
    expect(cmp.headline['home.total']).toEqual({ a: 2, b: 2, diff: 0 });
  });

  it('explains a home total difference: extras, learning after cutoff, one-sided events with server truth', () => {
    const lab = report('lab');
    // Web: one extra event on c1 (e4, on the server — the lab never downloaded it),
    // which made c1 a learning card due tomorrow; web counts it and a due reader.
    const webCards: DebugCardRow[] = [
      ['c1', 'n1', 'd1', 'hanzi_to_meaning', 3, CUTOFF + 3600_000, 3, 1, 4, 0, NOW - 86400000 * 9],
      lab.cards[1],
      lab.cards[2],
    ];
    const web = report('web', {
      cards: webCards,
      event_hashes: ['e1', 'e2', 'e3', 'e4'].map(eventIdHash).sort(),
      home: { total: 3, counts: { new: 1, secondaryNew: 0, learning: 1, review: 0 }, extras: { readers: 1 } },
      queue: {
        due_cards: 1,
        from_due_cards: { new: 1, secondaryNew: 0, learning: 0, review: 0 },
        reported: { new: 1, secondaryNew: 0, learning: 1, review: 0 },
      },
    });
    const server = serverTruthFromRows(
      ['e1', 'e2', 'e3', 'e4'].map((id, i) => ({ id, card_id: 'c1', reviewed_at: `2026-09-2${i}T08:00:00.000Z` })),
      ['c1', 'c2', 'c3']
    );
    const cmp = compareDebugReports(lab, web, { server, ids: { a: 'r-lab', b: 'r-web' } });

    expect(cmp.a).toMatchObject({ id: 'r-lab', client: 'lab' });
    expect(cmp.headline['home.total']).toEqual({ a: 2, b: 3, diff: 1 });
    expect(cmp.headline['home.extras.readers']).toEqual({ a: 0, b: 1, diff: 1 });
    expect(cmp.headline['cards.learning_due_after_cutoff']).toEqual({ a: 0, b: 1, diff: 1 });
    expect(cmp.cards.differing).toBe(1);
    expect(cmp.cards.in_due_queue_only_a).toBe(1);
    expect(cmp.cards.queue_changes).toEqual({ '2→3': 1 });
    expect(cmp.cards.listed[0]).toMatchObject({ card_id: 'c1', deck_name: '汉语 1', server_events: 4 });
    expect(cmp.cards.listed[0].differs).toEqual(expect.arrayContaining(['queue', 'events', 'in_due_queue']));
    expect(cmp.events.only_b).toMatchObject({ count: 1, on_server: 1, not_on_server: 0 });
    expect(cmp.events.only_b.sample[0]).toMatchObject({ id: 'e4', card_id: 'c1', on_server: true });
    expect(cmp.events.server).toMatchObject({ total: 4, missing_from_a: 1, missing_from_b: 0, sample_missing_from_a: ['e4'] });

    const hints = cmp.hints.join('\n');
    expect(hints).toContain('Home total LAB 2 vs WEB 3');
    expect(hints).toContain("WEB's home total includes non-card items: readers 1");
    expect(hints).toContain("WEB's home shows 1 learning but its study queue holds 0 learning cards (1 learning cards are due after the cutoff)");
    expect(hints).toContain('LAB is missing 1 review event(s) the server has');
  });

  it('reports decks / cards on one side, deck field differences, counter drift and unuploaded events', () => {
    const lab = report('lab', {
      event_hashes: ['e1', 'e2', 'e3', 'local-only'].map(eventIdHash).sort(),
    });
    const webDeck = {
      ...lab.decks[0],
      introduced_today: { primary: 2, secondary: 0 },
      introduced_today_from_events: { primary: 0, secondary: 0 },
      allocation: { primary: 0, secondary: 0 },
    };
    const web = report('web', {
      decks: [webDeck, { ...lab.decks[0], id: 'd2', name: 'Extra' }],
      cards: [...lab.cards, ['c9', 'n9', 'd2', 'hanzi_to_meaning', 0, null, 0, 0, 0, 1, null]],
      generated_at: new Date(NOW + 90 * 60000).toISOString(),
    });
    const cmp = compareDebugReports(lab, web, { server: serverTruthFromRows([{ id: 'e1', card_id: 'c1', reviewed_at: 'x' }, { id: 'e2', card_id: 'c1', reviewed_at: 'x' }, { id: 'e3', card_id: 'c1', reviewed_at: 'x' }]) });
    expect(cmp.decks.only_b).toEqual([{ id: 'd2', name: 'Extra' }]);
    expect(cmp.decks.differing[0].fields.introduced_today).toEqual({ a: '0+0', b: '2+0' });
    expect(cmp.cards.only_b).toMatchObject({ count: 1, in_due_queue: 1, sample: ['c9'] });
    expect(cmp.events.only_a).toMatchObject({ count: 1, on_server: 0, not_on_server: 1 });
    const hints = cmp.hints.join('\n');
    expect(hints).toContain('90 min apart');
    expect(hints).toContain('"Introduced today" differs in 1 deck(s)');
    expect(hints).toContain("WEB's introduced-today counter disagrees with its own review events");
    expect(hints).toContain('LAB holds 1 event(s) the server does not have');
  });

  it('flags same events but different state, and caps the listed cards', () => {
    const lab = report('lab');
    const web = report('web', {
      cards: lab.cards.map(c => (c[0] === 'c1' ? ([...c.slice(0, 5), NOW + 5, ...c.slice(6)] as DebugCardRow) : c)),
    });
    const cmp = compareDebugReports(lab, web, { maxCards: 0 });
    expect(cmp.cards.differing).toBe(1);
    expect(cmp.cards.listed).toEqual([]);
    expect(cmp.cards.same_events_different_state).toBe(1);
    expect(cmp.hints.join('\n')).toContain('SAME number of events');
  });

  it('puts homework in the headline and says when only one side reports it', () => {
    const lab = report('lab');
    const web = report('web', { homework: { todo: 2, overdue: 1, due_today: 1, done: 3 } });
    const cmp = compareDebugReports(lab, web);
    expect(cmp.headline['homework.todo']).toEqual({ a: 0, b: 2, diff: 2 });
    expect(cmp.headline['homework.overdue']).toEqual({ a: 0, b: 1, diff: 1 });
    expect(cmp.hints.join('\n')).toContain('WEB shows 2 homework item(s) to do; LAB does not report homework');
    expect('homework.todo' in compareDebugReports(lab, report('web')).headline).toBe(false);
  });
});
