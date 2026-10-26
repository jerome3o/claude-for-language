/**
 * What every bundled scenario shares: the learner's (fictional) profile and wallet, and small
 * builders that keep the world data readable. Names, passports, phone numbers, shops, drivers
 * and banks here are all made up.
 */
import type { Bilingual, PhoneProfile, RailSeatClass, RailSeatOffer, RailTrain, WalletSpec } from '../types';

export const PROFILE: PhoneProfile = {
  name: 'TAYLOR SAM',
  name_zh: '泰山姆',
  passport_no: '548213907',
  nationality: '英国',
  phone: '13916582047',
  gender: '男',
};

export const PAY_PASSWORD = '135790';

export function wallet(balance = 600, cardBalance = 8000): WalletSpec {
  return {
    balance,
    cards: [{ id: 'card1', bank: '城东银行', kind: '储蓄卡', last4: '6215', balance: cardBalance }],
    pay_password: PAY_PASSWORD,
  };
}

export const PASSWORD_FACT: Bilingual = { en: `Your pay password (支付密码) is ${PAY_PASSWORD}.`, zh: `支付密码：${PAY_PASSWORD}` };
export const PASSPORT_FACT: Bilingual = { en: `Your passport: ${PROFILE.name}, No. ${PROFILE.passport_no} (UK).`, zh: `护照：${PROFILE.name}，${PROFILE.passport_no}（英国）` };

/** A train: seats as class → [price, left] (left 0 + `waitlist` → 候补). */
export function train(
  no: string,
  date: string,
  from: string,
  to: string,
  depart: string,
  arrive: string,
  seats: Partial<Record<RailSeatClass, [number, number] | [number, number, 'waitlist']>>,
  extra: Partial<Pick<RailTrain, 'gate' | 'stops'>> = {},
): RailTrain {
  const offers: RailSeatOffer[] = Object.entries(seats).map(([cls, v]) => {
    const [price, left, wl] = v as [number, number, string?];
    return wl ? { class: cls as RailSeatClass, price, left, waitlist: true } : { class: cls as RailSeatClass, price, left };
  });
  return { no, date, from, to, depart, arrive, seats: offers, ...extra };
}
