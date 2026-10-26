/**
 * 饭点外卖 (a fictional food-delivery app in the style of China's delivery apps): 规格 choices,
 * the cart, 起送 / 满减 / 红包 / 包装费 / 配送费, and the order's status timeline. Pure.
 */
import { round2 } from './dates';
import type { FoodItem, FoodRedPacket, FoodShop } from './types';

export interface CartLine {
  /** Item id + the picked options: the same dish with other options is another line. */
  key: string;
  item_id: string;
  name: string;
  /** Unit price including option surcharges. */
  price: number;
  qty: number;
  options: string[];
}

/** Picked option names per group name. */
export type OptionPicks = Record<string, string[]>;

export function optionProblems(item: FoodItem, picks: OptionPicks): string[] {
  const out: string[] = [];
  for (const g of item.options ?? []) {
    const picked = picks[g.name] ?? [];
    if (g.required && picked.length === 0) out.push(`请选择${g.name}`);
    if (!g.multi && picked.length > 1) out.push(`${g.name}只能选一项`);
  }
  return out;
}

export function unitPrice(item: FoodItem, picks: OptionPicks): number {
  let p = item.price;
  for (const g of item.options ?? []) {
    for (const name of picks[g.name] ?? []) p += g.choices.find((c) => c.name === name)?.price ?? 0;
  }
  return round2(p);
}

/** The picked options in menu order (微辣, 加蛋). */
export function pickedList(item: FoodItem, picks: OptionPicks): string[] {
  const out: string[] = [];
  for (const g of item.options ?? []) for (const c of g.choices) if ((picks[g.name] ?? []).includes(c.name)) out.push(c.name);
  return out;
}

export function lineKey(itemId: string, options: string[]): string {
  return `${itemId}|${options.join('/')}`;
}

/** Add one (or `delta`) of a dish with options; lines at 0 are removed. */
export function changeCart(cart: readonly CartLine[], item: FoodItem, options: string[], price: number, delta: number): CartLine[] {
  const key = lineKey(item.id, options);
  const found = cart.find((l) => l.key === key);
  if (!found) return delta > 0 ? [...cart, { key, item_id: item.id, name: item.name, price, qty: delta, options }] : [...cart];
  return cart.map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0);
}

export function cartCount(cart: readonly CartLine[]): number {
  return cart.reduce((n, l) => n + l.qty, 0);
}

export function itemsTotal(cart: readonly CartLine[]): number {
  return round2(cart.reduce((s, l) => s + l.price * l.qty, 0));
}

/** "还差¥5起送" — 0 when the order may be sent. */
export function minOrderGap(shop: FoodShop, cart: readonly CartLine[]): number {
  return round2(Math.max(0, shop.min_order - itemsTotal(cart)));
}

/** The best 满减 that applies to the dishes + packing. */
export function bestDiscount(shop: FoodShop, amount: number): { threshold: number; minus: number } | null {
  const ok = (shop.discounts ?? []).filter((d) => amount >= d.threshold);
  if (ok.length === 0) return null;
  return ok.reduce((a, b) => (b.minus > a.minus ? b : a));
}

/** The next 满减 step not reached yet ("再买¥8可减10"). */
export function nextDiscount(shop: FoodShop, amount: number): { gap: number; minus: number } | null {
  const above = (shop.discounts ?? []).filter((d) => amount < d.threshold).sort((a, b) => a.threshold - b.threshold);
  if (above.length === 0) return null;
  return { gap: round2(above[0].threshold - amount), minus: above[0].minus };
}

export function packingFee(shop: FoodShop, cart: readonly CartLine[]): number {
  return round2((shop.packing_fee ?? 0) * cartCount(cart));
}

export interface CartTotals {
  items: number;
  packing: number;
  delivery: number;
  discount: number;
  red_packet: number;
  red_packet_id: string | null;
  /** 实付. */
  total: number;
}

export function usableRedPackets(packets: readonly FoodRedPacket[] | undefined, amount: number): FoodRedPacket[] {
  return (packets ?? []).filter((p) => amount >= p.threshold).sort((a, b) => b.amount - a.amount);
}

/**
 * The checkout's money: dishes + 包装费, minus the best 满减, minus the chosen 红包 (the best
 * usable one when `redPacketId` is undefined; none when null), plus 配送费.
 */
export function cartTotals(shop: FoodShop, cart: readonly CartLine[], packets?: readonly FoodRedPacket[], redPacketId?: string | null): CartTotals {
  const items = itemsTotal(cart);
  const packing = packingFee(shop, cart);
  const goods = round2(items + packing);
  const discount = bestDiscount(shop, goods)?.minus ?? 0;
  const afterDiscount = round2(goods - discount);
  const usable = usableRedPackets(packets, afterDiscount);
  const rp = redPacketId === null ? null : redPacketId === undefined ? usable[0] ?? null : usable.find((p) => p.id === redPacketId) ?? null;
  const red = rp?.amount ?? 0;
  const delivery = shop.delivery_fee;
  return {
    items,
    packing,
    delivery,
    discount,
    red_packet: red,
    red_packet_id: rp?.id ?? null,
    total: round2(Math.max(0.01, afterDiscount - red + delivery)),
  };
}

export const FOOD_STATUSES = ['unpaid', 'paid', 'accepted', 'cooking', 'picked_up', 'delivering', 'delivered', 'cancelled'] as const;
export type FoodStatus = (typeof FOOD_STATUSES)[number];

export const FOOD_STATUS_ZH: Record<FoodStatus, string> = {
  unpaid: '待支付',
  paid: '等待商家接单',
  accepted: '商家已接单',
  cooking: '商家正在备餐',
  picked_up: '骑手已取餐',
  delivering: '骑手正在送货',
  delivered: '订单已送达',
  cancelled: '订单已取消',
};

/** The status steps after payment, in order. */
export const FOOD_TIMELINE: FoodStatus[] = ['paid', 'accepted', 'cooking', 'picked_up', 'delivering', 'delivered'];

export const FOOD_CUTLERY = ['无需餐具', '1份', '2份', '3份', '4份', '5份及以上'];

export const DEFAULT_NOTE_TAGS = ['不要香菜', '不要葱', '少辣', '多放辣', '少放盐', '不要洋葱', '饭多一点', '汤分开装'];

/** The record an order writes (food_order; field list in doc.ts). */
export function foodOrderData(o: {
  shop: FoodShop;
  cart: readonly CartLine[];
  totals: CartTotals;
  note: string;
  noteTags: string[];
  cutlery: string;
  address: { id: string; label?: string; detail: string; room?: string };
  orderId: string;
  status: FoodStatus;
}): Record<string, unknown> {
  const firstCategory = new Set((o.shop.menu[0]?.items ?? []).map((i) => i.id));
  return {
    order_id: o.orderId,
    shop_id: o.shop.id,
    shop: o.shop.name,
    shop_rating: o.shop.rating,
    shop_minutes: o.shop.delivery_min,
    lines: o.cart.map((l) => ({ item_id: l.item_id, name: l.name, qty: l.qty, options: [...l.options] })),
    main_count: o.cart.filter((l) => firstCategory.has(l.item_id)).reduce((n, l) => n + l.qty, 0),
    item_count: cartCount(o.cart),
    note: [...o.noteTags, o.note.trim()].filter(Boolean).join('，'),
    note_tags: [...o.noteTags],
    cutlery: o.cutlery,
    address_id: o.address.id,
    address_label: o.address.label ?? '',
    address: o.address.room ? `${o.address.detail} ${o.address.room}` : o.address.detail,
    discount: o.totals.discount,
    red_packet: o.totals.red_packet,
    red_packet_id: o.totals.red_packet_id,
    total: o.totals.total,
    status: o.status,
  };
}
