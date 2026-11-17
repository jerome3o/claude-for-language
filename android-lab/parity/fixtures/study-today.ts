/**
 * "⚡ Study it today" golden vectors (docs/STUDY_SESSION.md "⚡ Study it today"), from the web app's own
 * TypeScript — shared/decks/study-today.ts: what ONE tap bumps from anywhere (an unstarted word's listening
 * card — with "Start new words by ear" even before its clip exists —, else its lead card + the long-term opt-in; a started word's listening card; the whole note without
 * one), the button labels / hint and the toast.
 * Writes study-today.json; core StudyTodayParityTest asserts StudyToday.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  studyTodayHint, studyTodayKindOfRow, studyTodayLabel, studyTodayMessage, studyTodayPlan, type StudyTodayKind,
} from '../../../shared/decks/study-today';
import type { LongTermPref } from '../../../shared/decks/long-term';
import { addedToDeckOpenLink, studyTodayOpenLink } from '../../../shared/decks/open-links';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: study-today <out-dir>');
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
const rand = rng(20261115);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];
const PREFS: LongTermPref[] = [null, 0, 1];
const KINDS: StudyTodayKind[] = ['listening', 'lead', 'whole'];

const plans: unknown[] = [];
for (let i = 0; i < 600; i++) {
  const types = rand() < 0.1 ? [] : TYPES.filter(() => rand() < 0.8);
  const started = rand() < 0.45;
  const cards = types.map(t => ({ card_type: t, queue: started ? (rand() < 0.4 ? 0 : pick([1, 2, 3])) : (rand() < 0.85 ? 0 : pick([1, 2, 3])) }));
  const hasAudio = rand() < 0.7;
  const known = rand() < 0.4;
  const longTermPref = pick(PREFS);
  const deckInReview = rand() < 0.6;
  const newWordsByEar = rand() < 0.5;
  const p = studyTodayPlan({ cards, started, hasAudio, newWordsByEar, knownCharactersLead: () => known, longTermPref, deckInReview });
  plans.push({ cards, started, hasAudio, newWordsByEar, known, longTermPref, deckInReview, plan: { ...p, longTerm: p.longTerm === undefined ? 'keep' : p.longTerm } });
}

const copy: unknown[] = [];
for (const kind of KINDS) {
  for (const started of [false, true]) {
    copy.push({ kind, started, off: studyTodayLabel(kind, false), on: studyTodayLabel(kind, true), hint: studyTodayHint(kind, started) });
  }
}
const rows = [null, [], ['audio_to_hanzi'], ['hanzi_to_meaning'], ['meaning_to_hanzi'], ['meaning_to_hanzi', 'audio_to_hanzi']].map(t => ({ cardTypes: t, kind: studyTodayKindOfRow(t) }));

const WORDS = ['银行', '学生', '火车', '服务员', '老师', ''];
const messages: unknown[] = [];
for (let i = 0; i < 150; i++) {
  const n = Math.floor(rand() * 5);
  const added = Array.from({ length: n }, () => ({ hanzi: pick(WORDS), kind: rand() < 0.6 ? 'listening' as StudyTodayKind : pick(KINDS) }));
  const already = rand() < 0.3 ? Math.floor(rand() * 3) : 0;
  messages.push({ added, already, message: studyTodayMessage(added, already) });
}

// "Open ›" on the toasts (shared/decks/open-links.ts → core OpenLinks.kt).
const IDS = ['n1', 'n2', 'n 3', '', ' ', 'n1'];
const links: unknown[] = [];
for (let i = 0; i < 120; i++) {
  const n = Math.floor(rand() * 4);
  const notes = Array.from({ length: n }, () => ({ noteId: rand() < 0.1 ? null : pick(IDS), hanzi: rand() < 0.2 ? null : pick(WORDS) }));
  const deckId = rand() < 0.2 ? null : pick(['d1', 'd 2', '']);
  const deckName = rand() < 0.2 ? null : pick(['From readers', '', 'HSK 2']);
  links.push({
    notes, deckId, deckName,
    added: addedToDeckOpenLink({ noteIds: notes.map(x => x.noteId), deckId, deckName, hanzi: notes[0]?.hanzi ?? null }),
    bumped: studyTodayOpenLink(notes),
  });
}

writeFileSync(join(OUT, 'study-today.json'), JSON.stringify({ plans, copy, rows, messages, links }));
console.log(`study-today: ${plans.length} plans, ${messages.length} messages`);
