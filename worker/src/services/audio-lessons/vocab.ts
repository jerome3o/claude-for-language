/**
 * What the authoring agent knows about the learner's vocabulary (docs/AUDIO_LESSONS.md
 * "Known words"): built from the server's card state per spelling
 * (`learnerVocabulary`, the same tiers as shared/progress/known.ts). Pure.
 */
import { isHanCodePoint, noteKind } from '@shared/progress/known';
import type { VocabRow } from '../../db/audio-lesson-queries';

export type WordStatus = 'known' | 'learning' | 'in_deck' | 'new';

export interface VocabIndex {
  byHanzi: Map<string, VocabRow>;
  /** Words (1–4 characters) containing a character, known first, then shorter. */
  byChar: Map<string, VocabRow[]>;
  knownWords: number;
  learningWords: number;
  knownChars: Set<string>;
  maxWordLength: number;
}

function hanOf(text: string): string[] {
  return [...text].filter((c) => isHanCodePoint(c.codePointAt(0)!));
}

function statusOf(row: VocabRow | undefined): WordStatus {
  if (!row) return 'new';
  return row.tier >= 2 ? 'known' : row.tier === 1 ? 'learning' : 'in_deck';
}

export function buildVocabIndex(rows: VocabRow[]): VocabIndex {
  const byHanzi = new Map<string, VocabRow>();
  const byChar = new Map<string, VocabRow[]>();
  const knownChars = new Set<string>();
  let knownWords = 0;
  let learningWords = 0;
  let maxWordLength = 1;
  for (const row of rows) {
    const hanzi = row.hanzi.trim();
    if (!hanzi) continue;
    byHanzi.set(hanzi, row);
    const chars = hanOf(hanzi);
    if (row.tier >= 2) for (const c of chars) knownChars.add(c);
    if (noteKind(hanzi) !== 'word') continue;
    if (row.tier >= 2) knownWords++;
    else if (row.tier === 1) learningWords++;
    maxWordLength = Math.max(maxWordLength, chars.length);
    for (const c of new Set(chars)) {
      const list = byChar.get(c) ?? [];
      list.push(row);
      byChar.set(c, list);
    }
  }
  for (const list of byChar.values()) {
    list.sort((a, b) => b.tier - a.tier || [...a.hanzi].length - [...b.hanzi].length || a.hanzi.localeCompare(b.hanzi));
  }
  return { byHanzi, byChar, knownWords, learningWords, knownChars, maxWordLength: Math.min(maxWordLength, 6) };
}

export interface WordCheck {
  word: string;
  status: WordStatus;
  card?: { pinyin: string; english: string };
  /** Per character: words the learner knows (or is learning) that contain it — for "银 is the 银 of 银行". */
  characters: Array<{ char: string; known: boolean; words: Array<{ hanzi: string; pinyin: string; english: string; status: WordStatus }> }>;
}

/** The `check_known_words` tool. */
export function checkWords(index: VocabIndex, words: string[], perChar = 4): WordCheck[] {
  return words.slice(0, 80).map((raw) => {
    const word = raw.trim();
    const row = index.byHanzi.get(word);
    const characters = [...new Set(hanOf(word))].map((char) => ({
      char,
      known: index.knownChars.has(char),
      words: (index.byChar.get(char) ?? [])
        .filter((w) => w.hanzi !== word && w.tier >= 1)
        .slice(0, perChar)
        .map((w) => ({ hanzi: w.hanzi, pinyin: w.pinyin, english: w.english, status: statusOf(w) })),
    }));
    const out: WordCheck = { word, status: statusOf(row), characters };
    if (row) out.card = { pinyin: row.pinyin, english: row.english };
    return out;
  });
}

export interface TextAnalysis {
  /** Distinct Han characters in the text. */
  chars: number;
  /** Words the learner knows (or is learning) found in the text, with how often. */
  familiar: Array<{ hanzi: string; status: WordStatus; count: number }>;
  /** Stretches no known / learning word covers, most frequent first: where the new words are. */
  unfamiliar: Array<{ text: string; count: number }>;
  /** Share of the text's Han characters covered by familiar words. */
  coverage: number;
}

/**
 * Greedy longest-match over the learner's words (known or learning). Not a real
 * segmenter — it only points the agent at the stretches worth looking at.
 */
export function analyseText(index: VocabIndex, text: string): TextAnalysis {
  const chars = [...text];
  const familiar = new Map<string, { hanzi: string; status: WordStatus; count: number }>();
  const unfamiliar = new Map<string, number>();
  let run = '';
  let han = 0;
  let covered = 0;
  const flush = () => {
    if (run) unfamiliar.set(run, (unfamiliar.get(run) ?? 0) + 1);
    run = '';
  };
  let i = 0;
  while (i < chars.length) {
    const cp = chars[i].codePointAt(0)!;
    if (!isHanCodePoint(cp)) {
      flush();
      i++;
      continue;
    }
    let matched = 0;
    for (let len = Math.min(index.maxWordLength, chars.length - i); len >= 1; len--) {
      const cand = chars.slice(i, i + len).join('');
      const row = index.byHanzi.get(cand);
      if (row && row.tier >= 1 && noteKind(cand) === 'word') {
        matched = len;
        const f = familiar.get(cand) ?? { hanzi: cand, status: statusOf(row), count: 0 };
        f.count++;
        familiar.set(cand, f);
        break;
      }
    }
    if (matched > 0) {
      flush();
      han += matched;
      covered += matched;
      i += matched;
    } else {
      run += chars[i];
      han++;
      i++;
    }
  }
  flush();
  return {
    chars: new Set(hanOf(text)).size,
    familiar: [...familiar.values()].sort((a, b) => b.count - a.count).slice(0, 300),
    unfamiliar: [...unfamiliar.entries()].map(([t, count]) => ({ text: t, count })).sort((a, b) => b.count - a.count || b.text.length - a.text.length).slice(0, 200),
    coverage: han ? Math.round((covered / han) * 100) / 100 : 0,
  };
}

/** A spread of known words (2-character words first) to show the agent the learner's level. */
export function levelSample(index: VocabIndex, n = 80): string[] {
  const known = [...index.byHanzi.values()].filter((r) => r.tier >= 2 && noteKind(r.hanzi) === 'word');
  known.sort((a, b) => Math.abs([...a.hanzi].length - 2) - Math.abs([...b.hanzi].length - 2) || a.hanzi.localeCompare(b.hanzi));
  const pool = known.slice(0, Math.max(n * 4, n));
  const step = Math.max(1, Math.floor(pool.length / n));
  const out: string[] = [];
  for (let i = 0; i < pool.length && out.length < n; i += step) out.push(pool[i].hanzi);
  return out;
}
