/**
 * Golden vectors for the Kotlin port of shared/phone (android-lab/core/…/phone/): 📱 Phone practice.
 *
 * Writes:
 * - phone-scenarios.json — the bundled scenarios exactly as the Lab app ships them
 *   (core/src/main/resources/phone/scenarios.json must equal it byte for byte);
 * - phone.json — validateScenarioSpec over every bundled spec and ~130 broken variants, the
 *   matchers and conditions, the golden play-throughs of every scenario (the web's phone.test.ts
 *   event logs, built with the same record builders the apps use) with completion / checklist /
 *   mistakes / hints / result, and every per-app rule (rail search, seats, 退票, 改签, passenger
 *   checks; ride prices, POIs, coupons; food 规格, carts, 满减 / 红包 totals; movie seat rules;
 *   dine queue + booking; wallet balances, pay password, amount pad; dates; world helpers;
 *   persona request side) over seeded inputs.
 * Checked by core/…/phone/PhoneParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUNDLED_SCENARIOS,
  bundledScenario,
  checkCondition,
  durationBucket,
  formatDuration,
  goalStates,
  isComplete,
  matches,
  mistakesMade,
  nextHintIndex,
  phoneClock,
  recordsFrom,
  scenarioResult,
  seedEvents,
  slipCount,
  snapshot,
  validateScenarioSpec,
  smsCode,
  ZH,
  RIDE_CAR_TYPES,
  type GoalCondition,
  type Matcher,
  type PhoneEvent,
  type ScenarioSpec,
} from '../../../shared/phone';
import * as rail from '../../../shared/phone/rail';
import * as ride from '../../../shared/phone/ride';
import * as food from '../../../shared/phone/food';
import * as movie from '../../../shared/phone/movie';
import * as dine from '../../../shared/phone/dine';
import * as wallet from '../../../shared/phone/wallet';
import * as dates from '../../../shared/phone/dates';
import * as world from '../../../shared/phone/world';
import { fakePersonaReply, trimPersonaMessages } from '../../../shared/phone/persona';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

// The scenarios as shipped (byte-for-byte resource check).
writeFileSync(join(OUT, 'phone-scenarios.json'), JSON.stringify(BUNDLED_SCENARIOS, null, 1) + '\n');

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(20261026);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(R() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(R() * (hi - lo + 1));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const sc = (id: string): ScenarioSpec => bundledScenario(id)!;

let at = 1000;
const rec = (record: string, id: string, data: Record<string, unknown>): PhoneEvent => ({ type: 'record', record, id, data, at: at++ });
const ev = (type: string, extra: Record<string, unknown> = {}): PhoneEvent => ({ type, at: at++, ...extra });

const out: Record<string, unknown> = {};

// ---------------------------------------------------------------------------
// validateScenarioSpec
// ---------------------------------------------------------------------------

type Mut = (s: any) => boolean | void;
const deep = (n: number): GoalCondition => (n === 0 ? { kind: 'record', record: 'payment' } : { kind: 'not', condition: deep(n - 1) });
const MUTATIONS: Array<[string, Mut]> = [
  ['id upper', (s) => void (s.id = 'Bad Id')],
  ['id empty', (s) => void (s.id = '')],
  ['id number', (s) => void (s.id = 5)],
  ['id newline', (s) => void (s.id = 'abc\n')],
  ['version 2', (s) => void (s.version = 2)],
  ['version string', (s) => void (s.version = '1')],
  ['title missing', (s) => void delete s.title],
  ['title no zh', (s) => void (s.title = { en: 'x' })],
  ['title latin zh', (s) => void (s.title = { en: 'x', zh: 'abc' })],
  ['title blank en', (s) => void (s.title = { en: '   ', zh: '好' })],
  ['difficulty', (s) => void (s.difficulty = 'expert')],
  ['apps empty', (s) => void (s.apps = [])],
  ['apps unknown', (s) => void (s.apps = [...s.apps, 'tv', 7])],
  ['apps string', (s) => void (s.apps = 'rail')],
  ['situation empty', (s) => void (s.situation = '')],
  ['situation long', (s) => void (s.situation = 'x'.repeat(601))],
  ['goal null', (s) => void (s.goal = null)],
  ['facts string', (s) => void (s.facts = 'x')],
  ['facts latin', (s) => void (s.facts = [{ en: 'a', zh: 'b' }, 3])],
  ['today feb30', (s) => void (s.today = '2026-02-30')],
  ['today year50', (s) => void (s.today = '0050-01-01')],
  ['now 24', (s) => void (s.now = '24:00')],
  ['now 9', (s) => void (s.now = '9:00')],
  ['profile missing', (s) => void delete s.profile],
  ['profile phone', (s) => void (s.profile.phone = '23916582047')],
  ['profile name', (s) => void (s.profile.name = '')],
  ['profile nationality long', (s) => void (s.profile.nationality = 'x'.repeat(21))],
  ['wallet missing', (s) => void (s.wallet = 4)],
  ['wallet balance', (s) => void (s.wallet.balance = -1)],
  ['wallet cards string', (s) => void (s.wallet.cards = 'x')],
  ['wallet card bad', (s) => void (s.wallet.cards = [{ id: 'c' }, { id: 'c2', bank: '银行', last4: 6215, balance: 1 }, { id: 'c3', bank: '银行', last4: '62155', balance: 1 }])],
  ['wallet pw 5', (s) => void (s.wallet.pay_password = '12345')],
  ['wallet pw number', (s) => void (s.wallet.pay_password = 123456)],
  ['world null', (s) => void (s.world = null)],
  ['world first app', (s) => {
    const a = s.apps.find((x: string) => x !== 'wallet' && x !== 'sms');
    if (!a) return false;
    delete s.world[a];
  }],
  ['personas string', (s) => void (s.personas = 'x')],
  ['personas seven', (s) => void (s.personas = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: '人', role: 'r', personality: 'p', knows: 'k' })))],
  ['persona dup + bad', (s) => {
    s.personas = [
      { id: 'a', name: '人', role: 'r', personality: 'p', knows: 'k', opening: 'hello', actions: [{ name: 'Bad Name' }, 5, { name: 'ok_one', description: 'd', params: 'x' }], fake_action: { name: 'nope' } },
      { id: 'a', name: '', role: '', personality: '', knows: '', actions: 'x', fake_action: 'z' },
      'str',
      { id: 'Up', name: 'x'.repeat(41), role: 'r', personality: 'p', knows: 'k'.repeat(1501), opening: '好'.repeat(201) },
    ];
  }],
  ['rail stations one', (s) => (s.world.rail ? void (s.world.rail.stations = [s.world.rail.stations[0]]) : false)],
  ['rail station bad', (s) => (s.world.rail ? void (s.world.rail.stations[1] = { name: '站' }) : false)],
  ['rail trains', (s) => {
    if (!s.world.rail || s.world.rail.trains.length < 7) return false;
    const t = s.world.rail.trains;
    t[0].from = '火星站';
    t[1].to = t[1].from;
    t[2].no = 'X1';
    t[3].date = '2026-13-01';
    t[4].seats = [];
    if (t[5]) t[5].seats = [{ class: '站票', price: 0, left: -1 }, 'x'];
    t.push(clone(t[6] ?? t[0]));
    t.push(5);
    t.push({});
  }],
  ['rail trains empty', (s) => (s.world.rail ? void (s.world.rail.trains = []) : false)],
  ['rail trains many', (s) => (s.world.rail ? void (s.world.rail.trains = Array.from({ length: 81 }, (_, i) => ({ ...s.world.rail.trains[0], no: `G${i + 1}` }))) : false)],
  ['rail passengers', (s) => (s.world.rail ? void (s.world.rail.passengers = [{ id: 'x', name: 'A', id_type: '驾照', id_no: '1' }, 'z']) : false)],
  ['rail passengers string', (s) => (s.world.rail ? void (s.world.rail.passengers = 'x') : false)],
  ['rail orders', (s) => {
    if (!s.world.rail) return false;
    s.world.rail.orders = [
      { id: 'o1', train_no: 'G0', date: '2026-10-30', seat_class: '二等座', passengers: ['nobody'], seats: [], price_each: 0 },
      { id: '' },
      { id: 'o3', train_no: s.world.rail.trains[0].no, date: s.world.rail.trains[0].date, passengers: 'ab', seats: ['1', '2'], price_each: 10 },
    ];
  }],
  ['ride start', (s) => (s.world.ride ? void delete s.world.ride.start : false)],
  ['ride pois', (s) => (s.world.ride ? void (s.world.ride.pois = [{ id: 'p', name: '点', address: '路', km: 0 }, 3]) : false)],
  ['ride pois empty', (s) => (s.world.ride ? void (s.world.ride.pois = []) : false)],
  ['ride cars', (s) => (s.world.ride ? void (s.world.ride.cars = [{ type: '飞机', base: 1, per_km: 1, eta_min: 1 }]) : false)],
  ['ride driver', (s) => (s.world.ride ? void (s.world.ride.driver = { name: '王', car: '车' }) : false)],
  ['ride personas', (s) => {
    if (!s.world.ride) return false;
    s.world.ride.driver.persona = 'ghost';
    s.world.ride.arrival_persona = 7;
    s.world.ride.trips = [{ id: 't', date: 'x', from: 'a', to: 'b' }, { id: 't2', date: '2026-10-01', from: 'a', to: 'b', driver: { persona: 'ghost2' } }];
  }],
  ['food shops', (s) => {
    if (!s.world.food) return false;
    const sh = s.world.food.shops[0];
    sh.rating = 6;
    delete sh.min_order;
    sh.persona = 'ghost';
    sh.menu[0].items[0].price = 0;
    sh.menu[0].items.push({ id: 'x', name: '菜', price: 1, options: [{ name: '辣度', choices: [] }, 'z'] });
    sh.menu.push({ category: '空', items: [] });
    s.world.food.shops.push('junk');
    s.world.food.shops.push({ id: 's9', name: '店', rating: 'x', menu: [] });
  }],
  ['food many', (s) => (s.world.food ? void (s.world.food.shops = Array.from({ length: 21 }, (_, i) => ({ ...s.world.food.shops[0], id: `s${i}` }))) : false)],
  ['food addresses', (s) => {
    if (!s.world.food) return false;
    delete s.world.food.addresses;
    s.world.food.rider_persona = 'ghost';
  }],
  ['movie', (s) => {
    if (!s.world.movie || s.world.movie.shows.length < 5) return false;
    s.world.movie.films[0].minutes = 10;
    s.world.movie.shows[0].film = 'nofilm';
    s.world.movie.shows[1].cinema = 'nocinema';
    s.world.movie.shows[2].date = 'x';
    s.world.movie.shows[2].price = 0;
    s.world.movie.shows[3].seats = { rows: 21, cols: 5 };
    s.world.movie.shows[4].seats.sold = ['9-99', '1_2', 5];
    s.world.movie.shows.push({ id: '' });
  }],
  ['movie empty', (s) => (s.world.movie ? void (s.world.movie = { city: '上海', films: [], cinemas: [], shows: [] }) : false)],
  ['movie film no id', (s) => {
    if (!s.world.movie) return false;
    delete s.world.movie.films[0].id;
    delete s.world.movie.shows[0].film;
  }],
  ['dine', (s) => {
    if (!s.world.dine) return false;
    const r = s.world.dine.restaurants[0];
    r.queue = [{ id: 'A', name: '小', min: 4, max: 2, waiting: 1, minutes: 1 }, { id: 'TOOLONG', min: 1, max: 1 }];
    r.booking = { dates: ['2026-10-31', 'x'], times: ['25:00'], max_people: 0 };
    r.persona = 'ghost';
    s.world.dine.restaurants.push({ id: 'r2', name: '店', rating: 'x' });
  }],
  ['dine empty', (s) => (s.world.dine ? void (s.world.dine.restaurants = []) : false)],
  ['chat', (s) => {
    if (!s.world.chat) return false;
    delete s.world.chat.me;
    s.world.chat.contacts.push({ id: 'z', name: '某', persona: 'ghost' }, { id: '' });
    s.world.chat.threads.push({ contact: 'nobody', messages: [] }, null);
    s.world.chat.qr_codes = [{ id: 'q', payee: '人', label: 'x', kind: 'link' }];
  }],
  ['goals empty', (s) => void (s.goals = [])],
  ['goals optional', (s) => void (s.goals = s.goals.map((g: any) => ({ ...g, optional: true })))],
  ['goals many', (s) => void (s.goals = Array.from({ length: 13 }, (_, i) => ({ ...s.goals[0], id: `g${i}` })))],
  ['goals bad', (s) => {
    s.goals.push(
      { ...s.goals[0] },
      { id: 'k', label: { en: 'x', zh: '好' }, condition: { kind: 'maybe' } },
      { id: 'r', label: { en: 'x', zh: '好' }, condition: { kind: 'record', record: 'rocket_order', where: 'x' } },
      { id: 'e', label: { en: 'x', zh: '好' }, condition: { kind: 'event', event: 'boom', where: { a: { bogus: 1, in: 'x', nin: 3, has_all: {} }, b: {}, c: [1], d: { every: { some: [2] }, match: { x: { foo: 1 } } } } } },
      { id: 'd', label: { en: 'x', zh: '好' }, condition: deep(10) },
      { id: 'a', label: { en: 'x', zh: '好' }, condition: { kind: 'all_of', conditions: [] } },
      { id: 'n', label: { en: 'x', zh: '好' }, condition: 'x' },
      'junk',
      { id: 'p1', label: { en: 'x', zh: '好' }, condition: { kind: 'event', event: 'persona.action', where: { action: 'x' } } },
      { id: 'p2', label: { en: 'x', zh: '好' }, condition: { kind: 'any_of', conditions: [{ kind: 'event', event: 'persona.action', where: { persona: 'ghost', action: 'x' } }] } },
    );
  }],
  ['goals persona action missing', (s) => {
    if (!s.personas?.length) return false;
    s.goals.push({ id: 'pa', label: { en: 'x', zh: '好' }, condition: { kind: 'event', event: 'persona.action', where: { persona: s.personas[0].id, action: 'never_declared' } } });
  }],
  ['mistakes bad', (s) => void (s.mistakes = [{ id: 'm', label: { en: 'x', zh: 'y' }, when: { kind: 'event', event: 'persona.action', where: { persona: 'nobody' } } }, { label: {} }, 4])],
  ['hints empty', (s) => void (s.hints = [])],
  ['hints bad', (s) => void (s.hints = [...s.hints, { en: 'x' }, { en: 'x', zh: '好', done: { kind: 'x' } }, 'h'])],
  ['hints many', (s) => void (s.hints = Array.from({ length: 17 }, () => s.hints[0]))],
  ['vocab string', (s) => void (s.vocab = 'x')],
  ['vocab bad', (s) => void (s.vocab = [...s.vocab, { hanzi: 'abc', pinyin: 'x', english: 'y' }, { hanzi: '好' }, 2])],
  ['vocab many', (s) => void (s.vocab = Array.from({ length: 41 }, () => s.vocab[0]))],
];

const validate: Array<{ name: string; spec: unknown; problems: string[] }> = [];
for (const s of BUNDLED_SCENARIOS) validate.push({ name: s.id, spec: s, problems: validateScenarioSpec(s) });
for (const s of BUNDLED_SCENARIOS) {
  for (const [name, mut] of MUTATIONS) {
    const c = clone(s) as any;
    let problems: string[];
    try {
      if (mut(c) === false) continue;
      problems = validateScenarioSpec(c);
    } catch {
      continue; // a shape the web would throw on — not a case to compare
    }
    validate.push({ name: `${s.id}: ${name}`, spec: c, problems });
  }
}
for (const raw of ['nope', null, [], 5]) validate.push({ name: `raw ${JSON.stringify(raw)}`, spec: raw, problems: validateScenarioSpec(raw) });
out.validate = validate;

// ---------------------------------------------------------------------------
// Matchers + conditions
// ---------------------------------------------------------------------------

const VALUES: unknown[] = [
  'G7311', 'g7311', '', ' ', '18.50', '18.5', '0x12', '1e3', '86', '10:45', '11:05', '不要香菜，少辣', 'abc',
  86, 18.5, 0, -3, 1000, 18, true, false, null, undefined,
  ['a', 'b'], ['中辣', '加蛋', '细面'], ['中辣'], [], [86, '87'], [{ name: 'x', options: ['少冰'] }], [{ name: 'y', options: [] }],
  { a: 1 }, { name: 'x', options: ['少冰'] },
];
const MATCHERS: Matcher[] = [
  'G7311', '86', 86, '18.50', 18.5, 'b', true, false, null, '', ' 86 ', 0,
  { eq: 'G7311' }, { ne: 'G7311' }, { eq: null }, { ne: null }, { in: ['a', 'G7311', 86] }, { nin: ['b', 18.5] },
  { gt: 10 }, { gte: '10:30', lte: '11:00' }, { lt: '86' }, { lte: 86 }, { gt: 'abc' }, { gte: 0 },
  { contains: '香菜' }, { contains: 'b' }, { contains: 86 }, { contains: '加' },
  { size: 1 }, { size: 0 }, { size: { gte: 2 } }, { size: { lte: 1 } }, { size: { gte: 1, lte: 3 } },
  { exists: true }, { exists: false }, { exists: 1 as unknown as boolean },
  { has_all: ['中辣', '加蛋'] }, { has_all: [] }, { every: 'a' }, { every: { in: ['中辣', '加蛋', '细面'] } }, { some: { match: { name: 'x', options: '少冰' } } }, { some: 86 },
  { match: { name: 'x' } }, { match: { 'options.0': '少冰' } }, { match: { a: { gte: 1 } } },
  { eq: 86, in: [86, 87], gt: 80 }, { contains: 'G', size: 5 },
];
const matcherCases: Array<{ value: unknown; matcher: Matcher; result: boolean; has_value: boolean }> = [];
for (const v of VALUES) for (const m of MATCHERS) matcherCases.push({ value: v === undefined ? null : v, has_value: v !== undefined, matcher: m, result: matches(v, m) });
out.matchers = matcherCases;

const condEvents: PhoneEvent[] = [
  rec('rail_order', 'o1', { status: 'paid', train_no: 'G1', passengers: ['A'], seats: ['05车07F'] }),
  rec('rail_order', 'o1', { status: 'refunded' }),
  rec('rail_order', 'o2', { status: 'paid', train_no: 'G2', passengers: ['A', 'B'] }),
  ev('persona.action', { persona: 'driver', action: 'found_passenger', params: { where: '北门' } }),
  ev('persona.action', { persona: 'driver', action: 'found_passenger', params: { where: '南门' } }),
  ev('hint', { index: 0 }),
  ev('error', { code: 'pay_password' }),
  rec('food_order', 'F1', { lines: [{ item_id: 'lamian', options: ['中辣', '加蛋'] }], total: 25 }),
];
const CONDITIONS: GoalCondition[] = [
  { kind: 'record', record: 'rail_order', where: { status: 'paid' } },
  { kind: 'record', record: 'rail_order', where: { status: 'refunded', train_no: 'G1' } },
  { kind: 'record', record: 'rail_order', count: 2 },
  { kind: 'record', record: 'rail_order', count: { lte: 1 } },
  { kind: 'record', record: 'rail_order', where: { 'passengers.1': 'B' } },
  { kind: 'record', record: 'rail_order', where: { passengers: { size: 2 } } },
  { kind: 'record', record: 'rail_order', where: { 'seats.0': { contains: 'F' } } },
  { kind: 'record', record: 'food_order', where: { lines: { some: { match: { item_id: 'lamian', options: { has_all: ['中辣', '加蛋'] } } } } } },
  { kind: 'record', record: 'food_order', where: { 'lines.length': 1 } },
  { kind: 'event', event: 'persona.action', where: { 'params.where': { contains: '北' } } },
  { kind: 'event', event: 'persona.action', count: 2 },
  { kind: 'event', event: 'persona.action', count: { gte: 3 } },
  { kind: 'event', event: 'error', where: { code: 'pay_password' } },
  { kind: 'not', condition: { kind: 'event', event: 'persona.action' } },
  { kind: 'any_of', conditions: [{ kind: 'record', record: 'transfer' }, { kind: 'event', event: 'hint' }] },
  { kind: 'all_of', conditions: [{ kind: 'record', record: 'transfer' }, { kind: 'event', event: 'hint' }] },
  { kind: 'all_of', conditions: [] },
  { kind: 'any_of', conditions: [] },
  { kind: 'bogus' } as unknown as GoalCondition,
];
out.conditions = { events: condEvents, records: recordsFrom(condEvents), cases: CONDITIONS.map((c) => ({ condition: c, result: checkCondition(c, snapshot(condEvents)) })) };

// ---------------------------------------------------------------------------
// Golden play-throughs (the web's phone.test.ts golden paths + wrong variants)
// ---------------------------------------------------------------------------

const plays: Array<{ scenario: string; name: string; events: PhoneEvent[] }> = [];
const play = (scenario: string, name: string, events: PhoneEvent[]) => plays.push({ scenario, name, events });

for (const s of BUNDLED_SCENARIOS) play(s.id, 'seed', seedEvents(s, 0));
{
  const s = sc('rail-hangzhou-saturday');
  const w = s.world.rail!;
  const t = rail.findTrain(w, 'G7311', '2026-10-31')!;
  const seats = rail.assignSeats(t, '二等座', 1, ['F'], 'R001');
  play(s.id, 'golden', [rec('rail_order', 'R001', rail.railOrderData({ train: t, seatClass: '二等座', passengers: [w.passengers[0]], seats, orderId: 'R001', orderNo: 'E1', status: 'paid' }))]);
  play(s.id, 'unpaid', [rec('rail_order', 'R001', rail.railOrderData({ train: t, seatClass: '二等座', passengers: [w.passengers[0]], seats, orderId: 'R001', orderNo: 'E1', status: 'unpaid' }))]);
  play(s.id, 'wrong day', [rec('rail_order', 'R002', rail.railOrderData({ train: rail.findTrain(w, 'G7311', '2026-10-30')!, seatClass: '二等座', passengers: [w.passengers[0]], seats, orderId: 'R002', orderNo: 'E2', status: 'paid' }))]);
  const aisle = rail.assignSeats(t, '二等座', 1, [], 'R003');
  play(s.id, 'aisle + hints', [ev('hint', { index: 0 }), ev('hint', { index: 1 }), ev('error', { code: 'pay_password' }), rec('rail_order', 'R003', rail.railOrderData({ train: t, seatClass: '二等座', passengers: [w.passengers[0]], seats: aisle, orderId: 'R003', orderNo: 'E3', status: 'paid' }))]);
  const g1655 = rail.findTrain(w, 'G1655', '2026-10-31')!;
  play(s.id, 'wrong train + class', [rec('rail_order', 'R004', rail.railOrderData({ train: g1655, seatClass: '一等座', passengers: [w.passengers[0]], seats: rail.assignSeats(g1655, '一等座', 1, ['A'], 'R004'), orderId: 'R004', orderNo: 'E4', status: 'paid' })), rec('rail_order', 'R004', { status: 'refunded' })]);
}
{
  const s = sc('rail-friend-passport');
  const w = s.world.rail!;
  const anna = { id: 'p2', name: 'SMITH ANNA', id_type: '护照' as const, id_no: '533812940', country: '英国' };
  const t = rail.findTrain(w, 'C2023', '2026-11-01')!;
  const seats = rail.assignSeats(t, '二等座', 2, ['D', 'F'], 'R001');
  play(s.id, 'golden', [ev('login', { app: 'rail' }), rec('rail_passenger', 'p2', anna), rec('rail_order', 'R001', rail.railOrderData({ train: t, seatClass: '二等座', passengers: [w.passengers[0], anna], seats, orderId: 'R001', orderNo: 'E1', status: 'paid' }))]);
  play(s.id, 'apart', [rec('rail_passenger', 'p2', anna), rec('rail_order', 'R001', rail.railOrderData({ train: t, seatClass: '二等座', passengers: [w.passengers[0], anna], seats: ['05车07C', '05车07D'], orderId: 'R001', orderNo: 'E1', status: 'paid' }))]);
}
{
  const s = sc('rail-change-refund');
  const w = s.world.rail!;
  const seed = seedEvents(s, 0);
  const t = rail.findTrain(w, 'G7062', '2026-10-30')!;
  play(s.id, 'golden', [
    ...seed,
    rec('rail_order', 'o1', { status: 'changed' }),
    rec('rail_order', 'R001', rail.railOrderData({ train: t, seatClass: '二等座', passengers: [w.passengers[0]], seats: ['05车03A'], orderId: 'R001', orderNo: 'E9', status: 'paid', changedFrom: 'o1' })),
    rec('rail_order', 'o2', { status: 'refunded', refund_fee: 13 }),
  ]);
  play(s.id, 'refund only', [...seed, rec('rail_order', 'o2', { status: 'refunded', refund_fee: 13 })]);
}
{
  play('ride-hongqiao-station', 'golden', [rec('ride_order', 'D1', { to_id: 'hq_station', car_type: '快车', status: 'paid', rating: 5 })]);
  play('ride-hongqiao-station', 'airport', [rec('ride_order', 'D1', { to_id: 'hq_airport_t2', car_type: '专车', status: 'paid' })]);
  play('ride-north-gate', 'golden', [rec('ride_order', 'D1', { to_id: 'bund', car_type: '特惠快车', status: 'accepted' }), ev('persona.action', { persona: 'driver', action: 'found_passenger', params: { where: '北门' } }), rec('ride_order', 'D1', { status: 'paid' })]);
  play('ride-north-gate', 'south', [rec('ride_order', 'D1', { to_id: 'bund', car_type: '快车', status: 'accepted' }), ev('persona.action', { persona: 'driver', action: 'found_passenger', params: { where: '南门' } }), ev('persona.message', { persona: 'driver', from: 'me', text: '我在南门' })]);
  play('ride-lost-item', 'golden', [ev('persona.action', { persona: 'lost_driver', action: 'arrange_return', params: { place: '酒店前台', time: '中午' } })]);
}
{
  const s1 = sc('food-beef-noodles');
  const shop = s1.world.food!.shops[0];
  const noodle = shop.menu[0].items[0];
  const cart = food.changeCart([], noodle, ['中辣', '细面', '加蛋'], 24, 1);
  const data = food.foodOrderData({ shop, cart, totals: food.cartTotals(shop, cart), note: '', noteTags: ['不要香菜'], cutlery: '无需餐具', address: s1.world.food!.addresses[0], orderId: 'F001', status: 'paid' });
  play(s1.id, 'golden', [rec('food_order', 'F001', data)]);
  const spicy = food.changeCart([], noodle, ['特辣', '细面'], 22, 1);
  play(s1.id, 'wrong spice', [rec('food_order', 'F001', food.foodOrderData({ shop, cart: spicy, totals: food.cartTotals(shop, spicy), note: '少放盐', noteTags: [], cutlery: '1份', address: s1.world.food!.addresses[0], orderId: 'F001', status: 'paid' }))]);
  const s2 = sc('food-team-lunch');
  const lunch = s2.world.food!.shops[0];
  const [gongbao, yuxiang, fanqie] = lunch.menu[0].items;
  let c = food.changeCart([], gongbao, ['微辣'], 23, 1);
  c = food.changeCart(c, yuxiang, [], 22, 1);
  c = food.changeCart(c, fanqie, [], 19, 1);
  const totals = food.cartTotals(lunch, c, s2.world.food!.red_packets);
  play(s2.id, 'golden', [rec('food_order', 'F001', food.foodOrderData({ shop: lunch, cart: c, totals, note: '', noteTags: [], cutlery: '3份', address: s2.world.food!.addresses[0], orderId: 'F001', status: 'paid' }))]);
  const noRed = food.cartTotals(lunch, c, s2.world.food!.red_packets, null);
  play(s2.id, 'no red packet', [rec('food_order', 'F001', food.foodOrderData({ shop: lunch, cart: c, totals: noRed, note: '', noteTags: [], cutlery: '3份', address: s2.world.food!.addresses[0], orderId: 'F001', status: 'paid' }))]);
  const s3 = sc('food-milk-tea-rider');
  const tea = s3.world.food!.shops.find((x) => x.id === 'tea_fresh')!;
  const tc = food.changeCart([], tea.menu[0].items[0], ['半糖', '少冰'], 19, 1);
  const home = { id: 'addr_1', label: '家', detail: '静安区愚园路68弄 梧桐公寓', room: '3号楼1202室' };
  play(s3.id, 'golden', [
    rec('food_address', 'addr_1', { ...home, name: 'Sam', phone: '13916582047' }),
    rec('food_order', 'F001', food.foodOrderData({ shop: tea, cart: tc, totals: food.cartTotals(tea, tc), note: '', noteTags: [], cutlery: '无需餐具', address: home, orderId: 'F001', status: 'paid' })),
    ev('persona.action', { persona: 'rider', action: 'drop_off', params: { place: '门卫室' } }),
  ]);
}
{
  const s1 = sc('movie-tonight-two');
  const w1 = s1.world.movie!;
  const show = w1.shows.find((x) => x.start === '21:45')!;
  const sold = movie.soldSeats(show);
  let pair: string[] | null = null;
  for (let r = 1; r <= show.seats.rows && !pair; r++)
    for (let c = 2; c < show.seats.cols && !pair; c++) {
      const ids = [`${r}-${c}`, `${r}-${c + 1}`];
      if (ids.some((i) => sold.has(i)) || !movie.seatsAdjacent(show.seats, ids) || movie.singleGapProblem(show.seats, sold, ids)) continue;
      pair = ids;
    }
  play(s1.id, 'golden', [rec('movie_order', 'M1', movie.movieOrderData({ world: w1, show, seatIds: pair!, snacks: [], orderId: 'M1', status: 'paid' }))]);
  const s2 = sc('movie-imax-english');
  const w2 = s2.world.movie!;
  const best = w2.shows.find((x) => x.id === 's_harbor_times_1030_1350')!;
  const free = [...Array(best.seats.cols).keys()].map((c) => `6-${c + 1}`).find((id) => !movie.soldSeats(best).has(id))!;
  play(s2.id, 'golden', [rec('movie_order', 'M1', movie.movieOrderData({ world: w2, show: best, seatIds: [free], snacks: [], orderId: 'M1', status: 'paid' }))]);
  const s3 = sc('movie-couple-popcorn');
  const w3 = s3.world.movie!;
  const eve = w3.shows.find((x) => x.start === '19:30')!;
  const couple = eve.seats.couple!.find((id) => !movie.soldSeats(eve).has(id))!;
  const ids = movie.toggleSeat(eve.seats, movie.soldSeats(eve), [], couple).selected;
  play(s3.id, 'golden', [rec('movie_order', 'M1', movie.movieOrderData({ world: w3, show: eve, seatIds: ids, snacks: [{ name: '双人套餐', price: 46, qty: 1 }], orderId: 'M1', status: 'paid' }))]);
}
{
  play('dine-queue-shengjian', 'golden', [rec('dine_queue', 'Q1', { restaurant_id: 'r_shengjian', people: 2, table_id: 'A', status: 'waiting' })]);
  play('dine-book-saturday', 'golden', [rec('dine_booking', 'B1', { restaurant_id: 'r_benbang', date: '2026-10-31', time: '19:00', people: 4, area: '大厅', phone: '13916582047', status: 'pending' })]);
  play('dine-book-saturday', 'full slot', [rec('dine_booking', 'B1', { restaurant_id: 'r_benbang', date: '2026-10-31', time: '20:30', people: 3, area: '大厅', phone: '13916582047', status: 'pending' })]);
  play('dine-birthday-room', 'golden', [
    rec('dine_booking', 'B1', { restaurant_id: 'r_yaji', date: '2026-10-30', time: '19:00', people: 6, area: '包间', status: 'confirmed' }),
    ev('persona.action', { persona: 'host', action: 'confirm_request', params: { arrangement: '自带蛋糕' } }),
  ]);
  play('chat-pay-back', 'golden', [rec('transfer', 'T1', { to_id: 'xiaolin', kind: 'transfer', amount: 86, note: '饭钱' })]);
  play('chat-pay-back', 'wrong amount', [rec('transfer', 'T1', { to_id: 'xiaolin', kind: 'transfer', amount: 172, note: '' })]);
  play('chat-fruit-qr', 'golden', [rec('qr_payment', 'Q1', { qr_id: 'stall_pay', amount: 18.5 }), rec('red_packet_opened', 'xiaolin-1', { from_id: 'xiaolin', amount: 16.8 })]);
  play('chat-landlord', 'golden', [ev('persona.action', { persona: 'landlord', action: 'agree_early', params: { time: '周五下午两点' } }), rec('transfer', 'T1', { to_id: 'landlord', kind: 'transfer', amount: 6500, note: '押金' })]);
}
out.plays = plays.map((p) => {
  const s = sc(p.scenario);
  return {
    ...p,
    complete: isComplete(s, p.events),
    goals: goalStates(s, p.events).map((g) => [g.goal.id, g.done]),
    mistakes: mistakesMade(s, p.events).map((m) => m.id),
    hints: Array.from({ length: s.hints.length + 2 }, (_, shown) => nextHintIndex(s, p.events, shown)),
    slips: slipCount(p.events),
    records: recordsFrom(p.events),
    result: scenarioResult(s, p.events, 5_000, 5_000 + 185_000 + p.events.length * 1000),
  };
});

// ---------------------------------------------------------------------------
// Rail
// ---------------------------------------------------------------------------

const railWorlds = BUNDLED_SCENARIOS.filter((s) => s.world.rail).map((s) => s.world.rail!);
const STATION_QUERIES = ['虹桥', '上海', 'shhq', 'hangzhoud', 'HZD', ' bei jing ', 'b', 'tj', '南京', 'nj', 'x', '', '  ', '杭州东', 'sh', 'suzhoubei', '天津南'];
const railOut: Record<string, unknown> = {};
railOut.stations = railWorlds.slice(0, 1).flatMap((w) => STATION_QUERIES.map((q) => ({ q, hits: rail.searchStations(w.stations, q).map((s) => s.name) })));
railOut.initials = railWorlds[0].stations.map((s) => rail.stationInitials(s));
railOut.kinds = ['G7311', 'g1', 'C2023', 'D3125', 'Z1', 'T110', 'K1805', 'L5', 'Y1', '1461', ''].map((n) => [n, rail.trainKind(n), rail.isHighSpeed(n)]);
const searches: unknown[] = [];
railWorlds.forEach((w, wi) => {
  const pairs = new Set<string>();
  for (const t of w.trains) {
    pairs.add(`${t.from}|${t.to}|${t.date}`);
    pairs.add(`${rail.cityOf(w.stations, t.from)}|${rail.cityOf(w.stations, t.to)}|${t.date}`);
  }
  const orders = w.trains.slice(0, 4).map((t, i) => rec('rail_order', `X${i}`, { status: pick(['paid', 'unpaid', 'cancelled']), train_no: t.no, date: t.date, seat_class: t.seats[0].class, passengers: Array.from({ length: int(1, 30) }, () => 'P') }));
  const records = recordsFrom(orders);
  for (const key of pairs) {
    const [from, to, date] = key.split('|');
    for (const sort of ['depart', 'duration', 'price'] as const)
      for (const hs of [false, true])
        for (const av of [false, true]) {
          searches.push({ world: wi, from, to, date, sort, highSpeedOnly: hs, availableOnly: av, records: av ? orders : [], result: rail.searchTrains(w, from, to, date, { sort, highSpeedOnly: hs, availableOnly: av }, av ? records : []).map((t) => `${t.no}|${t.date}`) });
        }
  }
});
railOut.searches = searches;
const left: unknown[] = [];
railWorlds.forEach((w, wi) => {
  for (const t of w.trains)
    for (const o of t.seats) {
      const evs = [rec('rail_order', 'A', { status: pick(['paid', 'unpaid', 'refunded']), train_no: t.no, date: t.date, seat_class: o.class, passengers: Array.from({ length: int(0, 25) }, () => 'P') })];
      const l = rail.seatsLeft(t, o.class, recordsFrom(evs));
      left.push({ world: wi, no: t.no, date: t.date, cls: o.class, events: evs, left: l, label: rail.seatsLabel(l, o.waitlist), label_plain: rail.seatsLabel(l) });
    }
});
railOut.left = left;
railOut.letters = ['二等座', '一等座', '商务座', '硬卧', '无座', '软卧'].map((c) => [c, rail.seatLetters(c as never)]);
const assigns: unknown[] = [];
railWorlds.forEach((w, wi) => {
  for (const t of w.trains)
    for (const o of t.seats)
      for (let k = 0; k < 3; k++) {
        const count = int(1, 6);
        const chosen = Array.from({ length: int(0, 4) }, () => pick(['A', 'B', 'C', 'D', 'E', 'F', 'G']));
        const orderId = `R${String(int(1, 999)).padStart(3, '0')}`;
        const seats = rail.assignSeats(t, o.class, count, chosen, orderId);
        assigns.push({ world: wi, no: t.no, date: t.date, cls: o.class, count, chosen, order_id: orderId, seats, window: rail.windowCount(seats), together: rail.seatsTogether(seats), letters: seats.map((x) => rail.seatLetterOf(x)) });
      }
});
railOut.assigns = assigns;
railOut.together = [['05车07D', '05车07F'], ['05车07C', '05车07D'], ['05车07A'], [], ['05车07A', '06车07B'], ['05车07A', '05车08B'], ['05车 无座', '05车 无座'], ['05车07F', '05车07D', '05车07E']].map((s) => [s, rail.seatsTogether(s), rail.windowCount(s)]);
railOut.ids = ['11010519491231002X', '11010519491231002x', '110105194912310021', '11010519491231002', 'ABCDEFGHIJKLMNOPQR', '440524188001010014', '440524188001010013', '١١٠١٠٥١٩٤٩١٢٣١٠٠٢X'].map((id) => [id, rail.validChineseId(id)]);
railOut.phones = ['13916582047', '139 1658 2047', '12916582047', '1391658204', '139165820471', '', '23916582047', '1８916582047'].map((p) => [p, rail.validPhone(p)]);
const PASSENGERS: Array<Record<string, unknown>> = [
  { id_type: '护照', name: 'SMITH ANNA', id_no: '533812940' },
  { id_type: '护照', name: '', id_no: '1', country: '英国' },
  { id_type: '护照', name: 'X Y', id_no: '548213907', country: '英国' },
  { id_type: '护照', name: 'X Y', id_no: '548213907', country: '英国', id: 'p_self' },
  { id_type: '护照', name: 'SMITH ANNA', id_no: '533812940', country: '英国', phone: '123' },
  { id_type: '护照', name: '1SMITH', id_no: '533812940', country: '英国' },
  { id_type: '护照', name: '李 雷', id_no: 'E12345678', country: '英国' },
  { id_type: '中国居民身份证', name: '李雷', id_no: '11010519491231002X' },
  { id_type: '中国居民身份证', name: 'LI LEI', id_no: '11010519491231002X' },
  { id_type: '中国居民身份证', name: '李', id_no: '110105194912310021' },
  { id_type: '中国居民身份证', name: '王·小明', id_no: '' },
  { id_type: '外国人永久居留身份证', name: 'ANY', id_no: 'ABC12345' },
  { id_type: '港澳居民来往内地通行证', name: 'ANY', id_no: 'H1234567' },
  { id_type: '港澳居民来往内地通行证', name: 'ANY', id_no: 'H12-34567' },
  { name: 'NOBODY', id_no: 'X' },
  {},
  { id_type: '护照', name: '  smith   anna ', id_no: ' 533812940 ', country: '英国' },
];
railOut.passengers = PASSENGERS.map((p) => ({ p, problems: rail.passengerProblems(p as never, railWorlds[0].passengers), problems_none: rail.passengerProblems(p as never) }));
railOut.names = ['  smith   anna ', 'Taylor Sam', 'x', ''].map((n) => [n, rail.normalizePassportName(n)]);
const refunds: unknown[] = [];
for (let i = 0; i < 400; i++) {
  const price = pick([134.5, 73, 30, 49.5, 219, 9.5, 2, 1.5, 1000]);
  const today = dates.addDays('2026-10-20', int(0, 14));
  const now = dates.timeOf(int(0, 1439));
  const date = dates.addDays('2026-10-20', int(0, 16));
  const depart = dates.timeOf(int(0, 1439));
  refunds.push({ price, today, now, date, depart, fee: rail.refundFee(price, today, now, date, depart), label: rail.refundRateLabel(today, now, date, depart) });
}
for (const [price, today, now, date, depart] of [[134.5, '2026-10-29', '16:00', '2026-10-30', '18:30'], [134.5, '2026-10-29', '16:00', '2026-10-30', '08:00'], [73, '2026-10-20', '10:00', '2026-10-31', '09:12'], [30, '2026-10-29', '10:00', '2026-10-31', '12:00'], [73, '2026-10-31', '10:00', '2026-10-31', '09:12'], [100, '2026-10-01', '00:00', '2026-10-09', '00:00'], [100, '2026-10-01', '00:00', '2026-10-03', '00:00'], [100, '2026-10-01', '00:00', '2026-10-02', '00:00']] as const)
  refunds.push({ price, today, now, date, depart, fee: rail.refundFee(price, today, now, date, depart), label: rail.refundRateLabel(today, now, date, depart) });
railOut.refunds = refunds;
const changes: unknown[] = [];
railWorlds.forEach((w, wi) => {
  for (const t of w.trains)
    for (const [today, now] of [['2026-10-29', '16:00'], ['2026-10-30', '09:00'], ['2026-10-15', '23:59'], ['2026-10-31', '10:00']]) {
      changes.push({ world: wi, train_no: t.no, date: t.date, from: t.from, to: t.to, today, now, result: rail.changeOptions(w, { train_no: t.no, date: t.date, from: t.from, to: t.to }, today, now).map((x) => `${x.no}|${x.date}`) });
    }
});
railOut.changes = changes;
railOut.differences = [[73, 117], [134.5, 49.5], [0.1, 0.3], [100, 100], [33.3, 66.7]].map(([a, b]) => [a, b, rail.changeDifference(a, b)]);
const orders: unknown[] = [];
railWorlds.forEach((w, wi) => {
  for (const t of w.trains)
    for (const o of t.seats) {
      const pas = w.passengers.filter(() => R() < 0.7);
      const use = pas.length ? pas : [w.passengers[0]];
      const seats = rail.assignSeats(t, o.class, use.length, [pick(['A', 'F', 'C'])], 'R009');
      const status = pick(['paid', 'unpaid'] as const);
      const changedFrom = R() < 0.3 ? 'o1' : undefined;
      orders.push({ world: wi, no: t.no, date: t.date, cls: o.class, passenger_ids: use.map((p) => p.id), seats, order_id: 'R009', order_no: 'E77', status, changed_from: changedFrom ?? null, data: rail.railOrderData({ train: t, seatClass: o.class, passengers: use, seats, orderId: 'R009', orderNo: 'E77', status, changedFrom }) });
    }
});
railOut.orders = orders;
out.rail = railOut;

// ---------------------------------------------------------------------------
// Ride
// ---------------------------------------------------------------------------

const rideWorlds = BUNDLED_SCENARIOS.filter((s) => s.world.ride).map((s) => s.world.ride!);
const rideOut: Record<string, unknown> = {};
rideOut.estimates = rideWorlds.flatMap((w, wi) => w.cars.flatMap((c, ci) => [0, 0.5, 3.2, 18.6, 25, 47.3, 101].map((km) => ({ world: wi, car: ci, km, price: ride.estimatePrice(c, km), minutes: ride.tripMinutes(km) }))));
const POI_QUERIES = ['虹桥站', '虹桥火车站', '机场', '外滩', '酒店', '地铁', 'x', '', ' 静安 ', '上海', '站', '南京路', '豫园', 'hongqiao', '虹 桥'];
rideOut.pois = rideWorlds.flatMap((w, wi) => POI_QUERIES.map((q) => ({ world: wi, q, hits: ride.searchPois(w.pois, q).map((p) => p.id) })));
rideOut.coupons = rideWorlds.flatMap((w, wi) => RIDE_CAR_TYPES.flatMap((t) => [5, 19.9, 20, 56.8, 100].map((price) => {
  const c = ride.bestCoupon(w.coupons, t as never, price);
  return { world: wi, type: t, price, coupon: c?.id ?? null, after: ride.priceAfterCoupon(price, c) };
})));
rideOut.extra_coupons = (() => {
  const cs = [{ id: 'a', name: 'A', amount: 3 }, { id: 'b', name: 'B', amount: 8, car_type: '专车' as const, min_price: 50 }, { id: 'c', name: 'C', amount: 8, min_price: 10 }, { id: 'd', name: 'D', amount: 12, car_type: '快车' as const }];
  return { coupons: cs, cases: RIDE_CAR_TYPES.flatMap((t) => [4, 10, 49, 50, 80].map((price) => ({ type: t, price, coupon: ride.bestCoupon(cs, t as never, price)?.id ?? null, after: ride.priceAfterCoupon(price, ride.bestCoupon(cs, t as never, price)) }))) };
})();
rideOut.status = ride.RIDE_STATUSES.flatMap((s) => [1, 3, 4.5].map((eta) => [s, eta, ride.rideStatusLine(s, eta)]));
rideOut.cancel = ride.RIDE_STATUSES.flatMap((s) => [0, 1.9, 2, 7].map((m) => [s, m, ride.cancelFee(s, m)]));
out.ride = rideOut;

// ---------------------------------------------------------------------------
// Food
// ---------------------------------------------------------------------------

const foodWorlds = BUNDLED_SCENARIOS.filter((s) => s.world.food).map((s) => s.world.food!);
const foodOut: Record<string, unknown> = {};
const optionCases: unknown[] = [];
foodWorlds.forEach((w, wi) => {
  for (const shop of w.shops)
    for (const cat of shop.menu)
      for (const item of cat.items)
        for (let k = 0; k < 6; k++) {
          const picks: Record<string, string[]> = {};
          for (const g of item.options ?? []) {
            const n = k === 0 ? 0 : int(0, g.multi ? 3 : 2);
            if (n > 0 || R() < 0.3) picks[g.name] = Array.from({ length: n }, () => pick(g.choices).name);
          }
          if (k === 5) picks['不存在'] = ['x'];
          optionCases.push({ world: wi, shop: shop.id, item: item.id, picks, problems: food.optionProblems(item, picks), price: food.unitPrice(item, picks), picked: food.pickedList(item, picks) });
        }
});
foodOut.options = optionCases;
const carts: unknown[] = [];
foodWorlds.forEach((w, wi) => {
  for (const shop of w.shops)
    for (let k = 0; k < 8; k++) {
      const steps: Array<{ item: string; options: string[]; price: number; delta: number }> = [];
      let cart: food.CartLine[] = [];
      const items = shop.menu.flatMap((c) => c.items);
      for (let j = 0; j < int(1, 9); j++) {
        const item = pick(items);
        const options = (item.options ?? []).flatMap((g) => (R() < 0.8 ? [pick(g.choices).name] : []));
        const price = food.unitPrice(item, Object.fromEntries((item.options ?? []).map((g) => [g.name, options.filter((o) => g.choices.some((c) => c.name === o))])));
        const delta = pick([1, 1, 1, 2, -1, -2]);
        steps.push({ item: item.id, options, price, delta });
        cart = food.changeCart(cart, item, options, price, delta);
      }
      const packets = w.red_packets;
      const choice = pick(['auto', 'none', 'id', 'id-bad'] as const);
      const rpId = choice === 'auto' ? undefined : choice === 'none' ? null : choice === 'id' ? (packets?.[0]?.id ?? 'rp0') : 'nope';
      const totals = food.cartTotals(shop, cart, packets, rpId);
      const goods = food.itemsTotal(cart) + food.packingFee(shop, cart);
      const inputs = {
        note: pick(['', ' 多放醋 ', '谢谢']),
        tags: R() < 0.5 ? ['不要香菜', '少辣'] : [],
        cutlery: pick(food.FOOD_CUTLERY),
        address: pick(w.addresses.length ? w.addresses : [{ id: 'a0', detail: '某路1号', name: 'S', phone: '13900000000' }]),
        order_id: 'F00' + k,
        status: pick(['paid', 'unpaid']) as food.FoodStatus,
      };
      carts.push({
        world: wi,
        shop: shop.id,
        steps,
        cart,
        choice,
        red_packet_id: rpId ?? null,
        count: food.cartCount(cart),
        items_total: food.itemsTotal(cart),
        gap: food.minOrderGap(shop, cart),
        packing: food.packingFee(shop, cart),
        best: food.bestDiscount(shop, goods),
        next: food.nextDiscount(shop, goods),
        usable: food.usableRedPackets(packets, goods).map((p) => p.id),
        totals,
        inputs,
        data: food.foodOrderData({ shop, cart, totals, note: inputs.note, noteTags: inputs.tags, cutlery: inputs.cutlery, address: inputs.address, orderId: inputs.order_id, status: inputs.status }),
      });
    }
});
foodOut.carts = carts;
out.food = foodOut;

// ---------------------------------------------------------------------------
// Movie
// ---------------------------------------------------------------------------

const movieWorlds = BUNDLED_SCENARIOS.filter((s) => s.world.movie).map((s) => s.world.movie!);
const movieOut: Record<string, unknown> = {};
movieOut.labels = ['7-8', '1-1', '12-24', 'x', '7_8', '07-08', '-1-2', ''].map((id) => [id, movie.seatLabel(id), movie.parseSeat(id)]);
const seatRules: unknown[] = [];
movieWorlds.forEach((w, wi) => {
  for (const show of w.shows) {
    const map = show.seats;
    const orderEvents = [rec('movie_order', 'MX', { show_id: show.id, status: pick(['paid', 'unpaid', 'cancelled']), seat_ids: [`${int(1, map.rows)}-${int(1, map.cols)}`, `${int(1, map.rows)}-${int(1, map.cols)}`] })];
    const sold = movie.soldSeats(show, recordsFrom(orderEvents));
    const taps: string[] = [];
    const steps: Array<{ selected: string[]; problem: string | null }> = [];
    let sel: string[] = [];
    for (let k = 0; k < 14; k++) {
      const id = R() < 0.5 && map.couple?.length ? pick([pick(map.couple), `${int(1, map.rows)}-${int(1, map.cols)}`]) : `${int(0, map.rows + 1)}-${int(0, map.cols + 1)}`;
      taps.push(id);
      const r = movie.toggleSeat(map, sold, sel, id);
      sel = r.selected;
      steps.push(r);
    }
    const probes: unknown[] = [];
    for (let k = 0; k < 10; k++) {
      const row = int(1, map.rows);
      const c0 = int(1, map.cols);
      const ids = Array.from({ length: int(1, 4) }, (_, i) => `${R() < 0.85 ? row : int(1, map.rows)}-${c0 + i}`);
      probes.push({ ids, gap: movie.singleGapProblem(map, sold, ids), adjacent: movie.seatsAdjacent(map, ids), couple: ids.map((i) => movie.isCoupleSeat(map, i)), pair: ids.map((i) => movie.couplePair(map, i)), exists: ids.map((i) => movie.seatExists(map, i)) });
    }
    seatRules.push({ world: wi, show: show.id, events: orderEvents, sold: [...sold], taps, steps, probes, end: movie.showEnd(w, show) });
  }
});
movieOut.seats = seatRules;
movieOut.extra_map = (() => {
  const map = { rows: 3, cols: 8, aisles_after: [4, 0, 9], sold: ['2-1'], couple: ['3-1', '3-3'], missing: ['1-8'] };
  const sold = new Set(map.sold);
  const sels = [['2-3'], ['2-2', '2-3'], ['1-5', '1-6'], ['1-6'], ['1-6', '1-7'], ['1-1', '1-3'], ['3-5'], ['2-4', '2-5'], ['1-4', '1-5'], ['2-7']];
  return { map, sels: sels.map((s) => ({ s, gap: movie.singleGapProblem(map, sold, s), adjacent: movie.seatsAdjacent(map, s) })), blocks: movie.seatsAdjacent(map, ['1-4', '1-5']) };
})();
movieOut.shows = movieWorlds.flatMap((w, wi) => {
  const films = w.films.map((f) => f.id);
  const days = [...new Set(w.shows.map((s) => s.date))];
  return films.flatMap((f) => days.flatMap((d) => [undefined, ...w.cinemas.map((c) => c.id)].map((c) => ({ world: wi, film: f, date: d, cinema: c ?? null, result: movie.showsFor(w, f, d, c).map((s) => s.id) }))));
});
movieOut.codes = ['M001', 'M1', 'M999', '', '订单1', 'M😀1'].map((id) => [id, movie.ticketCode(id)]);
const movieOrders: unknown[] = [];
movieWorlds.forEach((w, wi) => {
  for (const show of w.shows) {
    const ids = Array.from({ length: int(0, 4) }, () => `${int(1, show.seats.rows)}-${int(1, show.seats.cols)}`);
    const uniq = [...new Set(ids)];
    const snacks = (w.snacks ?? []).map((s) => ({ name: s.name, price: s.price, qty: int(0, 2) }));
    movieOrders.push({ world: wi, show: show.id, seat_ids: uniq, snacks, data: movie.movieOrderData({ world: w, show, seatIds: uniq, snacks, orderId: 'M00' + int(1, 9), status: pick(['paid', 'unpaid']) as 'paid' }) });
  }
});
movieOut.orders = movieOrders;
out.movie = movieOut;

// ---------------------------------------------------------------------------
// Dine
// ---------------------------------------------------------------------------

const dineWorlds = BUNDLED_SCENARIOS.filter((s) => s.world.dine).map((s) => s.world.dine!);
const dineOut: Record<string, unknown> = {};
dineOut.queue = dineWorlds.flatMap((w, wi) => w.restaurants.filter((r) => r.queue).flatMap((r) => Array.from({ length: 12 }, (_, people) => {
  const t = dine.queueTableFor(r.queue!, people);
  return { world: wi, restaurant: r.id, people, table: t?.id ?? null, tickets: t ? [0, 1, 3].map((k) => dine.queueTicket(t, k)) : [] };
})));
dineOut.extra_tables = (() => {
  const t = { id: 'C', name: '大桌', min: 7, max: 12, waiting: 0, minutes: 0 };
  const t2 = { id: 'B', name: '中桌', min: 3, max: 4, waiting: 7, minutes: 50 };
  return [0, 1, 2, 5].flatMap((k) => [dine.queueTicket(t, k), dine.queueTicket(t2, k)]);
})();
dineOut.taken = (() => {
  const evs = [rec('dine_queue', 'Q1', { restaurant_id: 'r1', table_id: 'A' }), rec('dine_queue', 'Q2', { restaurant_id: 'r1', table_id: 'B' }), rec('dine_queue', 'Q3', { restaurant_id: 'r1', table_id: 'A' }), rec('dine_booking', 'B1', { restaurant_id: 'r1', table_id: 'A' })];
  return { events: evs, cases: [['r1', 'A'], ['r1', 'B'], ['r2', 'A']].map(([r, t]) => [r, t, dine.ticketsTaken(recordsFrom(evs), r, t)]) };
})();
const bookings: unknown[] = [];
dineWorlds.forEach((w, wi) => {
  for (const r of w.restaurants) {
    const b = r.booking;
    for (let k = 0; k < 24; k++) {
      const d: dine.BookingDraft = {};
      if (R() < 0.85) d.date = b ? pick([...b.dates, '2026-12-01']) : '2026-10-31';
      if (R() < 0.85) d.time = b ? pick([...b.times, ...(b.full ?? []).map((x) => x.slice(11))]) : '19:00';
      if (R() < 0.9) d.people = int(0, 14);
      if (R() < 0.6) d.area = pick(['大厅', '包间'] as const);
      if (R() < 0.85) d.name = pick(['Taylor', ' ', '泰', '']);
      if (R() < 0.6) d.title = pick(['先生', '女士'] as const);
      if (R() < 0.85) d.phone = pick(['13916582047', '139 1658 2047', '1391658204', '']);
      if (b?.full?.length && k === 0) {
        d.date = b.full[0].slice(0, 10);
        d.time = b.full[0].slice(11);
      }
      bookings.push({ world: wi, restaurant: r.id, draft: d, problems: dine.bookingProblems(r, d), full: d.date && d.time ? dine.slotFull(r, d.date, d.time) : null });
    }
  }
});
dineOut.bookings = bookings;
dineOut.stars = [0, 0.4, 0.5, 3.2, 4.5, 4.6, 4.99, 5, 6, -1].map((x) => [x, dine.starParts(x)]);
out.dine = dineOut;

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

const walletOut: Record<string, unknown> = {};
const walletCases: unknown[] = [];
for (const s of BUNDLED_SCENARIOS) {
  for (let k = 0; k < 4; k++) {
    const evs: PhoneEvent[] = [];
    for (let j = 0; j < int(0, 7); j++) {
      const r = R();
      if (r < 0.15) evs.push(ev('error', { code: pick(['pay_password', 'phone']) }));
      else
        evs.push(
          rec('payment', `P${j}`, {
            amount: pick([12.5, 100, 0.01, 6500, '18.5', null, 33.333]),
            method: pick(['balance', 'card1', 'nocard', undefined, null]),
            direction: pick(['in', 'out', 'out']),
            status: pick(['paid', 'paid', 'refunded']),
          }),
        );
    }
    const amounts = [0.01, 18.5, 86, 600, 6500, 9000];
    walletCases.push({
      scenario: s.id,
      events: evs,
      balances: wallet.walletBalances(s.wallet, evs),
      failures: wallet.passwordFailures(evs),
      can: amounts.map((a) => ['balance', ...s.wallet.cards.map((c) => c.id), 'nocard'].map((m) => wallet.canPay(s.wallet, evs, m, a))),
      default: amounts.map((a) => wallet.defaultMethod(s.wallet, evs, a)),
    });
  }
}
walletOut.cases = walletCases;
walletOut.labels = [['balance'], ['card1'], ['nocard']].map(([m]) => [m, wallet.methodLabel(sc('chat-landlord').wallet, m)]);
walletOut.transfer = [0, -1, 0.001, 18.5, 18.505, 200, 200.01, 250, 50000, 50001, 0.1 + 0.2, 1.005, Infinity].flatMap((a) => (['transfer', 'red_packet'] as const).map((k) => [a === Infinity ? 'inf' : a, k, wallet.transferProblem(a, k)]));
walletOut.parse = ['18.5', '', '0', '0.', '.5', '18.555', 'abc', ' 12 ', '1e3', '007', '١٢'].map((t) => [t, wallet.parseAmount(t)]);
const padSeqs: unknown[] = [];
for (let k = 0; k < 150; k++) {
  const keys = Array.from({ length: int(1, 12) }, () => pick(['0', '1', '5', '9', '.', 'del', 'x', '12']));
  let t = '';
  const states: string[] = [];
  for (const key of keys) {
    t = wallet.amountKey(t, key);
    states.push(t);
  }
  padSeqs.push({ keys, states });
}
walletOut.pad = padSeqs;
out.wallet = walletOut;

// ---------------------------------------------------------------------------
// Dates, world, copy, persona, engine bits
// ---------------------------------------------------------------------------

const datesOut: Record<string, unknown> = {};
datesOut.isDate = ['2026-10-31', '2026-02-29', '2024-02-29', '2026-02-30', '0050-01-01', '0100-01-01', '2026-13-01', '2026-1-01', 'x', '', '2026-10-31 '].map((d) => [d, dates.isDate(d)]);
datesOut.isTime = ['00:00', '23:59', '24:00', '9:00', '09:60', '12:30', ''].map((t) => [t, dates.isTime(t)]);
const dayCases: unknown[] = [];
for (let k = 0; k < 120; k++) {
  const d = dates.addDays('2026-01-01', int(-400, 800));
  const n = int(-40, 40);
  const e = dates.addDays(d, n);
  dayCases.push({ d, n, add: e, between: dates.daysBetween(d, e), weekday: dates.weekday(d), md: dates.zhMonthDay(d), wk: dates.zhWeekday(d), wkl: dates.zhWeekdayLong(d), rel: dates.zhRelativeDay(e, d), label: dates.zhDateLabel(d) });
}
datesOut.days = dayCases;
const timeCases: unknown[] = [];
for (let k = 0; k < 80; k++) {
  const a = dates.timeOf(int(-3000, 3000));
  const b = dates.timeOf(int(0, 1439));
  timeCases.push({ a, b, ma: dates.minutesOf(a), span: dates.spanMinutes(a, b), dur: dates.zhDuration(dates.spanMinutes(a, b)), until: dates.minutesUntil('2026-10-29', a, dates.addDays('2026-10-29', int(-2, 5)), b) });
}
datesOut.times = timeCases;
datesOut.timeOf = [-1, 0, 59, 60, 1439, 1440, 1441, -1441, 3000].map((m) => [m, dates.timeOf(m)]);
datesOut.money = [73, 18.5, 0, 0.1 + 0.2, 1.005, 2.675, 134.5, 49.95, 1e15, -3.456, 99.999, 0.005].map((n) => [n, dates.yuan(n), dates.yuan2(n), dates.round2(n)]);
out.dates = datesOut;

const worldOut: Record<string, unknown> = {};
const idEvents = [rec('rail_order', 'R001', {}), rec('rail_order', 'R001', { status: 'paid' }), rec('rail_order', 'R002', {}), rec('payment', 'P001', {})];
worldOut.ids = [['rail_order', 'R'], ['payment', 'P'], ['food_order', 'F']].map(([r, p]) => [r, p, world.nextRecordId(idEvents, r, p)]);
worldOut.seeds = BUNDLED_SCENARIOS.map((s) => ({ scenario: s.id, events: seedEvents(s, 42) }));
worldOut.passengers = railWorlds.map((w) => {
  const evs = [rec('rail_passenger', 'p_1', { id: 'p_1', name: 'SMITH ANNA', id_type: '护照', id_no: '533812940', country: '英国' }), rec('rail_passenger', w.passengers[0].id, { ...w.passengers[0], name: 'RENAMED' }), rec('rail_passenger', 'p_2', { id: 'p_2', name: 'X', id_type: '护照', id_no: 'A1234' }), rec('rail_passenger', 'p_2', { deleted: true })];
  return { events: evs, result: world.railPassengers(w, evs).map((p) => [p.id, p.name]) };
});
worldOut.addresses = foodWorlds.map((w) => {
  const evs = [rec('food_address', 'addr_1', { id: 'addr_1', detail: '某路1号', room: '2室', name: 'S（先生）', phone: '13900000000', label: '家' }), rec('food_address', w.addresses[0]?.id ?? 'x', { id: w.addresses[0]?.id ?? 'x', detail: '改过的地址', name: 'S', phone: '13900000000' })];
  return { events: evs, result: world.foodAddresses(w.addresses, evs).map((a) => [a.id, a.detail, world.addressLine(a)]) };
});
worldOut.clock = [[0, 0], [0, 61_000], [0, 59_999], [1000, 500], [0, 86_400_000 * 2 + 3_600_000]].flatMap(([s, n]) => [['2026-10-29', '14:20'], ['2026-10-29', '23:59'], ['2026-12-31', '23:30']].map(([today, now]) => ({ today, now, started: s, now_ms: n, clock: phoneClock({ today, now }, s, n) })));
worldOut.sms = [0, 1, 1761725000000, 1761725012345, -5, 2 ** 31, 2 ** 32 + 7, 1234567].map((seed) => [seed, world.smsCodeFor(seed)]);
out.world = worldOut;

out.copy = {
  sms: ['rail', 'ride', 'chat', 'sms'].map((a) => [a, smsCode(a as never, '123456')]),
  wrong: [4, 1, 0].map((n) => ZH.wrongPassword(n)),
  sent: [60, 9].map((n) => ZH.smsSent(n)),
  zh: ZH,
};

const personaOut: Record<string, unknown> = {};
const msgs = [
  { from: 'them', text: '您在哪个门？' },
  { from: 'me', text: '  我在北门  ' },
  { from: 'bot', text: 'x' },
  { from: 'me', text: '   ' },
  { from: 'me', text: '好'.repeat(320) },
  ...Array.from({ length: 30 }, (_, i) => ({ from: i % 2 ? 'me' : 'them', text: `消息${i}` })),
];
personaOut.trim = [msgs, msgs.slice(0, 5), []].map((m) => ({ input: m, result: trimPersonaMessages(m as never) }));
personaOut.fake = BUNDLED_SCENARIOS.flatMap((s) => (s.personas ?? []).flatMap((p) => [[{ from: 'me', text: 'hello' }], [{ from: 'me', text: '我在北门' }], [], [{ from: 'me', text: '你好' }, { from: 'them', text: '好的' }]].map((m) => ({ scenario: s.id, persona: p.id, input: m, result: fakePersonaReply(p, m as never) }))));
out.persona = personaOut;

out.engine = {
  buckets: [0, 119_999, 120_000, 299_999, 300_000, 599_999, 600_000, 1_199_999, 1_200_000, 10_000_000].map((ms) => [ms, durationBucket(ms)]),
  durations: [0, 499, 500, 7_000, 59_499, 59_500, 185_000, 3_600_000, 61_500].map((ms) => [ms, formatDuration(ms)]),
};

writeFileSync(join(OUT, 'phone.json'), JSON.stringify(out));
