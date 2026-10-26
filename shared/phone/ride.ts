/**
 * 招手打车 (a fictional ride-hailing app in the style of China's big ride apps): POI search,
 * price estimates per car type, coupons, and the trip's status line. Pure.
 */
import { round2 } from './dates';
import type { RideCarOffer, RideCarType, RidePoi, RideWorld } from './types';

/** 预估价 for a car type over `km` (rounded to ¥0.1; at least the base fare). */
export function estimatePrice(car: RideCarOffer, km: number): number {
  return Math.round(Math.max(car.base, car.base + car.per_km * km) * 10) / 10;
}

/** Minutes of driving at city speed (~25 km/h), at least 3. */
export function tripMinutes(km: number): number {
  return Math.max(3, Math.round((km / 25) * 60));
}

export function searchPois(pois: readonly RidePoi[], query: string): RidePoi[] {
  const q = query.trim();
  if (!q) return [];
  // Every character of the query in the name / address, in any order ("虹桥火车站" finds 上海虹桥站 too).
  const scored = pois
    .map((p) => {
      const hay = `${p.name}${p.address}${p.district ?? ''}${p.kind ?? ''}`;
      const chars = [...q.replace(/\s+/g, '')];
      const hits = chars.filter((c) => hay.includes(c)).length;
      const whole = p.name.includes(q) ? 100 : hay.includes(q) ? 50 : 0;
      return { p, score: whole + (hits / chars.length) * 40 };
    })
    .filter((x) => x.score >= 30);
  return scored.sort((a, b) => b.score - a.score || a.p.km - b.p.km).map((x) => x.p);
}

export interface RideCoupon {
  id: string;
  name: string;
  amount: number;
  car_type?: RideCarType;
  min_price?: number;
}

/** The best coupon for a car type at a price (the app applies it by itself). */
export function bestCoupon(coupons: readonly RideCoupon[] | undefined, type: RideCarType, price: number): RideCoupon | null {
  const usable = (coupons ?? []).filter((c) => (!c.car_type || c.car_type === type) && price >= (c.min_price ?? 0));
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => (b.amount > a.amount ? b : a));
}

export function priceAfterCoupon(price: number, coupon: RideCoupon | null): number {
  return round2(Math.max(0, price - (coupon?.amount ?? 0)));
}

export function carOffer(world: RideWorld, type: RideCarType): RideCarOffer | undefined {
  return world.cars.find((c) => c.type === type);
}

export const RIDE_STATUSES = ['calling', 'accepted', 'arrived', 'in_trip', 'finished', 'paid', 'cancelled'] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

/** The status line at the top of the trip card. */
export function rideStatusLine(status: RideStatus, etaMin: number): string {
  switch (status) {
    case 'calling':
      return '正在为您呼叫附近的司机…';
    case 'accepted':
      return `司机已接单，正在赶来，约${etaMin}分钟`;
    case 'arrived':
      return '司机已到达上车点，请尽快上车';
    case 'in_trip':
      return '行程中，请系好安全带';
    case 'finished':
      return '已到达目的地，请确认支付';
    case 'paid':
      return '行程已完成，感谢您的乘坐';
    case 'cancelled':
      return '订单已取消';
  }
}

/** 取消订单 after a driver accepted: the cancellation fee once they've driven a while. */
export function cancelFee(status: RideStatus, minutesSinceAccept: number): number {
  if (status === 'calling') return 0;
  if (status === 'arrived') return 5;
  return minutesSinceAccept >= 2 ? 3 : 0;
}

export const RIDE_RATING_TAGS_GOOD = ['车内整洁', '驾驶平稳', '服务热情', '准时到达', '路线熟悉'];
export const RIDE_RATING_TAGS_BAD = ['绕路', '车内有异味', '驾驶不稳', '态度不好', '迟到'];
