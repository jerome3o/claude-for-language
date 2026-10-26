/**
 * 爆米花电影 (a fictional cinema-ticket app in the style of China's ticketing apps): show lists,
 * the seat map and its rules — at most 4 seats, 情侣座 come in pairs, and the real apps' "don't
 * leave a single empty seat" rule ("左右不能留空座") — and seat labels. Seat ids are "排-座"
 * (row-seat, 1-based): "7-8" is 7排8座. Pure.
 */
import { minutesOf } from './dates';
import type { MovieSeatMap, MovieShow, MovieWorld, PhoneRecord } from './types';

export const MAX_MOVIE_SEATS = 4;

export function seatId(row: number, col: number): string {
  return `${row}-${col}`;
}

export function parseSeat(id: string): { row: number; col: number } | null {
  const m = /^(\d+)-(\d+)$/.exec(id);
  return m ? { row: Number(m[1]), col: Number(m[2]) } : null;
}

/** 7排8座 */
export function seatLabel(id: string): string {
  const p = parseSeat(id);
  return p ? `${p.row}排${p.col}座` : id;
}

export function seatExists(map: MovieSeatMap, id: string): boolean {
  const p = parseSeat(id);
  return !!p && p.row >= 1 && p.row <= map.rows && p.col >= 1 && p.col <= map.cols && !(map.missing ?? []).includes(id);
}

/** Seats sold in the world plus those bought on this phone. */
export function soldSeats(show: MovieShow, records: readonly PhoneRecord[] = []): Set<string> {
  const s = new Set(show.seats.sold ?? []);
  for (const r of records) {
    if (r.record === 'movie_order' && r.data.show_id === show.id && (r.data.status === 'paid' || r.data.status === 'unpaid') && Array.isArray(r.data.seat_ids)) {
      for (const id of r.data.seat_ids as string[]) s.add(id);
    }
  }
  return s;
}

/** The couple pair a seat belongs to ([left, right]) or null. */
export function couplePair(map: MovieSeatMap, id: string): [string, string] | null {
  const p = parseSeat(id);
  if (!p) return null;
  for (const left of map.couple ?? []) {
    const l = parseSeat(left);
    if (!l || l.row !== p.row) continue;
    if (l.col === p.col || l.col + 1 === p.col) return [left, seatId(l.row, l.col + 1)];
  }
  return null;
}

/** Tap a seat: the new selection (a couple seat toggles its pair), or a problem (the toast). */
export function toggleSeat(map: MovieSeatMap, sold: ReadonlySet<string>, selected: readonly string[], id: string): { selected: string[]; problem: string | null } {
  if (!seatExists(map, id) || sold.has(id)) return { selected: [...selected], problem: sold.has(id) ? '该座位已售出' : null };
  const pair = couplePair(map, id);
  const group = pair ?? [id];
  const on = group.every((g) => selected.includes(g));
  if (on) return { selected: selected.filter((s) => !group.includes(s)), problem: null };
  if (group.some((g) => sold.has(g))) return { selected: [...selected], problem: '该座位已售出' };
  const next = [...selected.filter((s) => !group.includes(s)), ...group];
  if (next.length > MAX_MOVIE_SEATS) return { selected: [...selected], problem: `一次最多选择${MAX_MOVIE_SEATS}个座位` };
  return { selected: next, problem: null };
}

/** Columns split into blocks by the aisles (1-based columns). */
function blocks(map: MovieSeatMap): Array<[number, number]> {
  const cuts = [...(map.aisles_after ?? [])].filter((c) => c > 0 && c < map.cols).sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  let start = 1;
  for (const c of cuts) {
    out.push([start, c]);
    start = c + 1;
  }
  out.push([start, map.cols]);
  return out;
}

/**
 * The "don't leave one empty seat" rule: a selection that leaves a single free seat beside one
 * of the chosen seats (between it and a sold seat, another chosen seat or the end of the block)
 * is refused. Couple seats are never split anyway.
 */
export function singleGapProblem(map: MovieSeatMap, sold: ReadonlySet<string>, selected: readonly string[]): string | null {
  const chosen = new Set(selected);
  const rows = new Set(selected.map((s) => parseSeat(s)?.row).filter((r): r is number => !!r));
  for (const row of rows) {
    for (const [a, b] of blocks(map)) {
      // Seats of the block that exist, in order.
      const cols: number[] = [];
      for (let c = a; c <= b; c++) if (seatExists(map, seatId(row, c))) cols.push(c);
      const taken = cols.map((c) => sold.has(seatId(row, c)) || chosen.has(seatId(row, c)));
      for (let i = 0; i < cols.length; i++) {
        if (taken[i]) continue;
        const leftTaken = i === 0 || taken[i - 1];
        const rightTaken = i === cols.length - 1 || taken[i + 1];
        if (!leftTaken || !rightTaken) continue;
        // A lone empty seat: refused only when one of OUR seats is next to it.
        const nextToMine = (i > 0 && chosen.has(seatId(row, cols[i - 1]))) || (i < cols.length - 1 && chosen.has(seatId(row, cols[i + 1])));
        if (nextToMine) return '座位旁边不要留下单个空座哦';
      }
    }
  }
  return null;
}

/** All chosen seats in one row, side by side within one block. */
export function seatsAdjacent(map: MovieSeatMap, selected: readonly string[]): boolean {
  if (selected.length < 2) return selected.length === 1;
  const ps = selected.map(parseSeat);
  if (ps.some((p) => !p)) return false;
  const row = ps[0]!.row;
  if (ps.some((p) => p!.row !== row)) return false;
  const cols = ps.map((p) => p!.col).sort((x, y) => x - y);
  const blk = blocks(map).find(([a, b]) => cols[0] >= a && cols[0] <= b);
  if (!blk || cols[cols.length - 1] > blk[1]) return false;
  return cols.every((c, i) => i === 0 || c === cols[i - 1] + 1);
}

export function isCoupleSeat(map: MovieSeatMap, id: string): boolean {
  return couplePair(map, id) !== null;
}

/** Shows of a film on a day at a cinema (or all cinemas), by start time. */
export function showsFor(world: MovieWorld, filmId: string, date: string, cinemaId?: string): MovieShow[] {
  return world.shows
    .filter((s) => s.film === filmId && s.date === date && (!cinemaId || s.cinema === cinemaId))
    .sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
}

/** End time of a show (film length + ~10 minutes of adverts, as the apps print 散场). */
export function showEnd(world: MovieWorld, show: MovieShow): string {
  const film = world.films.find((f) => f.id === show.film);
  const m = minutesOf(show.start) + (film?.minutes ?? 120) + 10;
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 取票码: 4+4 digits, stable per order. */
export function ticketCode(orderId: string): string {
  let h = 7;
  for (const ch of orderId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const s = String(h % 100_000_000).padStart(8, '0');
  return `${s.slice(0, 4)} ${s.slice(4)}`;
}

/** The record an order writes (movie_order; field list in doc.ts). */
export function movieOrderData(o: {
  world: MovieWorld;
  show: MovieShow;
  seatIds: string[];
  snacks: Array<{ name: string; price: number; qty: number }>;
  orderId: string;
  status: 'unpaid' | 'paid';
}): Record<string, unknown> {
  const film = o.world.films.find((f) => f.id === o.show.film);
  const cinema = o.world.cinemas.find((c) => c.id === o.show.cinema);
  const ids = [...o.seatIds].sort((a, b) => {
    const pa = parseSeat(a)!;
    const pb = parseSeat(b)!;
    return pa.row - pb.row || pa.col - pb.col;
  });
  const snackTotal = o.snacks.reduce((s, x) => s + x.price * x.qty, 0);
  return {
    order_id: o.orderId,
    show_id: o.show.id,
    film_id: o.show.film,
    film: film?.title ?? '',
    cinema_id: o.show.cinema,
    cinema: cinema?.name ?? '',
    cinema_km: cinema?.km ?? 0,
    date: o.show.date,
    start: o.show.start,
    hall: o.show.hall,
    format: o.show.format,
    language: o.show.language,
    seat_ids: ids,
    seats: ids.map(seatLabel),
    seat_count: ids.length,
    adjacent: seatsAdjacent(o.show.seats, ids),
    couple: ids.length > 0 && ids.every((id) => isCoupleSeat(o.show.seats, id)),
    snacks: o.snacks.filter((x) => x.qty > 0).map((x) => x.name),
    total: Math.round((o.show.price * ids.length + snackTotal) * 100) / 100,
    code: ticketCode(o.orderId),
    status: o.status,
  };
}
