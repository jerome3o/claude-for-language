/**
 * Word tags (docs/STUDY_SESSION.md "Word tags"): the small, quiet pills under the meaning on a
 * card's answer side and in the language explorer's Word view — part of speech, separable verb,
 * register (polite / formal / colloquial / slang / rude …), measure word, HSK level, how common,
 * traditional form. Deterministic: everything comes from the shipped lexicon
 * (shared/data/word-tags/word-tags.txt, built from CC-CEDICT, HanLP, jieba, an HSK list and
 * curated lists — README there) and the word-frequency list. No AI, works offline.
 *
 * Pure; ported to the Lab app (core/…/cards/WordTags.kt) and parity-tested against this file
 * over the SHIPPED lexicon (android-lab/parity/fixtures/word-tags.ts).
 */
import { frequencyTier, type FrequencyDecal } from '../explorer/frequency-tier';
import { isStarterIdiom } from '../idioms/starter';

export interface WordTagMeasure {
  char: string;
  pinyin: string;
}

/** One headword's line of the lexicon. */
export interface WordTagEntry {
  /** Part-of-speech codes, most frequent first (≤ 2): n v a d q m r ry p c u e o i l j t f s nr h k. */
  pos: string[];
  /** Register codes (one letter each, see REGISTER_LABELS). */
  register: string[];
  measures: WordTagMeasure[];
  /** HSK 3.0 level 1–6, 7 = the 7–9 band; null = not on the list. */
  hsk: number | null;
  trad: string | null;
  /** A separable verb's split example (睡了一个好觉); null = not separable. */
  separable: string | null;
}

export interface WordTagMarker {
  text: string;
  register: string;
  /** "^请": only at the start of the text or right after punctuation. */
  clauseStart: boolean;
}

export interface WordTagLexicon {
  words: Map<string, WordTagEntry>;
  markers: WordTagMarker[];
}

/** Parses word-tags.txt (format in shared/data/word-tags/README.md). Unknown lines are skipped. */
export function parseWordTagLexicon(text: string): WordTagLexicon {
  const words = new Map<string, WordTagEntry>();
  const markers: WordTagMarker[] = [];
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line === '#words' || line === '#markers') {
      section = line;
      continue;
    }
    if (line === '' || line.startsWith('#')) continue;
    const cols = line.split('\t');
    if (!cols[0]) continue;
    if (section === '#words') {
      const measures: WordTagMeasure[] = [];
      for (const m of (cols[3] ?? '').split(',')) {
        const at = m.indexOf(':');
        if (at > 0) measures.push({ char: m.slice(0, at), pinyin: m.slice(at + 1) });
      }
      const hsk = Number(cols[4]);
      words.set(cols[0], {
        pos: (cols[1] ?? '').split(',').filter(Boolean),
        register: [...(cols[2] ?? '')],
        measures,
        hsk: cols[4] && Number.isInteger(hsk) && hsk >= 1 && hsk <= 7 ? hsk : null,
        trad: cols[5] || null,
        separable: cols[6] || null,
      });
    } else if (section === '#markers' && cols[1]) {
      const clauseStart = cols[0].startsWith('^');
      const t = clauseStart ? cols[0].slice(1) : cols[0];
      if (t) markers.push({ text: t, register: cols[1], clauseStart });
    }
  }
  return { words, markers };
}

/** `transitivity` and `spoken` (Everyday speech) only ever come from the AI pass (shared/cards/word-tags-ai.ts). */
export type WordTagKind = 'pos' | 'separable' | 'transitivity' | 'register' | 'measure' | 'hsk' | 'frequency' | 'spoken' | 'trad' | 'phrase';

/** Colour family of a pill — all muted; register tags tint by how careful you need to be. */
export type WordTagTone = 'plain' | 'grammar' | 'formal' | 'casual' | 'warning' | 'level' | FrequencyDecal;

export interface WordTag {
  kind: WordTagKind;
  /** Stable id: "pos:vi", "register:P", "separable", "measure", "hsk", "frequency", "trad", "phrase". */
  id: string;
  label: string;
  tone: WordTagTone;
  /** Suggested by the AI pass (word-tags-ai.ts), not the lexicon: the pill shows ✨. Absent = lexicon. */
  ai?: true;
}

export const POS_LABELS: Readonly<Record<string, string>> = {
  n: 'Noun',
  v: 'Verb',
  a: 'Adjective',
  d: 'Adverb',
  q: 'Measure word',
  m: 'Number',
  r: 'Pronoun',
  ry: 'Question word',
  p: 'Preposition',
  c: 'Conjunction',
  u: 'Particle',
  e: 'Interjection',
  o: 'Sound word',
  i: 'Idiom 成语',
  l: 'Set phrase',
  j: 'Abbreviation',
  t: 'Time word',
  f: 'Position word',
  s: 'Place word',
  nr: 'Name',
  h: 'Prefix',
  k: 'Suffix',
};

export const REGISTER_LABELS: Readonly<Record<string, string>> = {
  P: 'Polite',
  F: 'Formal',
  L: 'Literary',
  C: 'Colloquial',
  I: 'Informal',
  S: 'Slang',
  R: 'Rude',
  D: 'Derogatory',
  H: 'Humorous',
  E: 'Euphemism',
  O: 'Dated',
  G: 'Regional',
  T: 'Taiwan',
  K: 'Cantonese',
};

export const REGISTER_TONE: Readonly<Record<string, WordTagTone>> = {
  P: 'formal',
  F: 'formal',
  L: 'formal',
  C: 'casual',
  I: 'casual',
  S: 'casual',
  H: 'casual',
  R: 'warning',
  D: 'warning',
  E: 'plain',
  O: 'plain',
  G: 'plain',
  T: 'plain',
  K: 'plain',
};

export const MAX_POS_TAGS = 2;
export const MAX_REGISTER_TAGS = 2;
export const MAX_MEASURES_SHOWN = 2;

/** Sentence punctuation and spaces trimmed off a card's hanzi before the lookup ("你好！" → 你好). */
const EDGE = /^[\s。！？!?.,，、；;：:…~～"'“”‘’「」『』《》()（）]+|[\s。！？!?.,，、；;：:…~～"'“”‘’「」『』《》()（）]+$/g;
const CLAUSE_BREAK = /[\s。！？!?.,，、；;：:…~～"'“”‘’「」『』《》()（）]/;
const HAN = /^\p{Script=Han}+$/u;
const SENTENCE_MARK = /[。！？!?，,；;]/;

/** The lookup key of a card's hanzi: NFC, edge punctuation and spaces trimmed. */
export function wordTagKey(hanzi: string): string {
  return String(hanzi ?? '').normalize('NFC').replace(EDGE, '');
}

export interface WordTagOptions {
  /**
   * The word's rank in the shipped frequency list (1 = most common): a number, null = not in the
   * list (→ "Rare" for a dictionary word), undefined = the list isn't loaded (no frequency tag).
   * For a single character: the CHARACTER rank.
   */
  rank?: number | null;
  /** Leave these kinds out (the explorer's Word view already shows how common a word is). */
  exclude?: readonly WordTagKind[];
}

const FREQUENCY_LABELS: Readonly<Record<FrequencyDecal, string>> = {
  top100: 'Top 100',
  top1000: 'Top 1,000',
  top2000: 'Top 2,000',
  rare: 'Rare',
};

/**
 * The HSK level of a word or character (a character: its level as a one-character word), from
 * the lexicon; null = not on the list, or the lexicon isn't loaded. The frequency decals pass it
 * to frequencyTier so an HSK word is never "rare" — on the card's pills and the explorer's tiles.
 */
export function hskLevel(lexicon: WordTagLexicon | null | undefined, text: string): number | null {
  if (!lexicon) return null;
  return lexicon.words.get(wordTagKey(text))?.hsk ?? null;
}

export function hskLabel(level: number): string {
  return level >= 7 ? 'HSK 7–9' : `HSK ${level}`;
}

export function measureLabel(measures: readonly WordTagMeasure[]): string {
  return `Measure: ${measures.slice(0, MAX_MEASURES_SHOWN).map((m) => `${m.char} ${m.pinyin}`).join(', ')}`;
}

/** Register codes of the markers found in a sentence / phrase, in marker order, no duplicates. */
export function markerRegister(text: string, markers: readonly WordTagMarker[]): string[] {
  const out: string[] = [];
  for (const m of markers) {
    let at = text.indexOf(m.text);
    let hit = false;
    while (at >= 0 && !hit) {
      if (!m.clauseStart || at === 0 || CLAUSE_BREAK.test(text[at - 1])) hit = true;
      else at = text.indexOf(m.text, at + 1);
    }
    if (!hit) continue;
    for (const c of m.register) if (!out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * The tags for a card's hanzi, in display order: part of speech (≤ 2) · separable verb ·
 * register (≤ 2) · measure word · HSK level · how common · traditional form. A dictionary word
 * gets its lexicon line; anything else (a phrase, a sentence) gets only what applies — "Phrase"
 * for 2–6 Han characters, register words found in it (您, 请问, 啥…), "Idiom" for a starter 成语.
 * `lexicon` null (not loaded) → no tags.
 */
export function wordTags(hanzi: string, lexicon: WordTagLexicon | null, options: WordTagOptions = {}): WordTag[] {
  if (!lexicon) return [];
  const key = wordTagKey(hanzi);
  if (!key) return [];
  const exclude = new Set(options.exclude ?? []);
  const out: WordTag[] = [];
  const push = (t: WordTag) => {
    if (!exclude.has(t.kind)) out.push(t);
  };
  const register = (codes: readonly string[]) => {
    for (const c of codes.slice(0, MAX_REGISTER_TAGS)) {
      const label = REGISTER_LABELS[c];
      if (label) push({ kind: 'register', id: `register:${c}`, label, tone: REGISTER_TONE[c] ?? 'plain' });
    }
  };

  const entry = lexicon.words.get(key);
  if (!entry) {
    const chars = [...key];
    // A card ending in 。！？ (or with a comma inside) is a sentence: no "Phrase" pill.
    const sentence = SENTENCE_MARK.test(String(hanzi).normalize('NFC'));
    if (HAN.test(key) && chars.length === 4 && isStarterIdiom(key)) push({ kind: 'pos', id: 'pos:i', label: POS_LABELS.i, tone: 'plain' });
    else if (!sentence && HAN.test(key) && chars.length >= 2 && chars.length <= 6) push({ kind: 'phrase', id: 'phrase', label: 'Phrase', tone: 'plain' });
    register(markerRegister(key, lexicon.markers));
    return out;
  }

  for (const p of entry.pos.slice(0, MAX_POS_TAGS)) {
    const label = POS_LABELS[p];
    if (label) push({ kind: 'pos', id: `pos:${p}`, label, tone: 'plain' });
  }
  if (entry.separable) push({ kind: 'separable', id: 'separable', label: 'Separable verb', tone: 'grammar' });
  register(entry.register);
  if (entry.measures.length) push({ kind: 'measure', id: 'measure', label: measureLabel(entry.measures), tone: 'plain' });
  if (entry.hsk !== null) push({ kind: 'hsk', id: 'hsk', label: hskLabel(entry.hsk), tone: 'level' });
  if (options.rank !== undefined) {
    // An HSK word is never "Rare" (frequencyTier): the list counts mostly written text.
    const tier = frequencyTier(options.rank, [...key].length === 1 ? 'char' : 'word', entry.hsk);
    if (tier) push({ kind: 'frequency', id: 'frequency', label: FREQUENCY_LABELS[tier], tone: tier });
  }
  if (entry.trad) push({ kind: 'trad', id: 'trad', label: `Trad. ${entry.trad}`, tone: 'plain' });
  return out;
}

export interface WordTagExplanation {
  title: string;
  body: string;
  /** A Chinese example line (may be empty). */
  example: string;
  /** Where the tag comes from, one short line. */
  source: string;
  /** An AI-suggested tag (the sheet says "Suggested by AI — may be wrong"). Absent = lexicon. */
  ai?: true;
  /** The AI's one-line usage note (register_note, e.g. "formal written; in speech use 告诉"). */
  note?: string;
}

const POS_EXPLAIN: Readonly<Record<string, readonly [body: string, example: string]>> = {
  n: ['A thing, person, place or idea. To count it, put a measure word in front: 一本书, 三个人.', '这是我的书。'],
  v: ['An action or a change. 了 (done), 过 (ever) and 着 (going on) follow it; 不 / 没 go before it.', '我看了那本书。'],
  a: ['Describes something and works like a verb — no 是: 她很高兴. A plain statement usually takes 很 (or another adverb).', '这个菜很好吃。'],
  d: ['Goes right before the verb or adjective it changes, never at the end of the sentence.', '我也去。他已经走了。'],
  q: ['Goes between a number (or 这 / 那 / 几) and a noun. Each noun has its own: 一本书, 两张纸.', '我买了三本书。'],
  m: ['A number or an amount. Before a noun it needs a measure word: 两个苹果.', '我有两个哥哥。'],
  r: ['Stands in for a noun: a person, a thing, "this" or "that".', '他是我的朋友。'],
  ry: ['Asks a question by standing where the answer goes — no 吗 needed.', '你去哪儿？他是谁？'],
  p: ['Comes before a noun to say where, when, with whom or to whom — and the whole phrase goes BEFORE the verb.', '我在家吃饭。'],
  c: ['Joins words or clauses. 和 joins nouns only; clauses are joined with words like 但是, 所以, 因为.', '因为下雨，所以我没去。'],
  u: ['A small grammar word with no meaning of its own: it marks a question, a mood, an aspect or a structure (了, 的, 吗, 吧, 着).', '你好吗？'],
  e: ['An exclamation that stands on its own.', '哎呀，我忘了！'],
  o: ['Imitates a sound (an onomatopoeia).', '他哈哈大笑。'],
  i: ['A set expression, usually four characters, often from a classical story. Use it whole — the characters can’t be swapped or split.', '他说话总是画蛇添足。'],
  l: ['A fixed expression used as one unit; learn it as a chunk.', '祝你一路平安！'],
  j: ['A shortened form of a longer word or name.', '北大 = 北京大学'],
  t: ['A noun for a time. It goes BEFORE the verb, often at the start of the sentence.', '我明天去北京。'],
  f: ['Says where, after a noun: on, in, in front of…', '书在桌子上。'],
  s: ['A noun for a place.', '附近有银行吗？'],
  nr: ['A proper noun: the name of a person, a place or an organisation.', ''],
  h: ['Attaches to the front of a word or number.', '老师 · 第一'],
  k: ['Attaches to the end of a word.', '我们 · 桌子'],
};

export const REGISTER_EXPLAIN: Readonly<Record<string, string>> = {
  P: 'Shows respect — the word to use with strangers, older people, customers and teachers.',
  F: 'Formal: speeches, official letters, business and the news. Stiff in a chat with friends.',
  L: 'Literary or classical: met mostly in writing and set phrases, rare in everyday talk.',
  C: 'Everyday spoken Chinese — natural with friends and family, out of place in formal writing.',
  I: 'Casual. Fine with friends; with strangers, older people or at work, pick a more neutral word.',
  S: 'Slang or internet talk — young and casual. Use it only where you’d use slang.',
  R: 'Rude or vulgar. Good to recognise; think twice before saying it.',
  D: 'Has a negative, disparaging ring — it puts someone or something down.',
  H: 'Playful or joking.',
  E: 'A softer, indirect way of saying something unpleasant.',
  O: 'Old-fashioned: you’ll meet it in older texts more than in today’s speech.',
  G: 'Dialect or regional usage — not standard Mandarin everywhere.',
  T: 'Used mainly in Taiwan; the mainland usually says it differently.',
  K: 'Cantonese / Hong Kong usage.',
};

/** What a tag means — the tiny sheet a tap on a pill opens. `hanzi` = the card's hanzi. */
export function wordTagExplanation(tag: WordTag, hanzi: string, lexicon: WordTagLexicon | null): WordTagExplanation {
  const key = wordTagKey(hanzi);
  const entry = lexicon?.words.get(key) ?? null;
  if (tag.kind === 'pos') {
    const code = tag.id.slice(4);
    const [body, example] = POS_EXPLAIN[code] ?? ['', ''];
    return { title: POS_LABELS[code] ?? tag.label, body, example, source: code === 'i' && !entry ? 'Curated idiom list' : 'HanLP / jieba part-of-speech lexicon' };
  }
  if (tag.kind === 'separable') {
    return {
      title: 'Separable verb 离合词',
      body: 'A verb + its object in one word. Other words can go between the two halves (了, 过, a number, a person’s 的), and it can’t take another object: 跟他见面 — not 见面他.',
      example: entry?.separable ?? '',
      source: 'Curated list',
    };
  }
  if (tag.kind === 'register') {
    const code = tag.id.slice(9);
    return { title: REGISTER_LABELS[code] ?? tag.label, body: REGISTER_EXPLAIN[code] ?? '', example: '', source: entry ? 'CC-CEDICT usage label or the curated list' : 'Found in this sentence (curated list)' };
  }
  if (tag.kind === 'measure') {
    const ms = entry?.measures.slice(0, MAX_MEASURES_SHOWN) ?? [];
    const list = ms.map((m) => `${m.char} (${m.pinyin})`).join(' or ');
    return {
      title: 'Measure word',
      body: ms.length ? `Count this with ${list}. The measure word goes between the number (or 这 / 那) and the noun.` : '',
      example: ms.length ? `一${ms[0].char}${key}` : '',
      source: 'CC-CEDICT',
    };
  }
  if (tag.kind === 'hsk') {
    const level = entry?.hsk ?? 0;
    return {
      title: tag.label,
      body:
        level >= 7
          ? 'On the HSK 3.0 word list (2021) in the advanced band 7–9 — the last stage of the exam.'
          : `On the HSK 3.0 word list (2021) at level ${level} of 9 — level 1 is the first words a learner meets.`,
      example: '',
      source: 'HSK 3.0 word list (complete-hsk-vocabulary)',
    };
  }
  if (tag.kind === 'frequency') {
    const unit = [...key].length === 1 ? 'characters' : 'words';
    const body =
      tag.tone === 'rare'
        ? `Not among the ${unit === 'words' ? '10,000' : '3,500'} most common ${unit} — you’ll meet it less often.`
        : `Among the ${tag.label.replace('Top ', '')} most common ${unit} in modern Chinese (books, news, subtitles and the web).`;
    return { title: tag.label === 'Rare' ? 'Rare' : `${tag.label} ${unit}`, body, example: '', source: 'wordfreq' };
  }
  if (tag.kind === 'trad') {
    return { title: 'Traditional form', body: `Written ${entry?.trad ?? ''} in traditional characters — Taiwan, Hong Kong and older texts.`, example: '', source: 'CC-CEDICT' };
  }
  return { title: 'Phrase', body: 'Not a single dictionary word but a phrase of several words — learn it as a chunk.', example: '', source: 'Not in the dictionary' };
}
