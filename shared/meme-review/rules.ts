/**
 * 梗 Meme review: the small pure rules both apps use (labels, the "+ Add as card" fields, the
 * quiz line) and the URL rules the validator uses. The app-side ones are ported to the Lab app
 * (core/…/memereview/MemeReview.kt) and parity-tested (android-lab/parity/fixtures/meme-review.ts).
 */
import type { MemeIssue, MemeItem, MemeMedia, MemeMonth, MemePlatform, MemeRegister, MemeVerdict } from './types';

// ---------- Months ----------

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function isMemeMonth(value: unknown): value is MemeMonth {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** The UTC calendar month of a moment: "2026-10". */
export function memeMonthOf(ms: number): MemeMonth {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "October 2026" ('' for a malformed month). */
export function memeMonthLabel(month: string): string {
  if (!isMemeMonth(month)) return '';
  return `${MONTHS_EN[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** "2026年10月". */
export function memeMonthLabelZh(month: string): string {
  if (!isMemeMonth(month)) return '';
  return `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** "23 Aug – 18 Oct 2026" / "20 Dec 2026 – 31 Jan 2027" ('' when either date is malformed). */
export function memeCoversLabel(covers: { from: string; to: string }): string {
  if (!isIsoDate(covers.from) || !isIsoDate(covers.to)) return '';
  const part = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1] ?? ''}`;
  const fromYear = covers.from.slice(0, 4);
  const toYear = covers.to.slice(0, 4);
  return fromYear === toYear ? `${part(covers.from)} – ${part(covers.to)} ${toYear}` : `${part(covers.from)} ${fromYear} – ${part(covers.to)} ${toYear}`;
}

/** The weeks an issue written on `today` (YYYY-MM-DD) covers: the `days` before it. Server only. */
export function coverageWindow(today: string, days = 56): { from: string; to: string } {
  const end = Date.parse(`${today}T00:00:00Z`);
  const start = new Date(end - days * 86_400_000);
  return { from: start.toISOString().slice(0, 10), to: today };
}

// ---------- Platforms & links ----------

const PLATFORM_NAMES: Record<MemePlatform, string> = {
  bilibili: 'Bilibili',
  youtube: 'YouTube',
  douyin: 'Douyin',
  weibo: 'Weibo',
  xiaohongshu: 'Xiaohongshu',
  zhihu: 'Zhihu',
  baidu: 'Baidu',
  wechat: 'WeChat',
  news: 'the news',
  other: 'the web',
};

export function memePlatformName(platform: MemePlatform): string {
  return PLATFORM_NAMES[platform] ?? 'the web';
}

/** "▶ Watch on Bilibili" / "↗ Open on Weibo". */
export function memeLinkLabel(media: Pick<MemeMedia, 'kind' | 'platform'>): string {
  const where = memePlatformName(media.platform);
  return media.kind === 'video' ? `▶ Watch on ${where}` : `↗ Open on ${where}`;
}

const VERDICTS: Record<MemeVerdict, string> = {
  fine: '👍 Fine to say',
  cute: '😊 Cute from you',
  cringe: '😬 A bit cringe from you',
  avoid: '🙅 Better not',
};

/** The "Would you say it?" chip. */
export function memeVerdictLabel(verdict: MemeVerdict): string {
  return VERDICTS[verdict] ?? VERDICTS.fine;
}

const WHERE: Record<MemeRegister['where'], string> = {
  online: 'Online (typed)',
  spoken: 'Said out loud',
  both: 'Online and spoken',
};

/** The register chips: who · tone · where (· ⚠ crude). */
export function memeRegisterChips(register: MemeRegister): string[] {
  const chips = [register.who, register.tone, WHERE[register.where] ?? ''].map((s) => s.trim()).filter(Boolean);
  if (register.crude) chips.push('⚠ Crude');
  return chips;
}

/** After the quiz (practice only). */
export function memeQuizScoreLine(correct: number, total: number): string {
  if (total <= 0) return '';
  if (correct === total) return `${correct} / ${total} — 你很懂梗！ You're very online.`;
  if (correct * 2 >= total) return `${correct} / ${total} — not bad, nearly 网上冲浪 level.`;
  return `${correct} / ${total} — read the issue once more and try again.`;
}

// ---------- "+ Add as card" ----------

export interface MemeCardFields {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts: string;
  sentence_clue?: string;
  sentence_clue_pinyin?: string;
  sentence_clue_translation?: string;
}

/** What the card standard keeps off a sentence clue (shared/cards/standard.ts FORBIDDEN_ON_CARD + ellipsis). */
const NOT_A_CLUE = /[/\\|()[\]{}（）【】〔〕<>~*=+#@&^`"'_]|…|\.\.\.|。。。/;

/**
 * The card for a meme: hanzi / pinyin / the gist; fun_facts = what it means (Chinese + English),
 * the origin, who says it, "would you say it?", older memes it riffs on; sentence_clue = the
 * first example that contains the meme and reads as a clean card sentence.
 */
export function memeCardFields(item: MemeItem, month: MemeMonth): MemeCardFields {
  const lines = [
    `${item.meaning.hanzi}${item.meaning.english ? ` — ${item.meaning.english}` : ''}`,
    `Origin (${memeMonthLabel(month) || month} meme review): ${item.origin.text}${item.origin.confidence === 'medium' ? ' (not fully certain)' : ''}`,
    `Who says it: ${memeRegisterChips(item.register).join(' · ')}${item.register.note ? `. ${item.register.note}` : ''}`,
    `Would you say it? ${memeVerdictLabel(item.say_it.verdict)}${item.say_it.note ? ` — ${item.say_it.note}` : ''}`,
  ];
  if (item.related.length > 0) lines.push(`Riffs on: ${item.related.map((r) => `${r.hanzi} (${r.english})`).join(', ')}`);
  const clue = item.examples.find((e) => e.hanzi.includes(item.hanzi) && !NOT_A_CLUE.test(e.hanzi));
  return {
    hanzi: item.hanzi,
    pinyin: item.pinyin,
    english: item.english,
    fun_facts: lines.join('\n'),
    ...(clue ? { sentence_clue: clue.hanzi, sentence_clue_pinyin: clue.pinyin, sentence_clue_translation: clue.english } : {}),
  };
}

/** Every Chinese line of an issue that has a ▶ (prefetched for offline). */
export function memeAudioLines(issue: MemeIssue): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    if (s && !out.includes(s)) out.push(s);
  };
  for (const item of issue.items) {
    add(item.hanzi);
    add(item.meaning.hanzi);
    for (const e of item.examples) add(e.hanzi);
  }
  return out;
}

// ---------- URLs (validator) ----------

/** http(s) only; the URL without its #fragment, or null. */
export function cleanUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!/^https?:\/\//i.test(s) || s.length > 600 || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

const TRACKING_PARAM = /^(utm_[a-z]+|spm(_id_from)?|from|share_[a-z_]+|vd_source|xsec_[a-z_]+|is_from_webapp|sender_device)$/i;

/**
 * The comparison key of a URL ("was this URL in the search results?"): scheme, `www.` / `m.`,
 * a trailing slash, the fragment and tracking parameters don't count. null when not a URL.
 */
export function urlKey(raw: unknown): string | null {
  const clean = cleanUrl(raw);
  if (!clean) return null;
  const u = new URL(clean);
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAM.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const search = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
  const path = u.pathname.replace(/\/+$/, '') || '';
  return `${host}${path}${search}`;
}

const HOSTS: Array<[RegExp, MemePlatform]> = [
  [/(^|\.)(bilibili\.com|b23\.tv)$/, 'bilibili'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)(douyin\.com|iesdouyin\.com)$/, 'douyin'],
  [/(^|\.)(weibo\.com|weibo\.cn)$/, 'weibo'],
  [/(^|\.)(xiaohongshu\.com|xhslink\.com)$/, 'xiaohongshu'],
  [/(^|\.)zhihu\.com$/, 'zhihu'],
  [/(^|\.)baidu\.com$/, 'baidu'],
  [/(^|\.)(weixin\.qq\.com|wechat\.com)$/, 'wechat'],
  [/(^|\.)(people\.com\.cn|xinhuanet\.com|news\.cn|chinadaily\.com\.cn|thepaper\.cn|sohu\.com|163\.com|qq\.com|sina\.com\.cn|globaltimes\.cn|scmp\.com|cgtn\.com|ifeng\.com|36kr\.com|whatsonweibo\.com|sixthtone\.com|bbc\.com|nytimes\.com|theguardian\.com|reuters\.com)$/, 'news'],
];

export function platformOf(url: string): MemePlatform {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'other';
  }
  return HOSTS.find(([re]) => re.test(host))?.[1] ?? 'other';
}

const VIDEO_PLATFORMS: MemePlatform[] = ['bilibili', 'youtube', 'douyin'];

export function mediaKindOf(platform: MemePlatform): MemeMedia['kind'] {
  return VIDEO_PLATFORMS.includes(platform) ? 'video' : 'post';
}

/** A YouTube video's public thumbnail, or null when the URL isn't a YouTube video. */
export function youtubeThumbnail(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(shorts|embed|live)\/([^/]+)/);
      id = m ? m[2] : null;
    }
  }
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}
