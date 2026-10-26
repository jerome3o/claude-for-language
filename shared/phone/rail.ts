/**
 * 铁路出行 (a fictional rail-ticket app in the style of China's national rail app): the pure
 * rules its screens use — train kinds, the station search (汉字 / 拼音 / 简拼), the train list,
 * seats left, the seat map letters, seat assignment, passenger checks, 退票 fees and 改签.
 * Rules follow how the real system works (退票费 by hours before departure, one 改签, seats
 * A–F with no E, A/F by the window).
 */
import { daysBetween, minutesOf, minutesUntil, round2, spanMinutes } from './dates';
import type { PhoneRecord, RailIdType, RailPassenger, RailSeatClass, RailStation, RailTrain, RailWorld } from './types';

export type TrainKind = '高铁' | '城际' | '动车' | '直达' | '特快' | '快速' | '普通';

export function trainKind(no: string): TrainKind {
  switch (no.charAt(0).toUpperCase()) {
    case 'G':
      return '高铁';
    case 'C':
      return '城际';
    case 'D':
      return '动车';
    case 'Z':
      return '直达';
    case 'T':
      return '特快';
    case 'K':
      return '快速';
    default:
      return '普通';
  }
}

/** G / C / D trains (the list's 高铁动车 filter). */
export function isHighSpeed(no: string): boolean {
  return /^[GCD]/i.test(no);
}

export function stationInitials(s: RailStation): string {
  return s.pinyin
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0))
    .join('')
    .toLowerCase();
}

/** The station picker's search: 汉字 (name or city), full pinyin, or 简拼 initials. */
export function searchStations(stations: readonly RailStation[], query: string): RailStation[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return [];
  return stations.filter((s) => {
    if (s.name.includes(query.trim()) || s.city.includes(query.trim())) return true;
    const full = s.pinyin.replace(/\s+/g, '').toLowerCase();
    return full.startsWith(q) || stationInitials(s).startsWith(q);
  });
}

/** A place typed in 出发地 / 到达地 is a station or a whole city (上海 = every 上海 station). */
export function stationMatches(stations: readonly RailStation[], place: string, station: string): boolean {
  if (place === station) return true;
  const s = stations.find((x) => x.name === station);
  return !!s && s.city === place;
}

/** The city a picked place belongs to (a station's city, or the place itself). */
export function cityOf(stations: readonly RailStation[], place: string): string {
  return stations.find((s) => s.name === place)?.city ?? place;
}

export type TrainSort = 'depart' | 'duration' | 'price';

export interface TrainFilter {
  highSpeedOnly?: boolean;
  /** Only trains with a seat (候补 hidden). */
  availableOnly?: boolean;
  sort?: TrainSort;
}

export function trainMinutes(t: RailTrain): number {
  return spanMinutes(t.depart, t.arrive);
}

export function cheapestPrice(t: RailTrain): number {
  return Math.min(...t.seats.map((s) => s.price));
}

/** The 车次列表 for a search. */
export function searchTrains(world: RailWorld, from: string, to: string, date: string, filter: TrainFilter = {}, records: readonly PhoneRecord[] = []): RailTrain[] {
  let list = world.trains.filter((t) => t.date === date && stationMatches(world.stations, from, t.from) && stationMatches(world.stations, to, t.to));
  if (filter.highSpeedOnly) list = list.filter((t) => isHighSpeed(t.no));
  if (filter.availableOnly) list = list.filter((t) => t.seats.some((s) => seatsLeft(t, s.class, records) > 0));
  const sort = filter.sort ?? 'depart';
  return [...list].sort((a, b) => {
    if (sort === 'duration') return trainMinutes(a) - trainMinutes(b) || minutesOf(a.depart) - minutesOf(b.depart);
    if (sort === 'price') return cheapestPrice(a) - cheapestPrice(b) || minutesOf(a.depart) - minutesOf(b.depart);
    return minutesOf(a.depart) - minutesOf(b.depart);
  });
}

/** Orders still holding seats (unpaid within the lock, or paid). */
function holdsSeats(r: PhoneRecord): boolean {
  return r.record === 'rail_order' && (r.data.status === 'paid' || r.data.status === 'unpaid');
}

/** Seats left of a class, after the orders made on this phone. */
export function seatsLeft(t: RailTrain, cls: RailSeatClass, records: readonly PhoneRecord[] = []): number {
  const offer = t.seats.find((s) => s.class === cls);
  if (!offer) return 0;
  const booked = records
    .filter((r) => holdsSeats(r) && r.data.train_no === t.no && r.data.date === t.date && r.data.seat_class === cls)
    .reduce((n, r) => n + (Array.isArray(r.data.passengers) ? r.data.passengers.length : 0), 0);
  return Math.max(0, offer.left - booked);
}

/** How the list shows seats left: 有 (20+), 12张 / 12, 候补, 无. */
export function seatsLabel(left: number, waitlist?: boolean): string {
  if (left >= 20) return '有';
  if (left > 0) return `${left}张`;
  return waitlist ? '候补' : '无';
}

/** Seat letters per class, left to right, with the aisle after `aisleAfter`. No E (and no B outside 二等座). */
export function seatLetters(cls: RailSeatClass): { letters: string[]; aisleAfter: string } | null {
  if (cls === '二等座') return { letters: ['A', 'B', 'C', 'D', 'F'], aisleAfter: 'C' };
  if (cls === '一等座') return { letters: ['A', 'C', 'D', 'F'], aisleAfter: 'C' };
  if (cls === '商务座') return { letters: ['A', 'C', 'F'], aisleAfter: 'C' };
  return null; // 卧铺 / 硬座 / 无座: no 选座
}

export const WINDOW_LETTERS = ['A', 'F'];

export function isWindow(letter: string): boolean {
  return WINDOW_LETTERS.includes(letter.toUpperCase());
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const COACH_RANGE: Partial<Record<RailSeatClass, [number, number]>> = {
  商务座: [1, 1],
  一等座: [2, 3],
  二等座: [4, 8],
  软卧: [9, 10],
  硬卧: [11, 14],
  硬座: [4, 8],
  无座: [4, 8],
};

/**
 * Seats for an order: "05车07F". Chosen letters are kept (in one row, as the real 选座 does);
 * with no choice the system picks aisle / middle seats. 无座 gets "05车 无座号". Deterministic
 * for the order id, so the same order always shows the same seats.
 */
export function assignSeats(train: RailTrain, cls: RailSeatClass, count: number, chosen: string[], orderId: string): string[] {
  const [lo, hi] = COACH_RANGE[cls] ?? [4, 8];
  const h = hash(`${train.no}|${train.date}|${orderId}`);
  const coach = String(lo + (h % (hi - lo + 1))).padStart(2, '0');
  if (cls === '无座') return Array.from({ length: count }, () => `${coach}车 无座`);
  const layout = seatLetters(cls);
  if (!layout) {
    // Berths / hard seats: a number each.
    const start = 1 + (h % 40);
    return Array.from({ length: count }, (_, i) => `${coach}车${String(start + i).padStart(3, '0')}号`);
  }
  const row = 1 + (h % 16);
  const picked = chosen.filter((l) => layout.letters.includes(l)).slice(0, count);
  const pool = [...layout.letters.filter((l) => !isWindow(l) && !picked.includes(l)), ...layout.letters.filter((l) => isWindow(l) && !picked.includes(l))];
  const out = picked.map((l) => `${coach}车${String(row).padStart(2, '0')}${l}`);
  let k = 0;
  while (out.length < count) {
    // More travellers than one row has: carry on in the next row.
    const r = row + Math.floor((picked.length + k) / layout.letters.length);
    const l = k < pool.length ? pool[k] : layout.letters[(k - pool.length) % layout.letters.length];
    out.push(`${coach}车${String(r).padStart(2, '0')}${l}`);
    k++;
  }
  return out;
}

export function seatLetterOf(seat: string): string | null {
  const m = /([A-F])$/.exec(seat);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Passengers
// ---------------------------------------------------------------------------

/** 18-digit 身份证 check digit. */
export function validChineseId(id: string): boolean {
  if (!/^\d{17}[\dXx]$/.test(id)) return false;
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const codes = '10X98765432';
  const sum = w.reduce((s, wi, i) => s + wi * Number(id[i]), 0);
  return codes[sum % 11] === id[17].toUpperCase();
}

export function validPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone.replace(/\s+/g, ''));
}

/** Form errors in the order the app shows them (first one is the toast). */
export function passengerProblems(p: Partial<RailPassenger>, existing: readonly RailPassenger[] = []): string[] {
  const out: string[] = [];
  const name = (p.name ?? '').trim();
  const type = p.id_type as RailIdType | undefined;
  if (!type) out.push('请选择证件类型');
  if (!name) out.push('请输入姓名');
  else if (type === '中国居民身份证' && !/^[一-龥·]{2,15}$/.test(name)) out.push('姓名填写有误，请输入证件上的姓名');
  else if (type === '护照' && !/^[A-Za-z一-龥][A-Za-z一-龥 .·'-]{1,40}$/.test(name)) out.push('姓名填写有误，请输入证件上的姓名');
  const no = (p.id_no ?? '').trim();
  if (!no) out.push('请输入证件号码');
  else if (type === '中国居民身份证' && !validChineseId(no)) out.push('请输入正确的身份证号码');
  else if (type !== '中国居民身份证' && !/^[A-Za-z0-9]{5,17}$/.test(no)) out.push('请输入正确的证件号码');
  if ((type === '护照' || type === '外国人永久居留身份证') && !p.country) out.push('请选择国家/地区');
  if (p.phone && !validPhone(p.phone)) out.push('请输入正确的手机号码');
  if (no && existing.some((e) => e.id_no.toUpperCase() === no.toUpperCase() && e.id !== p.id)) out.push('该乘车人已存在，请勿重复添加');
  return out;
}

/** Passport names are written upper case, surname first (SMITH ANNA). */
export function normalizePassportName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toUpperCase();
}

// ---------------------------------------------------------------------------
// 退票 / 改签
// ---------------------------------------------------------------------------

/**
 * 退票费 by time before departure (the real rule): 8 days or more free; 48 h – 8 days 5 %;
 * 24 – 48 h 10 %; under 24 h 20 %; rounded down to ¥0.5, at least ¥2 when a fee is due.
 * null = the train has left (no refund on the phone).
 */
export function refundFee(price: number, today: string, now: string, date: string, depart: string): number | null {
  const mins = minutesUntil(today, now, date, depart);
  if (mins <= 0) return null;
  const hours = mins / 60;
  const rate = hours >= 192 ? 0 : hours >= 48 ? 0.05 : hours >= 24 ? 0.1 : 0.2;
  if (rate === 0) return 0;
  const fee = Math.floor(price * rate * 2) / 2;
  return Math.min(price, Math.max(2, fee));
}

export function refundRateLabel(today: string, now: string, date: string, depart: string): string {
  const mins = minutesUntil(today, now, date, depart);
  const hours = mins / 60;
  if (mins <= 0) return '已过开车时间';
  if (hours >= 192) return '开车前8天（含）以上，不收取退票费';
  if (hours >= 48) return '开车前48小时以上不足8天，按票价5%计收退票费';
  if (hours >= 24) return '开车前24小时以上不足48小时，按票价10%计收退票费';
  return '开车前不足24小时，按票价20%计收退票费';
}

/** Trains a ticket can be changed to: same stations, not yet departed, a later or the same date. */
export function changeOptions(world: RailWorld, order: { train_no: string; date: string; from: string; to: string }, today: string, now: string): RailTrain[] {
  return world.trains.filter(
    (t) =>
      t.from === order.from &&
      t.to === order.to &&
      !(t.no === order.train_no && t.date === order.date) &&
      minutesUntil(today, now, t.date, t.depart) > 0 &&
      daysBetween(today, t.date) <= 14,
  );
}

/** 改签 money: positive = pay the difference, negative = refunded to you. */
export function changeDifference(oldTotal: number, newTotal: number): number {
  return round2(newTotal - oldTotal);
}

/** "G7311" + date → the train. */
export function findTrain(world: RailWorld, no: string, date: string): RailTrain | undefined {
  return world.trains.find((t) => t.no === no && t.date === date);
}

/** The window seats in an order's seats. */
export function windowCount(seats: readonly string[]): number {
  return seats.filter((s) => {
    const l = seatLetterOf(s);
    return !!l && isWindow(l);
  }).length;
}

/** Two or more seats in one row, all on one side of the aisle (A–C or D–F). */
export function seatsTogether(seats: readonly string[]): boolean {
  if (seats.length < 2) return seats.length === 1;
  const parsed = seats.map((s) => /^(\d+)车(\d+)([A-F])$/.exec(s));
  if (parsed.some((m) => !m)) return false;
  const coach = parsed[0]![1];
  const row = parsed[0]![2];
  if (parsed.some((m) => m![1] !== coach || m![2] !== row)) return false;
  const sides = new Set(parsed.map((m) => ('ABC'.includes(m![3]) ? 'L' : 'R')));
  return sides.size === 1;
}

/** The record an order writes (rail_order; field list in doc.ts). */
export function railOrderData(o: {
  train: RailTrain;
  seatClass: RailSeatClass;
  passengers: readonly RailPassenger[];
  seats: string[];
  orderId: string;
  orderNo: string;
  status: 'unpaid' | 'paid';
  changedFrom?: string;
}): Record<string, unknown> {
  const offer = o.train.seats.find((s) => s.class === o.seatClass);
  const each = offer?.price ?? 0;
  const data: Record<string, unknown> = {
    order_id: o.orderId,
    order_no: o.orderNo,
    train_no: o.train.no,
    date: o.train.date,
    from: o.train.from,
    to: o.train.to,
    depart: o.train.depart,
    arrive: o.train.arrive,
    seat_class: o.seatClass,
    passengers: o.passengers.map((p) => p.name),
    passenger_ids: o.passengers.map((p) => p.id),
    passenger_nos: o.passengers.map((p) => p.id_no),
    seats: o.seats,
    window_count: windowCount(o.seats),
    together: seatsTogether(o.seats),
    price_each: each,
    total: round2(each * o.passengers.length),
    status: o.status,
    gate: o.train.gate ?? '',
  };
  if (o.changedFrom) data.changed_from = o.changedFrom;
  return data;
}
