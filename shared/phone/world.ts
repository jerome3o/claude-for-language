/**
 * World helpers: what a scenario starts with in its event log (orders the account already
 * holds), lists that merge the world with what was added on the phone (passengers, addresses),
 * record ids, and the simulated clock. Pure.
 */
import { addDays, minutesOf, timeOf, round2 } from './dates';
import { recordsOf } from './engine';
import { findTrain, windowCount } from './rail';
import type { FoodAddress, PhoneEvent, PhoneRecordEvent, RailPassenger, RailWorld, ScenarioSpec } from './types';

/** "订单号" style ids: the record's prefix + a running number on this phone. */
export function nextRecordId(events: readonly PhoneEvent[], record: string, prefix: string): string {
  const n = recordsOf(events, record).length + 1;
  return `${prefix}${String(n).padStart(3, '0')}`;
}

export function railOrderSeedData(world: RailWorld, seedId: string): Record<string, unknown> | null {
  const o = (world.orders ?? []).find((x) => x.id === seedId);
  if (!o) return null;
  const t = findTrain(world, o.train_no, o.date);
  if (!t) return null;
  const pas = o.passengers.map((id) => world.passengers.find((p) => p.id === id)).filter((p): p is RailPassenger => !!p);
  return {
    order_id: o.id,
    order_no: `E${String(731_204_118 + (world.orders ?? []).indexOf(o) * 7919)}`,
    train_no: o.train_no,
    date: o.date,
    from: t.from,
    to: t.to,
    depart: t.depart,
    arrive: t.arrive,
    seat_class: o.seat_class,
    passengers: pas.map((p) => p.name),
    passenger_ids: pas.map((p) => p.id),
    passenger_nos: pas.map((p) => p.id_no),
    seats: o.seats,
    window_count: windowCount(o.seats),
    together: true,
    price_each: o.price_each,
    total: round2(o.price_each * o.seats.length),
    status: 'paid',
    gate: t.gate ?? '',
    seeded: true,
  };
}

/** The log a scenario starts with. */
export function seedEvents(spec: ScenarioSpec, at: number): PhoneRecordEvent[] {
  const out: PhoneRecordEvent[] = [];
  const rail = spec.world.rail;
  for (const o of rail?.orders ?? []) {
    const data = railOrderSeedData(rail!, o.id);
    if (data) out.push({ type: 'record', record: 'rail_order', id: o.id, data, at });
  }
  return out;
}

/** 常用乘车人: the world's plus those added on the phone (latest version). */
export function railPassengers(world: RailWorld, events: readonly PhoneEvent[]): RailPassenger[] {
  const added = recordsOf(events, 'rail_passenger').map((r) => r.data as unknown as RailPassenger);
  const byId = new Map<string, RailPassenger>();
  for (const p of world.passengers) byId.set(p.id, p);
  for (const p of added) {
    if ((p as RailPassenger & { deleted?: boolean }).deleted) byId.delete(p.id);
    else byId.set(p.id, p);
  }
  return [...byId.values()];
}

export function foodAddresses(saved: readonly FoodAddress[], events: readonly PhoneEvent[]): FoodAddress[] {
  const byId = new Map<string, FoodAddress>();
  for (const a of saved) byId.set(a.id, a);
  for (const r of recordsOf(events, 'food_address')) byId.set(r.id, r.data as unknown as FoodAddress);
  return [...byId.values()];
}

export function addressLine(a: Pick<FoodAddress, 'detail' | 'room'>): string {
  return a.room ? `${a.detail} ${a.room}` : a.detail;
}

/**
 * The phone's clock: the scenario's date + time, moving at real speed from when the play
 * started (a play can run past midnight).
 */
export function phoneClock(spec: Pick<ScenarioSpec, 'today' | 'now'>, startedAt: number, nowMs: number): { date: string; time: string; minutes: number } {
  const elapsed = Math.max(0, Math.floor((nowMs - startedAt) / 60_000));
  const total = minutesOf(spec.now) + elapsed;
  return { date: addDays(spec.today, Math.floor(total / 1440)), time: timeOf(total), minutes: total };
}

/** A six-digit SMS code, stable for the play (so a test can read it from the SMS). */
export function smsCodeFor(seed: number): string {
  return String(100000 + (Math.abs(Math.imul(seed | 0, 2654435761)) % 900000));
}
