/**
 * Pinyin helpers for the word-list importer: tone-number → tone-mark
 * conversion, validity checks and syllable segmentation. Pure, no
 * dictionary — "is this Latin text pinyin?" is decided by whether every
 * token is a well-formed Mandarin syllable.
 */

const TONE_MARKS: Record<string, string[]> = {
  a: ['ā', 'á', 'ǎ', 'à'],
  e: ['ē', 'é', 'ě', 'è'],
  i: ['ī', 'í', 'ǐ', 'ì'],
  o: ['ō', 'ó', 'ǒ', 'ò'],
  u: ['ū', 'ú', 'ǔ', 'ù'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

const MARKED_TO_BASE: Record<string, string> = {};
for (const [base, marks] of Object.entries(TONE_MARKS)) {
  for (const m of marks) MARKED_TO_BASE[m] = base;
}

const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];
const FINALS = [
  'a', 'o', 'e', 'i', 'u', 'ü', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'er',
  'ia', 'ie', 'iao', 'iu', 'ian', 'in', 'iang', 'ing', 'iong',
  'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang', 'ueng',
  'üe', 'üan', 'ün',
];
const FINAL_SET = new Set(FINALS);
const SYLLABLE_MAX = 7; // "zhuang" + erhua "r"

/** Replace tone-marked vowels with plain ones and drop tone digits. */
export function stripTones(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/g, ch => MARKED_TO_BASE[ch] ?? ch)
    .replace(/[1-5]/g, '');
}

/** Does the text carry tone information (marks or digits 1-5)? */
export function hasToneInfo(text: string): boolean {
  return /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(text.normalize('NFC')) || /[a-zü][1-5]\b/i.test(text);
}

function isSyllable(plain: string): boolean {
  const s = plain.toLowerCase().replace(/^'/, '');
  if (!s) return false;
  const core = s.endsWith('r') && s.length > 2 && !FINAL_SET.has(s) && !s.endsWith('er') ? s.slice(0, -1) : s;
  for (const ini of INITIALS) {
    if (core.startsWith(ini) && FINAL_SET.has(core.slice(ini.length))) return true;
  }
  return FINAL_SET.has(core) || core === 'ê' || core === 'r';
}

/** Split a run of letters into syllables (greedy longest, with backtracking). */
export function segmentPinyin(run: string): string[] | null {
  const s = stripTones(run).toLowerCase().replace(/v/g, 'ü');
  if (!/^[a-zü']+$/.test(s)) return null;
  const memo = new Map<number, string[] | null>();
  const go = (i: number): string[] | null => {
    if (i === s.length) return [];
    if (memo.has(i)) return memo.get(i)!;
    let best: string[] | null = null;
    const start = s[i] === "'" ? i + 1 : i;
    for (let len = Math.min(SYLLABLE_MAX, s.length - start); len >= 1; len--) {
      const piece = s.slice(start, start + len);
      if (!isSyllable(piece)) continue;
      const rest = go(start + len);
      if (rest) {
        best = [piece, ...rest];
        break;
      }
    }
    memo.set(i, best);
    return best;
  };
  return go(0);
}

/**
 * Is this Latin text well-formed pinyin? Every whitespace / hyphen separated
 * token must segment into syllables. Returns the syllable count or null.
 */
export function pinyinSyllableCount(text: string): number | null {
  const tokens = text.trim().split(/[\s\-·]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  let count = 0;
  for (const t of tokens) {
    const seg = segmentPinyin(t.replace(/[,.!?;:，。！？；：()（）"“”]/g, ''));
    if (!seg) return null;
    count += seg.length;
  }
  return count;
}

function markSyllable(plain: string, tone: number): string {
  if (tone < 1 || tone > 4) return plain;
  const lower = plain;
  const place = (idx: number) => lower.slice(0, idx) + TONE_MARKS[lower[idx]][tone - 1] + lower.slice(idx + 1);
  let i = lower.indexOf('a');
  if (i === -1) i = lower.indexOf('e');
  if (i === -1) i = lower.indexOf('ou') === -1 ? -1 : lower.indexOf('o');
  if (i === -1) {
    for (let k = lower.length - 1; k >= 0; k--) {
      if ('aeiouü'.includes(lower[k])) {
        i = k;
        break;
      }
    }
  }
  return i === -1 ? plain : place(i);
}

/**
 * "ni3 hao3" → "nǐ hǎo", "lv4" → "lǜ", "nǐ hǎo" → unchanged. Tone digits may
 * sit after each syllable with or without spaces ("ni3hao3"). Text that is
 * not pinyin is returned as-is (apart from NFC).
 */
export function toneNumbersToMarks(text: string): string {
  const nfc = text.normalize('NFC');
  if (!/[a-zü][1-5]/i.test(nfc)) return nfc;
  return nfc.replace(/([a-zA-ZüÜvV]+)([1-5])/g, (_m, letters: string, digit: string) => {
    const tone = Number(digit);
    const plain = letters.replace(/v/g, 'ü').replace(/V/g, 'Ü');
    const seg = segmentPinyin(plain);
    if (!seg || seg.length === 0) return plain;
    // Only the LAST syllable of the run takes this digit ("ni3hao3" arrives
    // one syllable per match since the digit ends the match).
    const last = seg[seg.length - 1];
    const head = plain.slice(0, plain.length - last.length);
    const isUpper = plain[head.length] === plain[head.length].toUpperCase() && plain[head.length] !== plain[head.length].toLowerCase();
    const marked = markSyllable(last.toLowerCase(), tone);
    return head + (isUpper ? marked[0].toUpperCase() + marked.slice(1) : marked);
  });
}

/** Trim, NFC, collapse spaces, tone digits → marks. */
export function normalizePinyin(text: string): string {
  return toneNumbersToMarks(text).replace(/\s+/g, ' ').trim();
}
