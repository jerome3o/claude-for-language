/**
 * "Listen in context" (shared/study/listenContext.ts): row order (the card's sentence first
 * unless the set repeats it, then the set by position), row states, the auto-play choice, the
 * word-first ask, the top-up / "+ More" counts and the labels, over seeded random notes.
 * Writes listen-context.json; core ListenContextParityTest asserts ListenContext.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  listenAutoplay,
  listenContextRows,
  listenRowLabel,
  listenRowState,
  moreSentencesCount,
  needsSentenceTopUp,
  topUpCount,
  wordTapAction,
  type ListenRowState,
} from '../../../shared/study/listenContext';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: listen-context <out-dir>');
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(5150);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
const SENTENCES = ['我去银行。', '银行在哪儿？', '这是银行。', '银行几点开门？', '他在银行工作。', '我们一起去吧。'];
const TRANSLATIONS = ['I go to the bank.', '', '  ', 'Where is it?', null];

const cases = [] as unknown[];
for (let c = 0; c < 200; c++) {
  const n = Math.floor(r() * 7);
  const sentences = Array.from({ length: n }, (_, i) => ({
    id: `s${c}-${i}`,
    hanzi: pick(SENTENCES),
    translation: pick(TRANSLATIONS),
    audio_url: r() < 0.6 ? `generated/s${c}-${i}.mp3` : null,
    position: r() < 0.9 ? Math.floor(r() * 10) : null,
  }));
  const clue = r() < 0.2 ? null : { hanzi: r() < 0.1 ? '  ' : pick(SENTENCES), translation: pick(TRANSLATIONS), audio_url: r() < 0.5 ? 'generated/clue.mp3' : null };
  const rows = listenContextRows(`n${c}`, clue, sentences);
  const online = r() < 0.5;
  const cachedFlags = rows.map(() => r() < 0.5);
  const states: ListenRowState[] = rows.map((row, i) => listenRowState(row, { online, cached: cachedFlags[i] }));
  const played = Math.floor(r() * 3);
  const anyway = r() < 0.3;
  const playable = states.filter((s) => s !== 'unavailable').length;
  cases.push({
    noteId: `n${c}`,
    clue,
    sentences,
    rows,
    online,
    cached: cachedFlags,
    states,
    autoplayOn: listenAutoplay(true, states),
    autoplayOff: listenAutoplay(false, states),
    played,
    anyway,
    wordTap: wordTapAction({ sentencesPlayed: played, playableSentences: playable, playedWordAnyway: anyway }),
    total: rows.length,
    needsTopUp: needsSentenceTopUp(rows.length),
    topUpCount: topUpCount(rows.length),
    moreCount: moreSentencesCount(rows.length),
    labels: rows.map((_, i) => [listenRowLabel(i, false), listenRowLabel(i, true)]),
  });
}

writeFileSync(join(OUT, 'listen-context.json'), JSON.stringify({ cases }));
