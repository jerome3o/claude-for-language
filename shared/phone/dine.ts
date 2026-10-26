/**
 * 吃喝玩乐 (a fictional restaurant-guide app in the style of China's review / booking apps):
 * 排队取号 (which table type a party gets, the ticket number, the wait) and 订座 (full slots,
 * party size, private rooms with a minimum spend). Pure.
 */
import type { DineQueueTable, DineRestaurant, PhoneRecord } from './types';

export function queueTableFor(tables: readonly DineQueueTable[], people: number): DineQueueTable | null {
  return tables.find((t) => people >= t.min && people <= t.max) ?? null;
}

/** "B024": the table type's letter and the next number after those waiting (+ tickets taken here). */
export function queueTicket(table: DineQueueTable, takenHere: number): { number: string; ahead: number; minutes: number } {
  const ahead = table.waiting + takenHere;
  const n = 10 + table.waiting * 2 + takenHere + 1;
  const per = table.waiting > 0 ? table.minutes / table.waiting : 3;
  return { number: `${table.id}${String(n).padStart(3, '0')}`, ahead, minutes: Math.round(ahead * per) };
}

export function slotFull(r: DineRestaurant, date: string, time: string): boolean {
  return (r.booking?.full ?? []).includes(`${date} ${time}`);
}

/** Queue tickets already taken here for a table type (they stand in line too). */
export function ticketsTaken(records: readonly PhoneRecord[], restaurantId: string, tableId: string): number {
  return records.filter((r) => r.record === 'dine_queue' && r.data.restaurant_id === restaurantId && r.data.table_id === tableId).length;
}

export interface BookingDraft {
  date?: string;
  time?: string;
  people?: number;
  area?: '大厅' | '包间';
  name?: string;
  title?: '先生' | '女士';
  phone?: string;
}

export function bookingProblems(r: DineRestaurant, d: BookingDraft): string[] {
  const out: string[] = [];
  const b = r.booking;
  if (!b) return ['该商家暂不支持在线订座'];
  if (!d.date) out.push('请选择用餐日期');
  if (!d.time) out.push('请选择到店时间');
  else if (d.date && slotFull(r, d.date, d.time)) out.push('该时段已订满，请选择其他时间');
  if (!d.people || d.people < 1) out.push('请选择用餐人数');
  else if (d.people > b.max_people) out.push(`在线最多预订${b.max_people}人，更多人数请致电商家`);
  if (d.area === '包间') {
    if (!b.rooms) out.push('该商家暂无包间');
    else if ((d.people ?? 0) < b.rooms.min_people) out.push(`包间${b.rooms.min_people}人起订`);
  }
  if (!d.name?.trim()) out.push('请填写联系人姓名');
  if (!d.phone || !/^1[3-9]\d{9}$/.test(d.phone.replace(/\s+/g, ''))) out.push('请输入正确的手机号码');
  return out;
}

/** 4.6 → ★★★★½ style: full stars + half. */
export function starParts(rating: number): { full: number; half: boolean } {
  const r = Math.max(0, Math.min(5, rating));
  const full = Math.floor(r);
  return { full, half: r - full >= 0.5 };
}
