/**
 * The textbook tone changes of 一 and 不 in written pinyin — ONE function that
 * every automatic pinyin path runs (the device's pinyin-pro fill on the web,
 * the Lab app's port of it, pinyin Claude writes in the worker, the word
 * checker). Lab port: core/…/ToneChange.kt, parity-tested
 * (android-lab/parity/fixtures/tone-change.ts).
 *
 * pinyin-pro already applies a similar rule by default (`toneSandhi`, on); this
 * function makes the convention ours, works on pinyin from any source (Claude,
 * a pasted list) and is what the checker compares against.
 *
 * The convention:
 * - 一 stays yī alone, at the end of a word or before punctuation, as a number
 *   (十一, 一二三, 万一), an ordinal (第一, 一楼, 一号, 一年级), in dates (一月,
 *   一月一日) and at the end of the fixed words in YI_WORD_FINAL (统一, 唯一, 星期一…).
 * - 一 → yí before a 4th tone (一个, 一样), yì before a 1st / 2nd / 3rd tone
 *   (一天, 一年, 一起). 一百 / 一千 / 一万 count as words: yì bǎi, yì qiān, yí wàn.
 * - Reduplicated verbs A一A (看一看, 想一想): neutral "yi" — the dictionary and
 *   textbook spelling (kàn yi kàn).
 * - 不 → bú before a 4th tone (不是, 不对, 不去), otherwise bù (不好, 对不起 duì bù qǐ).
 *   A不A questions (要不要, 好不好): neutral "bu", like A一A (yào bu yào).
 * - A neutral yi / bu that is already written (duìbuqǐ, kàn yi kàn) is a
 *   dictionary choice and is left alone.
 * - The tone that decides is the next syllable's WRITTEN tone, with 一 counted
 *   as 1st and 不 as 4th (一不小心 → yí, 不一样 → bù yíyàng).
 * - Nothing else changes: no third-tone sandhi (nǐ hǎo stays nǐ hǎo).
 *
 * When the pinyin can't be lined up with the characters (different syllable
 * counts, tone numbers, a Latin letter in the hanzi) the input comes back as is.
 */

export const YI_BU_CONVENTION =
  '一 and 不 are written with their tone changes: 一 is yī alone, at the end of a word, as a number, ordinal or in dates (第一, 十一, 一月一日); yí before a 4th tone (一个 yí gè, 一样 yíyàng), yì before a 1st / 2nd / 3rd tone (一天 yì tiān, 一年 yì nián, 一起 yìqǐ); neutral yi in reduplicated verbs (看一看 kàn yi kàn). 不 is bú before a 4th tone (不是 bú shì, 不对 bú duì), otherwise bù (不好 bù hǎo); neutral bu in A不A questions (要不要 yào bu yào). No other tone changes: third tones stay as written (nǐ hǎo).';

const MARKS: Record<string, [string, number]> = {};
for (const [base, marks] of Object.entries({ a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', ü: 'ǖǘǚǜ' })) {
  [...marks].forEach((m, i) => (MARKS[m] = [base, i + 1]));
}

const DIGITS = new Set([...'零〇一二三四五六七八九十']);
const BIG_NUMBERS = new Set([...'百千万亿']);
/** Characters after which 一 ends a word and stays yī (统一, 唯一, 之一, 初一, 星期一…). */
export const YI_WORD_FINAL = new Set([...'第统唯之初专单划归逐万合纯期']);
/** Ordinal / date words that keep yī before them (一楼, 一号, 一月). */
const YI_ORDINAL_NEXT = new Set([...'楼号月']);

const LETTERS = /[a-zA-ZüÜvVāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ']/;

function isHan(ch: string): boolean {
  return /^\p{Script=Han}$/u.test(ch);
}

/** Tone of one syllable: 1–4 from its mark, 5 = neutral (no mark). */
export function syllableTone(syllable: string): number {
  for (const ch of syllable.normalize('NFC').toLowerCase()) {
    const m = MARKS[ch];
    if (m) return m[1];
  }
  return 5;
}

function plain(syllable: string): string {
  let out = '';
  for (const ch of syllable.normalize('NFC').toLowerCase()) out += MARKS[ch]?.[0] ?? ch;
  return out.replace(/v/g, 'ü');
}

// ---- syllable segmentation (same rules as shared/import/pinyin.ts) ----

const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];
const FINALS = new Set([
  'a', 'o', 'e', 'i', 'u', 'ü', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'er',
  'ia', 'ie', 'iao', 'iu', 'ian', 'in', 'iang', 'ing', 'iong',
  'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang', 'ueng', 'ue', 'üe', 'üan', 'ün',
]);

function isSyllable(s: string): boolean {
  if (!s) return false;
  const core = s.endsWith('r') && s.length > 2 && !FINALS.has(s) && !s.endsWith('er') ? s.slice(0, -1) : s;
  for (const ini of INITIALS) if (core.startsWith(ini) && FINALS.has(core.slice(ini.length))) return true;
  return FINALS.has(core) || core === 'ê' || core === 'r';
}

/** Lengths of the syllables of a letter run (greedy longest with backtracking), or null. */
function segmentLengths(run: string): number[] | null {
  const s = plain(run);
  const memo = new Map<number, number[] | null>();
  const go = (i: number): number[] | null => {
    if (i === s.length) return [];
    if (memo.has(i)) return memo.get(i)!;
    let best: number[] | null = null;
    const skip = s[i] === "'" ? 1 : 0;
    const start = i + skip;
    for (let len = Math.min(7, s.length - start); len >= 1; len--) {
      if (!isSyllable(s.slice(start, start + len))) continue;
      const rest = go(start + len);
      if (rest) {
        best = [skip + len, ...rest];
        break;
      }
    }
    memo.set(i, best);
    return best;
  };
  return go(0);
}

interface Syl {
  start: number;
  end: number;
  text: string;
}

/** Every syllable of a pinyin string with its position, or null when it is not plain tone-marked pinyin. */
function syllablesOf(pinyin: string): Syl[] | null {
  if (/[0-9]/.test(pinyin)) return null;
  const out: Syl[] = [];
  let i = 0;
  while (i < pinyin.length) {
    if (!LETTERS.test(pinyin[i]) || pinyin[i] === "'") {
      i++;
      continue;
    }
    let j = i;
    while (j < pinyin.length && LETTERS.test(pinyin[j])) j++;
    const run = pinyin.slice(i, j);
    const lengths = segmentLengths(run);
    if (!lengths) return null;
    let k = i;
    for (const len of lengths) {
      const raw = pinyin.slice(k, k + len);
      const lead = raw.startsWith("'") ? 1 : 0;
      out.push({ start: k + lead, end: k + len, text: raw.slice(lead) });
      k += len;
    }
    i = j;
  }
  return out;
}

/**
 * The syllables of tone-marked pinyin ("dǎoháng" / "dǎo háng" → ["dǎo", "háng"]),
 * or null when it is not plain tone-marked pinyin (tone numbers, unknown syllables).
 */
export function pinyinSyllables(pinyin: string): string[] | null {
  const syls = syllablesOf(pinyin.normalize('NFC'));
  return syls ? syls.map(s => s.text) : null;
}

/** A syllable without its tone mark, lower case ("Dǎo" → "dao", "lǜ" → "lü"). */
export function toneless(syllable: string): string {
  return plain(syllable);
}

function withTone(base: 'yi' | 'bu', tone: number, like: string): string {
  const vowels = base === 'yi' ? 'īíǐì' : 'ūúǔù';
  const word = base[0] + (tone >= 1 && tone <= 4 ? vowels[tone - 1] : base[1]);
  return like[0] && like[0] !== like[0].toLowerCase() ? word[0].toUpperCase() + word.slice(1) : word;
}

/**
 * The tone 一 / 不 at index `i` should carry (1–5), or null to leave it.
 * `chars` are the hanzi's characters, `tones` the written tone of each Han
 * character's syllable (null for non-Han characters).
 */
function targetTone(chars: string[], tones: (number | null)[], i: number): number | null {
  const ch = chars[i];
  const prev = i > 0 ? chars[i - 1] : '';
  const next = i + 1 < chars.length ? chars[i + 1] : '';
  const nextHan = next !== '' && isHan(next);
  const prevHan = prev !== '' && isHan(prev);
  const nextTone = !nextHan ? null : next === '一' ? 1 : next === '不' ? 4 : tones[i + 1];
  if (ch === '一') {
    if (!nextHan) return 1;
    if (YI_WORD_FINAL.has(prev) || DIGITS.has(prev) || BIG_NUMBERS.has(prev)) return 1;
    if (next !== '两' && DIGITS.has(next)) return 1;
    if (YI_ORDINAL_NEXT.has(next) || (next === '年' && chars[i + 2] === '级')) return 1;
    if ((next === '日' || next === '号') && prev === '月') return 1;
    if (prevHan && prev === next && !DIGITS.has(prev)) return 5;
    if (nextTone === 4) return 2;
    if (nextTone === 1 || nextTone === 2 || nextTone === 3) return 4;
    if (nextTone === 5 && next === '个') return 2;
    return null;
  }
  // 不
  if (!nextHan) return 4;
  if (prevHan && prev === next) return 5;
  if (nextTone === 4) return 2;
  if (nextTone === 1 || nextTone === 2 || nextTone === 3) return 4;
  return null;
}

/**
 * Apply the 一 / 不 tone changes to `pinyin`, the pinyin of `hanzi` (syllables
 * spaced or words joined — "yī yàng" or "yīyàng"). Returns the pinyin with only
 * the 一 / 不 syllables changed, or `pinyin` unchanged when it can't be lined up.
 */
export function applyYiBuToneChanges(hanzi: string, pinyin: string): string {
  if (!hanzi || !pinyin || !/[一不]/.test(hanzi)) return pinyin;
  const nfc = pinyin.normalize('NFC');
  const syls = syllablesOf(nfc);
  if (!syls) return pinyin;
  const chars = Array.from(hanzi.normalize('NFC'));
  // Han characters in order, matched to syllables; an erhua 儿 may share the
  // previous syllable (yìdiǎnr).
  let hanIdx = chars.map((c, i) => (isHan(c) ? i : -1)).filter(i => i >= 0);
  if (hanIdx.length !== syls.length) {
    const withoutEr = hanIdx.filter(i => !(chars[i] === '儿' && i > 0 && isHan(chars[i - 1])));
    if (withoutEr.length !== hanIdx.length && withoutEr.length === syls.length) hanIdx = withoutEr;
    else return pinyin;
  }
  const sylAt = new Map<number, Syl>();
  hanIdx.forEach((ci, k) => sylAt.set(ci, syls[k]));
  // Any non-Han character in the hanzi must not be Latin (it would have eaten a syllable).
  if (chars.some(c => /[A-Za-z]/.test(c))) return pinyin;
  const tones = chars.map((_, i) => (sylAt.has(i) ? syllableTone(sylAt.get(i)!.text) : null));

  const edits: Array<{ syl: Syl; text: string }> = [];
  chars.forEach((ch, i) => {
    if (ch !== '一' && ch !== '不') return;
    const syl = sylAt.get(i);
    if (!syl) return;
    const base = ch === '一' ? 'yi' : 'bu';
    if (plain(syl.text) !== base) return; // another reading or a typo — not ours to touch
    if (tones[i] === 5) return; // a written neutral is a dictionary choice
    const tone = targetTone(chars, tones, i);
    if (tone === null || tone === tones[i]) return;
    edits.push({ syl, text: withTone(base, tone, syl.text) });
  });
  if (!edits.length) return pinyin;
  let out = nfc;
  for (const e of edits.sort((a, b) => b.syl.start - a.syl.start)) {
    out = out.slice(0, e.syl.start) + e.text + out.slice(e.syl.end);
  }
  return out;
}
