/**
 * The simulated apps' names, icons and colours — all FICTIONAL (never a real app's name,
 * logo or brand colour pairing), with the flows and copy of the real apps of each kind — and
 * the shared Chinese UI strings several apps use. No English ever appears inside the
 * simulated UI; the English lives in the task card, hints and summary only.
 */
import type { PhoneAppId } from './types';

export interface PhoneAppMeta {
  id: PhoneAppId;
  /** The app's name under its icon. */
  name: string;
  /** What kind of app it is, for the scenario list (English). */
  kind_en: string;
  /** The glyph drawn on the icon. */
  glyph: string;
  /** Icon background (two-stop gradient) and the app's accent colour. */
  colors: [string, string];
  accent: string;
}

export const PHONE_APPS: Record<PhoneAppId, PhoneAppMeta> = {
  rail: { id: 'rail', name: '铁路出行', kind_en: 'Train tickets', glyph: '铁', colors: ['#2f7de1', '#1f5fb8'], accent: '#2f7de1' },
  ride: { id: 'ride', name: '招手打车', kind_en: 'Ride hailing', glyph: '招', colors: ['#ff8a3d', '#f2611c'], accent: '#f2611c' },
  food: { id: 'food', name: '饭点外卖', kind_en: 'Food delivery', glyph: '饭', colors: ['#ffd23f', '#f5b400'], accent: '#f5b400' },
  movie: { id: 'movie', name: '爆米花电影', kind_en: 'Cinema tickets', glyph: '影', colors: ['#ff5a5f', '#d93848'], accent: '#e23d4b' },
  dine: { id: 'dine', name: '吃喝玩乐', kind_en: 'Restaurants & reviews', glyph: '吃', colors: ['#ff7a45', '#e8542a'], accent: '#ee5a2c' },
  chat: { id: 'chat', name: '微聊', kind_en: 'Messenger', glyph: '聊', colors: ['#2fc26b', '#19a356'], accent: '#19a356' },
  wallet: { id: 'wallet', name: '安付钱包', kind_en: 'Wallet', glyph: '付', colors: ['#3a8ef6', '#2463d8'], accent: '#2463d8' },
  sms: { id: 'sms', name: '信息', kind_en: 'Messages', glyph: '信', colors: ['#5fd068', '#3cae47'], accent: '#3cae47' },
};

/** Apps on the home screen in this order (dock last). */
export const HOME_SCREEN_ORDER: PhoneAppId[] = ['rail', 'ride', 'food', 'movie', 'dine', 'wallet'];
export const DOCK_ORDER: PhoneAppId[] = ['chat', 'sms'];

/** Shared strings (one place, so the apps phrase the same thing the same way). */
export const ZH = {
  back: '返回',
  cancel: '取消',
  confirm: '确定',
  ok: '我知道了',
  done: '完成',
  save: '保存',
  search: '搜索',
  submitOrder: '提交订单',
  payNow: '立即支付',
  paySuccess: '支付成功',
  payFailed: '支付失败',
  wrongPassword: (left: number) => `支付密码错误，你还可以输入${left}次`,
  locked: '支付密码错误次数过多，请稍后再试',
  insufficient: '余额不足，请选择其他付款方式',
  enterPassword: '请输入支付密码',
  forgotPassword: '忘记密码？',
  payMethod: '付款方式',
  balance: '零钱',
  notOpen: '该功能暂未开放',
  loading: '加载中…',
  noNetwork: '网络连接失败，请检查网络设置',
  needsConnection: '对方暂时无法回复（需要联网）',
  orderPaid: '已支付',
  orderUnpaid: '待支付',
  orderCancelled: '已取消',
  orderDone: '已完成',
  orderRefunded: '已退票',
  sendSms: '获取验证码',
  smsSent: (s: number) => `${s}秒后重新获取`,
  wrongCode: '验证码错误，请重新输入',
  phonePlaceholder: '请输入手机号',
  codePlaceholder: '请输入验证码',
  badPhone: '请输入正确的手机号码',
  inputPlaceholder: '请输入',
  voiceListening: '正在听…',
  voiceTapToStop: '说完了点击结束',
} as const;

/** SMS / push copy the apps send (【app】 prefix like real Chinese SMS). */
export function smsCode(app: PhoneAppId, code: string): string {
  return `【${PHONE_APPS[app].name}】您的验证码为${code}，5分钟内有效。请勿泄露给他人，如非本人操作请忽略本短信。`;
}
