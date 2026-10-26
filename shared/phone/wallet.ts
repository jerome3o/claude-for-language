/**
 * 安付钱包 (a fictional wallet in the style of China's mobile wallets) and the one pay sheet
 * every app opens: 付款方式 (零钱 or a bank card), the six-digit 支付密码 (5 tries), balance
 * checks. Balances are derived from the event log (payments are `payment` records). Pure.
 */
import { round2 } from './dates';
import type { PhoneEvent, WalletSpec } from './types';
import { recordsOf } from './engine';

export const MAX_PASSWORD_TRIES = 5;

export type PayMethod = 'balance' | string; // 'balance' or a card id

/** Current balances: 零钱 and each card, after this phone's payments and money received. */
export function walletBalances(wallet: WalletSpec, events: readonly PhoneEvent[]): { balance: number; cards: Record<string, number> } {
  let balance = wallet.balance;
  const cards: Record<string, number> = {};
  for (const c of wallet.cards) cards[c.id] = c.balance;
  for (const r of recordsOf(events, 'payment')) {
    const amount = Number(r.data.amount) || 0;
    const sign = r.data.direction === 'in' ? 1 : -1;
    if (r.data.status === 'refunded' && sign < 0) continue;
    const method = String(r.data.method ?? 'balance');
    if (method === 'balance') balance += sign * amount;
    else if (method in cards) cards[method] += sign * amount;
  }
  for (const k of Object.keys(cards)) cards[k] = round2(cards[k]);
  return { balance: round2(balance), cards };
}

/** Wrong passwords in a row since the last success. */
export function passwordFailures(events: readonly PhoneEvent[]): number {
  let n = 0;
  for (const e of events) {
    if (e.type === 'error' && e.code === 'pay_password') n++;
    if (e.type === 'record' && (e as { record?: string }).record === 'payment') n = 0;
  }
  return n;
}

export function methodLabel(wallet: WalletSpec, method: PayMethod): string {
  if (method === 'balance') return '零钱';
  const c = wallet.cards.find((x) => x.id === method);
  return c ? `${c.bank}${c.kind}(${c.last4})` : '银行卡';
}

export function canPay(wallet: WalletSpec, events: readonly PhoneEvent[], method: PayMethod, amount: number): boolean {
  const b = walletBalances(wallet, events);
  const have = method === 'balance' ? b.balance : b.cards[method] ?? 0;
  return have + 1e-9 >= amount;
}

/** The method the sheet starts on: 零钱 when it covers the amount, else the first card that does. */
export function defaultMethod(wallet: WalletSpec, events: readonly PhoneEvent[], amount: number): PayMethod {
  if (canPay(wallet, events, 'balance', amount)) return 'balance';
  return wallet.cards.find((c) => canPay(wallet, events, c.id, amount))?.id ?? 'balance';
}

/** 转账 / 红包 amount rules (the messenger's). */
export function transferProblem(amount: number, kind: 'transfer' | 'red_packet'): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return '请输入金额';
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return '金额最多保留两位小数';
  if (kind === 'red_packet' && amount > 200) return '单个红包金额不可超过200元';
  if (amount > 50_000) return '超出单笔转账限额';
  return null;
}

/** Parse what was typed on an amount pad ("18.5" → 18.5, "" → 0). */
export function parseAmount(text: string): number {
  const t = text.trim();
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return 0;
  return Number(t);
}

/** The amount pad: append a key ("1", ".", "del") to the typed text with the real rules. */
export function amountKey(text: string, key: string): string {
  if (key === 'del') return text.slice(0, -1);
  if (key === '.') {
    if (text.includes('.')) return text;
    return text === '' ? '0.' : `${text}.`;
  }
  if (!/^\d$/.test(key)) return text;
  if (text === '0') return key;
  const dot = text.indexOf('.');
  if (dot >= 0 && text.length - dot > 2) return text; // two decimals at most
  if (dot < 0 && text.length >= 6) return text;
  return text + key;
}
