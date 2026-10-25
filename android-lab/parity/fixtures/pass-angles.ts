/**
 * Golden vectors for Hard mode in the homework pass (shared/homework/pass-angles.ts, docs/HOMEWORK.md
 * §3e): passAnglePlan over random passes (words with / without each card type and audio, Not yet /
 * Got it on note ids and step ids, done, undo, other items, equal timestamps), every mode; the
 * per-showing rules (passHardApplies, secondAngleType, passAnswerItemId, step ids) and the words.
 * Writes pass-angles.json; checked by core/…/PassAnglesParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  firstAngleType,
  parsePassHardMode,
  parsePassStepId,
  passAngleLine,
  passAnglePlan,
  passAnglesLabel,
  passAnswerItemId,
  passHardApplies,
  passHardModeChipLabel,
  passStepId,
  passWordMissed,
  secondAngleType,
  PASS_GAVE_UP_BLOCKED,
  PASS_GAVE_UP_LINE,
  PASS_ROUND_SKIP_NOTE,
  PASS_HARD_MODE_DESCRIPTION,
  PASS_HARD_MODE_OPTION,
  PASS_HARD_MODE_OPTION_HINT,
  type PassEvent,
  type PassWord,
} from '../../../shared/homework';

const OUT = process.argv[2];
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
const r = rng(20261025);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const;
const MODES = ['off', 'red', 'all'] as const;

const randomTypes = (): string[] => {
  if (r() < 0.6) return [...TYPES];
  if (r() < 0.1) return [];
  return TYPES.filter(() => r() < 0.6);
};

const plans = Array.from({ length: 400 }, () => {
  const n = int(0, 8);
  const words: PassWord[] = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, cardTypes: randomTypes(), hasAudio: r() < 0.7 }));
  if (n > 0 && r() < 0.1) words.push({ ...pick(words) });
  const events: PassEvent[] = [];
  const m = int(0, 26);
  for (let i = 0; i < m; i++) {
    // Mostly increasing times, some equal.
    const created_at = `2026-10-25T10:${String(Math.min(59, Math.floor(i * 2 + int(-1, 1) + 1))).padStart(2, '0')}:00.000Z`;
    if (events.length && r() < 0.15) {
      const target = r() < 0.85 ? pick(events).id ?? '' : 'unknown';
      const of = events.find((e) => e.id === target);
      events.push({ id: `u${i}`, item_id: of?.item_id ?? 'n0', result: 'undo', created_at, undoes: target || null });
      continue;
    }
    const word = r() < 0.05 ? 'other' : `n${int(0, Math.max(0, n - 1))}`;
    const step = r() < 0.4;
    const item = step ? `${word}#${pick(TYPES)}` : word;
    const result = step ? pick(['right', 'right', 'right', 'wrong'] as const) : pick(['right', 'wrong', 'wrong', 'done'] as const);
    events.push({ id: r() < 0.03 ? '' : `e${i}`, item_id: item, result, created_at });
  }
  const mode = pick(MODES);
  const plan = passAnglePlan(words, events, mode);
  const missed = words.map((w) => passWordMissed(w.id, events));
  return { words, events, mode, plan, missed };
});

const rules = Array.from({ length: 200 }, () => {
  const word: PassWord = { id: 'w', cardTypes: randomTypes(), hasAudio: r() < 0.6 };
  const cardType = pick([...TYPES, 'other']);
  const done = TYPES.filter(() => r() < 0.3);
  const mode = pick(MODES);
  const missed = r() < 0.5;
  const right = r() < 0.6;
  const hard = r() < 0.6;
  const angle = pick([1, 2] as const);
  return {
    word,
    cardType,
    done,
    mode,
    missed,
    right,
    hard,
    angle,
    first: firstAngleType(word),
    second: secondAngleType(word, cardType, done),
    second_none_done: secondAngleType(word, cardType),
    applies: passHardApplies({ mode, cardType, missed }),
    item_id: passAnswerItemId({ showing: { noteId: 'w', cardType, angle, retry: false }, word, right, hard }),
    angle_line: passAngleLine({ angle, cardType }),
  };
});

const ids = ['n1', 'n1#hanzi_to_meaning', 'a#b#meaning_to_hanzi', '#x', 'x#', '', 'plain'];
const words = {
  parse: [null, '', 'off', 'red', 'all', '1', 'junk'].map((raw) => ({ raw, mode: parsePassHardMode(raw) })),
  step_ids: ids.map((id) => ({ id, parsed: parsePassStepId(id) })),
  step_id: passStepId('note-1', 'meaning_to_hanzi'),
  labels: MODES.map((m) => ({ mode: m, angles: passAnglesLabel(m), chip: passHardModeChipLabel(m), option: PASS_HARD_MODE_OPTION[m], hint: PASS_HARD_MODE_OPTION_HINT[m] })),
  description: PASS_HARD_MODE_DESCRIPTION,
  gave_up_line: PASS_GAVE_UP_LINE,
  round_skip_note: PASS_ROUND_SKIP_NOTE,
  gave_up_blocked: PASS_GAVE_UP_BLOCKED,
};

writeFileSync(join(OUT, 'pass-angles.json'), JSON.stringify({ plans, rules, words }));
