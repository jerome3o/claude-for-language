/**
 * `validateScenarioSpec`: structural + referential checks for a phone-practice scenario
 * (docs/PHONE_PRACTICE.md "Scenario spec"), so a hand-written or Claude-written spec that
 * passes is playable: every app it names has its world, trains run between stations that
 * exist, shows point at films and cinemas, personas the goals wait for exist and declare the
 * actions the goals check, goal conditions are well-formed. Returns problems (empty = valid),
 * each saying where ("world.rail.trains[2].from: …").
 */
import { isDate, isTime } from './dates';
import { parseSeat } from './movie';
import {
  PHONE_APP_IDS,
  PHONE_DIFFICULTIES,
  RAIL_ID_TYPES,
  RAIL_SEAT_CLASSES,
  RIDE_CAR_TYPES,
  type GoalCondition,
  type Matcher,
  type PhonePersona,
  type PhoneWorld,
  type ScenarioSpec,
} from './types';

export const SCENARIO_LIMITS = {
  goals: 12,
  hints: 16,
  vocab: 40,
  personas: 6,
  trains: 80,
  shops: 20,
  shows: 80,
  text: 600,
} as const;

/** Records the apps write (a goal on another name could never hold). */
export const KNOWN_RECORDS = ['rail_order', 'rail_passenger', 'ride_order', 'food_order', 'food_address', 'movie_order', 'dine_queue', 'dine_booking', 'transfer', 'qr_payment', 'payment', 'red_packet_opened'] as const;
/** Events the apps emit that goals may check. */
export const KNOWN_EVENTS = ['persona.action', 'persona.message', 'app.open', 'login', 'hint', 'error', 'ride.rated', 'chat.message', 'notification.open'] as const;

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HAN_RE = /[㐀-鿿]/;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown, max: number = SCENARIO_LIMITS.text): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}

function num(v: unknown, min = 0): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min;
}

function bilingual(v: unknown, path: string, out: string[]): void {
  if (!isObj(v)) {
    out.push(`${path}: must be { en, zh }`);
    return;
  }
  if (!str(v.en)) out.push(`${path}.en: required text`);
  if (!str(v.zh)) out.push(`${path}.zh: required text`);
  else if (!HAN_RE.test(v.zh)) out.push(`${path}.zh: must be in Chinese`);
}

function matcherProblems(m: unknown, path: string, out: string[]): void {
  if (m === null || ['string', 'number', 'boolean'].includes(typeof m)) return;
  if (!isObj(m)) {
    out.push(`${path}: a matcher is a value or an object of operators`);
    return;
  }
  const ops = ['eq', 'ne', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'contains', 'every', 'some', 'size', 'exists', 'match', 'has_all'];
  const keys = Object.keys(m);
  if (keys.length === 0) out.push(`${path}: empty matcher`);
  for (const k of keys) if (!ops.includes(k)) out.push(`${path}: unknown operator "${k}"`);
  if (m.in !== undefined && !Array.isArray(m.in)) out.push(`${path}.in: must be a list`);
  if (m.nin !== undefined && !Array.isArray(m.nin)) out.push(`${path}.nin: must be a list`);
  if (m.has_all !== undefined && !Array.isArray(m.has_all)) out.push(`${path}.has_all: must be a list`);
  if (m.every !== undefined) matcherProblems(m.every, `${path}.every`, out);
  if (m.some !== undefined) matcherProblems(m.some, `${path}.some`, out);
  if (m.match !== undefined) whereProblems(m.match, `${path}.match`, out);
}

function whereProblems(w: unknown, path: string, out: string[]): void {
  if (w === undefined) return;
  if (!isObj(w)) {
    out.push(`${path}: must be an object of field → matcher`);
    return;
  }
  for (const [k, v] of Object.entries(w)) matcherProblems(v as Matcher, `${path}.${k}`, out);
}

/** Collects every persona.action the conditions wait for (persona id → action names). */
function conditionProblems(c: unknown, path: string, out: string[], waits: Array<{ persona?: unknown; action?: unknown; path: string }>, depth = 0): void {
  if (depth > 8) {
    out.push(`${path}: nested too deep`);
    return;
  }
  if (!isObj(c)) {
    out.push(`${path}: must be a condition object`);
    return;
  }
  const cond = c as GoalCondition;
  switch (cond.kind) {
    case 'record':
      if (!(KNOWN_RECORDS as readonly string[]).includes(String(cond.record))) out.push(`${path}.record: unknown record "${String(cond.record)}" (one of ${KNOWN_RECORDS.join(', ')})`);
      whereProblems(cond.where, `${path}.where`, out);
      break;
    case 'event':
      if (!(KNOWN_EVENTS as readonly string[]).includes(String(cond.event))) out.push(`${path}.event: unknown event "${String(cond.event)}" (one of ${KNOWN_EVENTS.join(', ')})`);
      whereProblems(cond.where, `${path}.where`, out);
      if (cond.event === 'persona.action' && isObj(cond.where)) waits.push({ persona: cond.where.persona, action: cond.where.action, path });
      break;
    case 'all_of':
    case 'any_of':
      if (!Array.isArray(cond.conditions) || cond.conditions.length === 0) out.push(`${path}.conditions: a non-empty list`);
      else cond.conditions.forEach((x, i) => conditionProblems(x, `${path}.conditions[${i}]`, out, waits, depth + 1));
      break;
    case 'not':
      conditionProblems(cond.condition, `${path}.condition`, out, waits, depth + 1);
      break;
    default:
      out.push(`${path}.kind: one of record, event, all_of, any_of, not`);
  }
}

function personaProblems(p: unknown, i: number, out: string[]): void {
  const path = `personas[${i}]`;
  if (!isObj(p)) {
    out.push(`${path}: must be an object`);
    return;
  }
  if (!str(p.id, 64) || !ID_RE.test(p.id)) out.push(`${path}.id: lowercase id`);
  if (!str(p.name, 40)) out.push(`${path}.name: required`);
  if (!str(p.role)) out.push(`${path}.role: required`);
  if (!str(p.personality)) out.push(`${path}.personality: required`);
  if (!str(p.knows, 1500)) out.push(`${path}.knows: required (what they know, ≤ 1500 characters)`);
  if (p.opening !== undefined && (!str(p.opening, 200) || !HAN_RE.test(p.opening))) out.push(`${path}.opening: a short Chinese message`);
  if (p.actions !== undefined) {
    if (!Array.isArray(p.actions)) out.push(`${path}.actions: a list`);
    else
      p.actions.forEach((a, j) => {
        if (!isObj(a) || !str(a.name, 40) || !/^[a-z][a-z0-9_]*$/.test(a.name)) out.push(`${path}.actions[${j}].name: snake_case name`);
        if (!isObj(a) || !str(a.description)) out.push(`${path}.actions[${j}].description: required`);
        if (isObj(a) && a.params !== undefined && !isObj(a.params)) out.push(`${path}.actions[${j}].params: an object of name → description`);
      });
  }
  if (p.fake_action !== undefined) {
    const names = Array.isArray(p.actions) ? p.actions.map((a) => (isObj(a) ? a.name : null)) : [];
    if (!isObj(p.fake_action) || !names.includes(p.fake_action.name)) out.push(`${path}.fake_action: must name one of its actions`);
  }
}

export function validateScenarioSpec(raw: unknown): string[] {
  const out: string[] = [];
  if (!isObj(raw)) return ['spec: must be an object'];
  const s = raw as unknown as ScenarioSpec;

  if (!str(s.id, 64) || !ID_RE.test(s.id)) out.push('id: lowercase letters, digits, - or _ (≤ 64)');
  if (s.version !== 1) out.push('version: must be 1');
  bilingual(s.title, 'title', out);
  if (!(PHONE_DIFFICULTIES as readonly string[]).includes(s.difficulty)) out.push(`difficulty: one of ${PHONE_DIFFICULTIES.join(', ')}`);
  if (!Array.isArray(s.apps) || s.apps.length === 0) out.push('apps: at least one app');
  else s.apps.forEach((a, i) => !(PHONE_APP_IDS as readonly string[]).includes(a) && out.push(`apps[${i}]: unknown app "${a}" (one of ${PHONE_APP_IDS.join(', ')})`));
  if (!str(s.situation)) out.push('situation: required text');
  bilingual(s.goal, 'goal', out);
  if (s.facts !== undefined) {
    if (!Array.isArray(s.facts)) out.push('facts: a list');
    else s.facts.forEach((f, i) => bilingual(f, `facts[${i}]`, out));
  }
  if (!isDate(s.today)) out.push('today: YYYY-MM-DD');
  if (!isTime(s.now)) out.push('now: HH:MM');

  // Profile + wallet
  if (!isObj(s.profile)) out.push('profile: required');
  else {
    if (!str(s.profile.name, 60)) out.push('profile.name: required');
    if (!str(s.profile.passport_no, 20)) out.push('profile.passport_no: required');
    if (!str(s.profile.nationality, 20)) out.push('profile.nationality: required');
    if (!str(s.profile.phone, 20) || !/^1[3-9]\d{9}$/.test(s.profile.phone)) out.push('profile.phone: an 11-digit mobile number');
  }
  if (!isObj(s.wallet)) out.push('wallet: required');
  else {
    if (!num(s.wallet.balance)) out.push('wallet.balance: a number ≥ 0');
    if (!Array.isArray(s.wallet.cards)) out.push('wallet.cards: a list (may be empty)');
    else s.wallet.cards.forEach((c, i) => {
      if (!isObj(c) || !str(c.id, 40) || !str(c.bank, 20) || !/^\d{4}$/.test(String(c.last4)) || !num(c.balance)) out.push(`wallet.cards[${i}]: { id, bank, kind, last4 (4 digits), balance }`);
    });
    if (typeof s.wallet.pay_password !== 'string' || !/^\d{6}$/.test(s.wallet.pay_password)) out.push('wallet.pay_password: six digits');
  }

  // Worlds per app
  const w: PhoneWorld | null = isObj(s.world) ? (s.world as PhoneWorld) : null;
  if (!w) out.push('world: required');
  const appsNeedingWorld = (Array.isArray(s.apps) ? s.apps : []).filter((a) => a !== 'wallet' && a !== 'sms');
  for (const a of appsNeedingWorld) if (w && !isObj((w as Record<string, unknown>)[a])) out.push(`world.${a}: required because apps includes "${a}"`);

  const personaIds = new Set<string>();
  const personas = Array.isArray(s.personas) ? s.personas : [];
  if (s.personas !== undefined && !Array.isArray(s.personas)) out.push('personas: a list');
  if (personas.length > SCENARIO_LIMITS.personas) out.push(`personas: at most ${SCENARIO_LIMITS.personas}`);
  personas.forEach((p, i) => {
    personaProblems(p, i, out);
    if (isObj(p) && typeof p.id === 'string') {
      if (personaIds.has(p.id)) out.push(`personas[${i}].id: duplicate "${p.id}"`);
      personaIds.add(p.id);
    }
  });
  const needPersona = (id: unknown, path: string) => {
    if (id !== undefined && (typeof id !== 'string' || !personaIds.has(id))) out.push(`${path}: no persona "${String(id)}"`);
  };

  if (w?.rail) {
    const r = w.rail;
    const stations = new Set<string>();
    if (!Array.isArray(r.stations) || r.stations.length < 2) out.push('world.rail.stations: at least two');
    else r.stations.forEach((st, i) => {
      if (!isObj(st) || !str(st.name, 20) || !str(st.city, 20) || !str(st.pinyin, 60)) out.push(`world.rail.stations[${i}]: { name, city, pinyin }`);
      else stations.add(st.name);
    });
    if (!Array.isArray(r.trains) || r.trains.length === 0) out.push('world.rail.trains: at least one');
    else {
      if (r.trains.length > SCENARIO_LIMITS.trains) out.push(`world.rail.trains: at most ${SCENARIO_LIMITS.trains}`);
      const seen = new Set<string>();
      r.trains.forEach((t, i) => {
        const p = `world.rail.trains[${i}]`;
        if (!isObj(t)) return out.push(`${p}: must be an object`);
        if (!str(t.no, 8) || !/^[GCDZTKLY]?\d{1,5}$/.test(t.no)) out.push(`${p}.no: a train number like G7311`);
        if (!isDate(t.date)) out.push(`${p}.date: YYYY-MM-DD`);
        if (!stations.has(t.from)) out.push(`${p}.from: no station "${t.from}"`);
        if (!stations.has(t.to)) out.push(`${p}.to: no station "${t.to}"`);
        if (t.from === t.to) out.push(`${p}: from and to are the same`);
        if (!isTime(t.depart) || !isTime(t.arrive)) out.push(`${p}: depart / arrive HH:MM`);
        if (!Array.isArray(t.seats) || t.seats.length === 0) out.push(`${p}.seats: at least one seat class`);
        else t.seats.forEach((o, j) => {
          if (!isObj(o) || !(RAIL_SEAT_CLASSES as readonly string[]).includes(o.class) || !num(o.price, 0.01) || !num(o.left)) out.push(`${p}.seats[${j}]: { class (${RAIL_SEAT_CLASSES.join('/')}), price, left }`);
        });
        const key = `${t.no}|${t.date}`;
        if (seen.has(key)) out.push(`${p}: duplicate ${t.no} on ${t.date}`);
        seen.add(key);
      });
    }
    const pids = new Set<string>();
    if (!Array.isArray(r.passengers)) out.push('world.rail.passengers: a list (may be empty)');
    else r.passengers.forEach((pa, i) => {
      if (!isObj(pa) || !str(pa.id, 40) || !str(pa.name, 60) || !(RAIL_ID_TYPES as readonly string[]).includes(pa.id_type) || !str(pa.id_no, 20)) out.push(`world.rail.passengers[${i}]: { id, name, id_type, id_no }`);
      else pids.add(pa.id);
    });
    (r.orders ?? []).forEach((o, i) => {
      const p = `world.rail.orders[${i}]`;
      if (!isObj(o) || !str(o.id, 40)) return out.push(`${p}: { id, train_no, date, seat_class, passengers, seats, price_each }`);
      if (!r.trains?.some((t) => t.no === o.train_no && t.date === o.date)) out.push(`${p}: no train ${o.train_no} on ${o.date}`);
      if (!Array.isArray(o.passengers) || o.passengers.some((x) => !pids.has(x))) out.push(`${p}.passengers: passenger ids from world.rail.passengers`);
      if (!Array.isArray(o.seats) || o.seats.length !== (o.passengers?.length ?? -1)) out.push(`${p}.seats: one per passenger`);
      if (!num(o.price_each, 0.01)) out.push(`${p}.price_each: a price`);
    });
  }

  if (w?.ride) {
    const r = w.ride;
    if (!isObj(r.start) || !str(r.start.name, 40)) out.push('world.ride.start: { name, address }');
    if (!Array.isArray(r.pois) || r.pois.length === 0) out.push('world.ride.pois: at least one');
    else r.pois.forEach((p, i) => (!isObj(p) || !str(p.id, 40) || !str(p.name, 40) || !str(p.address, 80) || !num(p.km, 0.1)) && out.push(`world.ride.pois[${i}]: { id, name, address, km }`));
    if (!Array.isArray(r.cars) || r.cars.length === 0) out.push('world.ride.cars: at least one');
    else r.cars.forEach((c, i) => (!isObj(c) || !(RIDE_CAR_TYPES as readonly string[]).includes(c.type) || !num(c.base) || !num(c.per_km) || !num(c.eta_min)) && out.push(`world.ride.cars[${i}]: { type (${RIDE_CAR_TYPES.join('/')}), base, per_km, eta_min }`));
    if (!isObj(r.driver) || !str(r.driver.name, 20) || !str(r.driver.plate, 20) || !str(r.driver.car, 40)) out.push('world.ride.driver: { name, car, plate, rating, trips }');
    else needPersona(r.driver.persona, 'world.ride.driver.persona');
    needPersona(r.arrival_persona, 'world.ride.arrival_persona');
    (r.trips ?? []).forEach((t, i) => {
      if (!isObj(t) || !str(t.id, 40) || !isDate(t.date) || !str(t.from) || !str(t.to)) out.push(`world.ride.trips[${i}]: { id, date, time, from, to, car_type, price, driver }`);
      else if (isObj(t.driver)) needPersona(t.driver.persona, `world.ride.trips[${i}].driver.persona`);
    });
  }

  if (w?.food) {
    const f = w.food;
    if (!Array.isArray(f.shops) || f.shops.length === 0) out.push('world.food.shops: at least one');
    else {
      if (f.shops.length > SCENARIO_LIMITS.shops) out.push(`world.food.shops: at most ${SCENARIO_LIMITS.shops}`);
      f.shops.forEach((sh, i) => {
        const p = `world.food.shops[${i}]`;
        if (!isObj(sh) || !str(sh.id, 40) || !str(sh.name, 30)) return out.push(`${p}: { id, name, … }`);
        if (!num(sh.rating) || sh.rating > 5) out.push(`${p}.rating: 0–5`);
        if (!num(sh.min_order) || !num(sh.delivery_fee) || !num(sh.delivery_min, 1)) out.push(`${p}: min_order, delivery_fee, delivery_min`);
        if (!Array.isArray(sh.menu) || sh.menu.length === 0) out.push(`${p}.menu: at least one category`);
        else sh.menu.forEach((cat, j) => {
          if (!isObj(cat) || !str(cat.category, 20) || !Array.isArray(cat.items) || cat.items.length === 0) return out.push(`${p}.menu[${j}]: { category, items }`);
          cat.items.forEach((it, k) => {
            const ip = `${p}.menu[${j}].items[${k}]`;
            if (!isObj(it) || !str(it.id, 40) || !str(it.name, 30) || !num(it.price, 0.01)) return out.push(`${ip}: { id, name, price }`);
            (it.options ?? []).forEach((g, m) => {
              if (!isObj(g) || !str(g.name, 12) || !Array.isArray(g.choices) || g.choices.length === 0) out.push(`${ip}.options[${m}]: { name, required, choices }`);
            });
          });
        });
        needPersona(sh.persona, `${p}.persona`);
      });
    }
    if (!Array.isArray(f.addresses)) out.push('world.food.addresses: a list (may be empty)');
    needPersona(f.rider_persona, 'world.food.rider_persona');
  }

  if (w?.movie) {
    const m = w.movie;
    const films = new Set((m.films ?? []).map((x) => x?.id));
    const cinemas = new Set((m.cinemas ?? []).map((x) => x?.id));
    if (!Array.isArray(m.films) || m.films.length === 0) out.push('world.movie.films: at least one');
    else m.films.forEach((f, i) => (!isObj(f) || !str(f.id, 40) || !str(f.title, 30) || !num(f.minutes, 30) || !num(f.score)) && out.push(`world.movie.films[${i}]: { id, title, genres, minutes, score }`));
    if (!Array.isArray(m.cinemas) || m.cinemas.length === 0) out.push('world.movie.cinemas: at least one');
    if (!Array.isArray(m.shows) || m.shows.length === 0) out.push('world.movie.shows: at least one');
    else {
      if (m.shows.length > SCENARIO_LIMITS.shows) out.push(`world.movie.shows: at most ${SCENARIO_LIMITS.shows}`);
      m.shows.forEach((sh, i) => {
        const p = `world.movie.shows[${i}]`;
        if (!isObj(sh) || !str(sh.id, 40)) return out.push(`${p}: { id, film, cinema, date, start, hall, format, language, price, seats }`);
        if (!films.has(sh.film)) out.push(`${p}.film: no film "${sh.film}"`);
        if (!cinemas.has(sh.cinema)) out.push(`${p}.cinema: no cinema "${sh.cinema}"`);
        if (!isDate(sh.date) || !isTime(sh.start)) out.push(`${p}: date / start`);
        if (!num(sh.price, 0.01)) out.push(`${p}.price: a price`);
        const map = sh.seats;
        if (!isObj(map) || !num(map.rows, 1) || !num(map.cols, 1) || map.rows > 20 || map.cols > 24) out.push(`${p}.seats: rows 1–20, cols 1–24`);
        else for (const id of [...(map.sold ?? []), ...(map.couple ?? []), ...(map.missing ?? [])]) {
          const ps = parseSeat(id);
          if (!ps || ps.row > map.rows || ps.col > map.cols) out.push(`${p}.seats: bad seat id "${id}" (row-col)`);
        }
      });
    }
  }

  if (w?.dine) {
    const d = w.dine;
    if (!Array.isArray(d.restaurants) || d.restaurants.length === 0) out.push('world.dine.restaurants: at least one');
    else d.restaurants.forEach((r, i) => {
      const p = `world.dine.restaurants[${i}]`;
      if (!isObj(r) || !str(r.id, 40) || !str(r.name, 30) || !num(r.rating) || !num(r.avg_price)) return out.push(`${p}: { id, name, cuisine, rating, avg_price, … }`);
      (r.queue ?? []).forEach((t, j) => (!isObj(t) || !str(t.id, 4) || !num(t.min, 1) || !num(t.max, 1) || t.min > t.max) && out.push(`${p}.queue[${j}]: { id, name, min ≤ max, waiting, minutes }`));
      if (r.booking) {
        if (!Array.isArray(r.booking.dates) || r.booking.dates.some((x) => !isDate(x))) out.push(`${p}.booking.dates: YYYY-MM-DD list`);
        if (!Array.isArray(r.booking.times) || r.booking.times.some((x) => !isTime(x))) out.push(`${p}.booking.times: HH:MM list`);
        if (!num(r.booking.max_people, 1)) out.push(`${p}.booking.max_people: ≥ 1`);
      }
      needPersona(r.persona, `${p}.persona`);
    });
  }

  if (w?.chat) {
    const c = w.chat;
    const contacts = new Set((c.contacts ?? []).map((x) => x?.id));
    if (!isObj(c.me) || !str(c.me.name, 30)) out.push('world.chat.me: { name, id }');
    if (!Array.isArray(c.contacts)) out.push('world.chat.contacts: a list');
    else c.contacts.forEach((x, i) => {
      if (!isObj(x) || !str(x.id, 40) || !str(x.name, 30)) out.push(`world.chat.contacts[${i}]: { id, name }`);
      else needPersona(x.persona, `world.chat.contacts[${i}].persona`);
    });
    (c.threads ?? []).forEach((t, i) => !contacts.has(t?.contact) && out.push(`world.chat.threads[${i}].contact: no contact "${String(t?.contact)}"`));
    (c.qr_codes ?? []).forEach((q, i) => (!isObj(q) || !str(q.id, 40) || !str(q.payee, 30) || !['pay', 'contact'].includes(q.kind)) && out.push(`world.chat.qr_codes[${i}]: { id, payee, label, kind: pay | contact }`));
  }

  // Goals, mistakes, hints
  const waits: Array<{ persona?: unknown; action?: unknown; path: string }> = [];
  if (!Array.isArray(s.goals) || s.goals.length === 0) out.push('goals: at least one');
  else {
    if (s.goals.length > SCENARIO_LIMITS.goals) out.push(`goals: at most ${SCENARIO_LIMITS.goals}`);
    if (!s.goals.some((g) => isObj(g) && !g.optional)) out.push('goals: at least one required (not optional) goal');
    const ids = new Set<string>();
    s.goals.forEach((g, i) => {
      if (!isObj(g) || !str(g.id, 40)) return out.push(`goals[${i}]: { id, label, condition }`);
      if (ids.has(g.id)) out.push(`goals[${i}].id: duplicate "${g.id}"`);
      ids.add(g.id);
      bilingual(g.label, `goals[${i}].label`, out);
      conditionProblems(g.condition, `goals[${i}].condition`, out, waits);
    });
  }
  (s.mistakes ?? []).forEach((m, i) => {
    if (!isObj(m) || !str(m.id, 40)) return out.push(`mistakes[${i}]: { id, label, when }`);
    bilingual(m.label, `mistakes[${i}].label`, out);
    conditionProblems(m.when, `mistakes[${i}].when`, out, []);
  });
  if (!Array.isArray(s.hints) || s.hints.length === 0) out.push('hints: at least one');
  else {
    if (s.hints.length > SCENARIO_LIMITS.hints) out.push(`hints: at most ${SCENARIO_LIMITS.hints}`);
    s.hints.forEach((h, i) => {
      bilingual(h, `hints[${i}]`, out);
      if (isObj(h) && h.done !== undefined) conditionProblems(h.done, `hints[${i}].done`, out, []);
    });
  }
  if (!Array.isArray(s.vocab)) out.push('vocab: a list');
  else {
    if (s.vocab.length > SCENARIO_LIMITS.vocab) out.push(`vocab: at most ${SCENARIO_LIMITS.vocab}`);
    s.vocab.forEach((v, i) => (!isObj(v) || !str(v.hanzi, 20) || !HAN_RE.test(v.hanzi) || !str(v.pinyin, 60) || !str(v.english, 80)) && out.push(`vocab[${i}]: { hanzi, pinyin, english }`));
  }

  // A goal waiting for a persona's action needs that persona and that action.
  for (const wt of waits) {
    if (typeof wt.persona !== 'string') {
      out.push(`${wt.path}: a persona.action condition needs where.persona`);
      continue;
    }
    const p = personas.find((x) => isObj(x) && x.id === wt.persona) as PhonePersona | undefined;
    if (!p) out.push(`${wt.path}: no persona "${wt.persona}"`);
    else if (typeof wt.action === 'string' && !(p.actions ?? []).some((a) => a.name === wt.action)) out.push(`${wt.path}: persona "${wt.persona}" has no action "${wt.action}"`);
  }
  return out;
}
