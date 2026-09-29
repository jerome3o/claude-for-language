/**
 * Answer matching for a picture hunt: the learner types what they see, this
 * decides which object (if any) it names. Pure — the web app and the Lab app
 * (android-lab/core PictureHuntMatch.kt, parity-tested against this file) give
 * the same verdict for the same input.
 *
 * Accepted:
 * - the object's hanzi or any of its alternatives, after normalising: NFKC
 *   (full-width → half-width), lower case, whitespace and punctuation removed,
 *   common traditional characters → simplified, and a leading numeral /
 *   demonstrative + measure word dropped (一个苹果, 这张桌子 → 苹果, 桌子);
 * - pinyin WITH tones — tone marks (bēizi) or tone numbers (bei1zi) — spaces
 *   ignored. Toneless pinyin is not enough: it comes back as a "close" so the
 *   learner is told to add the tones (or type the characters).
 * - "close": typed hanzi that shares a meaningful character with something
 *   not found yet (杯 for 茶杯) — a nudge, never a find.
 */
import type { HuntObject } from './types';

export type HuntMatch =
  | { kind: 'found'; objectId: string; via: 'hanzi' | 'alternative' | 'pinyin'; typed: string }
  | { kind: 'already'; objectId: string }
  | { kind: 'close'; objectId: string; reason: 'shares_character' | 'missing_tones'; shared: string }
  | { kind: 'empty' }
  | { kind: 'none' };

/**
 * Common traditional characters that turn up in names of everyday things,
 * mapped to simplified. Not a full converter — enough that a learner typing
 * with a traditional IME is not marked wrong for 書 / 車 / 電腦.
 */
const TRAD_TO_SIMP_PAIRS =
  '書书車车門门燈灯電电腦脑視视鐘钟錶表鍋锅盤盘雞鸡魚鱼鳥鸟馬马貓猫紙纸筆笔簾帘櫃柜麵面飯饭蘋苹葉叶樹树園园褲裤襪袜' +
  '錢钱機机們们個个張张隻只條条塊块雙双盞盏臺台輛辆頭头蘿萝蔔卜餅饼湯汤麥麦醬酱鹽盐壺壶爐炉燒烧籃篮鏡镜畫画牆墙樓楼' +
  '開开關关風风傘伞鑰钥鎖锁橋桥鐵铁飛飞雲云陽阳氣气報报話话線线網网鍵键聽听讀读寫写說说見见買买賣卖東东蝦虾貝贝蠟蜡' +
  '燭烛蓋盖廳厅廚厨臥卧廁厕龍龙輪轮號号碼码標标誌志貨货攤摊餃饺醫医藥药櫻樱檸柠鳳凤紅红綠绿藍蓝黃黄顏颜豬猪鴨鸭鵝鹅' +
  '蟲虫籠笼裡里邊边對对備备環环從从會会學学習习題题問问時时間间館馆場场廣广華华國国語语漢汉樣样還还這这過过進进運运' +
  '動动腳脚臉脸髮发衛卫牀床櫥橱屜屉鬧闹鈴铃罐罐壓压厭厌鍾钟銀银鋼钢釘钉針针錄录鞦秋韆千擺摆飾饰牌牌傢家俱具櫥橱窗窗' +
  '廈厦總总統统車车軌轨鐘钟錫锡鉛铅勺勺鑽钻劍剑盃杯碗碗罈坛蓮莲葡葡萄萄瓜瓜橘橘蕉蕉莓莓菇菇蘑蘑薑姜蔥葱蒜蒜筍笋菜菜肉肉';

const TRAD_TO_SIMP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const chars = Array.from(TRAD_TO_SIMP_PAIRS);
  for (let i = 0; i + 1 < chars.length; i += 2) {
    if (chars[i] !== chars[i + 1]) map[chars[i]] = chars[i + 1];
  }
  return map;
})();

/** Characters too common to count as a near miss on their own (桌子 vs 椅子 share 子). */
const STOP_CHARS = new Set(Array.from('子儿头的个一了小大上下里面边'));

const LEADING_MEASURE =
  /^(?:[一二两三四五六七八九十几这那每0-9]+)(?:个|只|张|把|条|本|件|台|辆|双|块|杯|瓶|盏|棵|朵|支|根|顶|头|匹|座|间|扇|面|盘|碗|袋|包|盒|副|枝|片|颗|粒|套|架|盆|幅|位|群|堆|串)/;

const HAN = /[㐀-鿿豈-﫿]/;
const TONE_MARKED: Record<string, [string, number]> = {
  ā: ['a', 1], á: ['a', 2], ǎ: ['a', 3], à: ['a', 4],
  ē: ['e', 1], é: ['e', 2], ě: ['e', 3], è: ['e', 4],
  ī: ['i', 1], í: ['i', 2], ǐ: ['i', 3], ì: ['i', 4],
  ō: ['o', 1], ó: ['o', 2], ǒ: ['o', 3], ò: ['o', 4],
  ū: ['u', 1], ú: ['u', 2], ǔ: ['u', 3], ù: ['u', 4],
  ǖ: ['v', 1], ǘ: ['v', 2], ǚ: ['v', 3], ǜ: ['v', 4],
};

/** Does the text contain a CJK character? */
export function hasHanzi(text: string): boolean {
  return HAN.test(text);
}

/** NFKC, lower case, no whitespace or punctuation / symbols. */
export function stripAnswer(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** Traditional → simplified for the characters in the table; everything else unchanged. */
export function toSimplified(text: string): string {
  let out = '';
  for (const ch of text) out += TRAD_TO_SIMP[ch] ?? ch;
  return out;
}

/** The comparable form of a typed or stored hanzi answer. */
export function normalizeHanziAnswer(text: string): string {
  const s = toSimplified(stripAnswer(text));
  const stripped = s.replace(LEADING_MEASURE, '');
  return stripped.length > 0 ? stripped : s;
}

/**
 * Pinyin as (letters without tones, tone sequence): "chá bēi" and "cha2bei1"
 * both → { letters: "chabei", tones: "21" }. Neutral tones (unmarked, or 5 / 0)
 * are left out of the sequence. ü and v are the same letter.
 */
export function pinyinKey(text: string): { letters: string; tones: string; hasTones: boolean } {
  const s = text.normalize('NFC').toLowerCase();
  let letters = '';
  let tones = '';
  let hasTones = false;
  for (const ch of s) {
    const marked = TONE_MARKED[ch];
    if (marked) {
      letters += marked[0];
      tones += String(marked[1]);
      hasTones = true;
    } else if (ch >= '1' && ch <= '4') {
      tones += ch;
      hasTones = true;
    } else if (ch === '5' || ch === '0') {
      hasTones = true;
    } else if (ch === 'ü') {
      letters += 'v';
    } else if (ch >= 'a' && ch <= 'z') {
      letters += ch;
    }
  }
  return { letters, tones, hasTones };
}

function formsOf(obj: HuntObject): Array<{ form: string; via: 'hanzi' | 'alternative' }> {
  const out: Array<{ form: string; via: 'hanzi' | 'alternative' }> = [];
  const primary = normalizeHanziAnswer(obj.hanzi);
  if (primary) out.push({ form: primary, via: 'hanzi' });
  for (const alt of obj.alternatives ?? []) {
    const form = normalizeHanziAnswer(alt);
    if (form && !out.some((o) => o.form === form)) out.push({ form, via: 'alternative' });
  }
  return out;
}

/**
 * Which object does this answer name? Unfound objects win over found ones
 * (two objects can share an alternative), and within those the primary
 * hanzi wins over an alternative, in object order.
 */
export function matchHuntAnswer(input: string, objects: HuntObject[], foundIds: Iterable<string>): HuntMatch {
  const found = new Set(foundIds);
  const typed = input.trim();
  if (!stripAnswer(typed)) return { kind: 'empty' };

  const ordered = [...objects.filter((o) => !found.has(o.id)), ...objects.filter((o) => found.has(o.id))];

  if (hasHanzi(typed)) {
    const answer = normalizeHanziAnswer(typed);
    for (const via of ['hanzi', 'alternative'] as const) {
      for (const obj of ordered) {
        if (formsOf(obj).some((f) => f.via === via && f.form === answer)) {
          return found.has(obj.id) ? { kind: 'already', objectId: obj.id } : { kind: 'found', objectId: obj.id, via, typed };
        }
      }
    }
    // Near miss: shares a meaningful character with something not found yet.
    const typedChars = new Set(Array.from(answer).filter((c) => HAN.test(c) && !STOP_CHARS.has(c)));
    let best: { obj: HuntObject; shared: string } | null = null;
    for (const obj of objects) {
      if (found.has(obj.id)) continue;
      for (const { form } of formsOf(obj)) {
        const shared = Array.from(new Set(Array.from(form).filter((c) => typedChars.has(c)))).join('');
        if (shared && (!best || shared.length > best.shared.length)) best = { obj, shared };
      }
    }
    if (best) return { kind: 'close', objectId: best.obj.id, reason: 'shares_character', shared: best.shared };
    return { kind: 'none' };
  }

  const key = pinyinKey(typed);
  if (!key.letters) return { kind: 'none' };
  for (const obj of ordered) {
    const target = pinyinKey(obj.pinyin);
    if (target.letters !== key.letters) continue;
    if (!key.hasTones) {
      if (found.has(obj.id)) return { kind: 'already', objectId: obj.id };
      return { kind: 'close', objectId: obj.id, reason: 'missing_tones', shared: '' };
    }
    if (target.tones === key.tones) {
      return found.has(obj.id) ? { kind: 'already', objectId: obj.id } : { kind: 'found', objectId: obj.id, via: 'pinyin', typed };
    }
  }
  return { kind: 'none' };
}

/** Total area of an object's boxes (normalised), for "the most visible first". */
export function objectArea(obj: HuntObject): number {
  return obj.regions.reduce((sum, r) => sum + Math.max(0, r.box.w) * Math.max(0, r.box.h), 0);
}

/**
 * The object the next hint is about: among the ones not found, the one hinted
 * least so far, then the biggest (easiest to spot), then object order.
 * null when everything is found.
 */
export function pickHintTarget(
  objects: HuntObject[],
  foundIds: Iterable<string>,
  hintsGiven: Record<string, number>,
): HuntObject | null {
  const found = new Set(foundIds);
  let best: HuntObject | null = null;
  for (const obj of objects) {
    if (found.has(obj.id)) continue;
    if (!best) {
      best = obj;
      continue;
    }
    const a = hintsGiven[obj.id] ?? 0;
    const b = hintsGiven[best.id] ?? 0;
    if (a < b || (a === b && objectArea(obj) > objectArea(best) + 1e-9)) best = obj;
  }
  return best;
}

/**
 * What a hint shows: level 1 = the first character and a blank per remaining
 * character ("茶＿"), level 2 = the pinyin as well, level 3+ = the English too.
 */
export function hintText(obj: HuntObject, level: number): string {
  const chars = Array.from(obj.hanzi);
  const first = chars[0] + '＿'.repeat(Math.max(0, chars.length - 1));
  if (level <= 1) return first;
  if (level === 2) return `${first} · ${obj.pinyin}`;
  return `${first} · ${obj.pinyin} · ${obj.english}`;
}
