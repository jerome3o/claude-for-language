/**
 * The Sentence round (docs/STUDY_SESSION.md "Sentence round"): with Settings → Study → "Sentence
 * round before the answer" on, a reading (hanzi → meaning) or meaning (meaning → hanzi) card in the
 * regular study session goes from its question to a round of FOUR sentence exercises before the
 * answer side — two READ (a Chinese sentence: read it aloud) and two TRANSLATE (an English
 * sentence: say it in Chinese), easiest → harder — and ANY two said right open the answer with
 * Good / Easy already unlocked (the gate's count carries over: `sentenceGate` in
 * sentencePractise.ts counts the round's exercise ids). Skip (quiet, asks first) goes to the answer,
 * where the gate still applies. Like Worldle: one item, a ladder of harder questions about it.
 *
 * Each take is judged exactly like the rows' 🎤 (`sentenceTake` / `sentencePractiseResult`, the
 * translate take's online answer check) — practice only, nothing recorded.
 *
 * **Sentences by ear** (Settings → Study → "Sentences by ear in Hard mode", on by default, per device;
 * Jerome: "I'm getting better at reading words than understanding them by ear"): a read slot becomes a
 * LISTEN exercise whenever its sentence can be heard (a clip on the device, and English to check
 * against — or offline, where he checks himself): the clip plays with no text, he gives the meaning in
 * English (voice first), Claude's lesson answer check judges it online (`listenCheckInput`), then the
 * Chinese, pinyin and English show. A sentence with no clip keeps its read exercise.
 *
 * Pure; the Lab app's port (core `SentenceRound.kt`) is parity-tested (parity/fixtures/sentence-round.ts).
 */
import { SENTENCE_GATE_CARD_TYPES, SENTENCE_GATE_TARGET, type SentencePractiseMode } from './sentencePractise';
import { compareLeastKnown, isFreshSentence, sentenceHistoryKey, type SentenceStats } from './sentenceHistory';
import type { AnswerCheckInput, AnswerCheckVerdict } from '../lesson/answerCheck';

/** How many exercises a round offers at most (2 read / listen + 2 translate, one sentence each). */
export const SENTENCE_ROUND_SIZE = 4;

/** An exercise's mode: read / translate (the rows' 🎤 modes) or listen ("Sentences by ear"). */
export type RoundMode = SentencePractiseMode | 'listen';

/** One of the card's sentences, in the list's order (the card's own first, then the set easiest → hardest). */
export interface RoundSentence {
  /** The row key (`clue:<noteId>` or the set row's id). */
  key: string;
  hanzi: string;
  /** The English ('' / null = none: that sentence can't be a translate exercise). */
  translation: string | null | undefined;
  /** Its clip can be played now (a clip, streamed online or on the device): it may be a listen exercise. */
  audio?: boolean;
}

export interface RoundSentenceSource {
  /** The note's own sentence (sentence_clue), if any. */
  clue: { key: string; hanzi: string; translation: string | null | undefined } | null;
  /** The generated set, in its order (easiest → hardest). */
  set: readonly RoundSentence[];
}

/**
 * The card's sentences as one list — exactly the answer side's list: the card's own sentence
 * first unless a set row says the same thing, then the set.
 */
export function roundSentences(source: RoundSentenceSource): RoundSentence[] {
  const out: RoundSentence[] = [];
  const clue = source.clue;
  if (clue && clue.hanzi.trim() && !source.set.some((s) => s.hanzi === clue.hanzi)) {
    out.push({ key: clue.key, hanzi: clue.hanzi, translation: clue.translation });
  }
  for (const s of source.set) out.push({ key: s.key, hanzi: s.hanzi, translation: s.translation });
  return out;
}

export interface RoundExercise {
  /** `read:<key>` / `translate:<key>` / `listen:<key>` — what the round (and the gate) counts. */
  id: string;
  /** The sentence's row key. */
  key: string;
  mode: RoundMode;
  /** Where the sentence sits in the card's list (0 = the easiest). */
  index: number;
}

export function roundExerciseId(mode: RoundMode, key: string): string {
  return `${mode}:${key}`;
}

const hasTranslation = (s: RoundSentence) => !!(s.translation ?? '').trim();

/** How the round is picked: "Sentences by ear" on (`byEar`) and the connection (Claude's check needs it). */
export interface RoundPickOptions {
  byEar?: boolean;
  online?: boolean;
  /** The card's own hanzi: a sentence that says exactly the same is never an exercise (`isCardHanziSentence`). */
  cardHanzi?: string;
}

/** Letters and digits only, lower-cased: punctuation, spaces and symbols never count. */
function bareChinese(text: string): string {
  return text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

/**
 * This sentence IS the card's own text (a sentence card: 你和你妈妈除了聊这个，还聊什么了？ with that same
 * sentence as its clue) — punctuation, spaces and case aside. The round never offers it: he just read /
 * typed / heard it on the question, so "Read it aloud" of it would be a free point. '' never matches.
 */
export function isCardHanziSentence(hanzi: string, cardHanzi: string | null | undefined): boolean {
  const card = bareChinese(cardHanzi ?? '');
  return card.length > 0 && bareChinese(hanzi) === card;
}

/**
 * How many of the card's sentences the (reading / meaning) round can use: not hidden, and not the card's
 * own text (`isCardHanziSentence`). 0 = no round. The listening card's is `listenRoundSentenceCount`.
 */
export function roundSentenceCount(
  sentences: readonly Pick<RoundSentence, 'key' | 'hanzi'>[],
  stats?: ReadonlyMap<string, SentenceStats>,
  cardHanzi?: string | null,
): number {
  return sentences.filter((s) => !stats?.get(sentenceHistoryKey(s.key))?.hidden && !isCardHanziSentence(s.hanzi, cardHanzi)).length;
}

/**
 * This sentence is a listen exercise in a read slot: "Sentences by ear" on, a clip it can play, and
 * English for Claude to check the meaning against — offline the English isn't needed (he checks himself).
 */
export function canListenTo(s: Pick<RoundSentence, 'translation' | 'audio'>, opts: RoundPickOptions | undefined): boolean {
  if (!opts?.byEar || !s.audio) return false;
  return opts.online === false || !!(s.translation ?? '').trim();
}

/**
 * The list's "spread order": the easiest, the hardest and evenly between first (four spread over the
 * list), then the rest easiest first. With no history this is the round — so a new word gets an easy
 * sentence and a hard one, not just the first four.
 */
export function spreadOrder(n: number): number[] {
  if (n <= 0) return [];
  const m = Math.min(SENTENCE_ROUND_SIZE, n);
  const first: number[] = [];
  for (let k = 0; k < m; k++) first.push(m === 1 ? 0 : Math.round((k * (n - 1)) / (m - 1)));
  const rest: number[] = [];
  for (let i = 0; i < n; i++) if (!first.includes(i)) rest.push(i);
  return [...first, ...rest];
}

/**
 * The round's exercises, in the order shown. Hidden sentences are left out. Four slots — read,
 * translate, read, translate — each takes a FRESH sentence first (never practised in EITHER mode,
 * `isFreshSentence`: a sentence read once never comes back as a translate exercise while fresh ones
 * wait), then the one he knows LEAST in that mode (never practised in it, then fewest rights, most
 * misses, longest ago: `compareLeastKnown`), ties in spread order;
 * every slot a different sentence, a translate only where the sentence has English (else that slot
 * reads). Shown easiest → harder. A sentence is in AT MOST ONE exercise (its English would answer
 * the other): fewer than four sentences = fewer exercises (3 → 3, 2 → read + translate when it can,
 * 1 → 1), and the word asks for more (`wantsMoreSentences`, reason few). Deterministic: the same list
 * and history give the same round in both apps.
 *
 * Sentences by ear (`opts.byEar`): a read slot is a LISTEN exercise for a sentence that can be heard
 * (`canListenTo`) — and prefers such a sentence (after fresh-first, before least-known, which then
 * compares the listen history); a sentence with no clip keeps read. Translate slots are unchanged.
 *
 * A sentence that is the card's own text (`opts.cardHanzi`, `isCardHanziSentence`) is left out like a
 * hidden one: it would ask him to read the question he has just answered.
 */
export function pickRoundExercises(
  sentences: readonly RoundSentence[],
  stats?: ReadonlyMap<string, SentenceStats>,
  opts?: RoundPickOptions,
): RoundExercise[] {
  const statsOf = (s: RoundSentence) => stats?.get(sentenceHistoryKey(s.key));
  const visible = sentences
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => !statsOf(s)?.hidden && !isCardHanziSentence(s.hanzi, opts?.cardHanzi));
  const n = visible.length;
  if (n === 0) return [];
  const spread = spreadOrder(n);
  const rank = new Map(spread.map((pos, r) => [pos, r]));
  // What a slot asks of the sentence at pos: translate, or (a read slot) listen when it can be heard, else read.
  const slotMode = (slot: SentencePractiseMode, pos: number): RoundMode =>
    slot === 'translate' ? 'translate' : canListenTo(visible[pos].s, opts) ? 'listen' : 'read';
  const best = (slot: SentencePractiseMode, used: Set<number>, avoidTranslatable = false): number | null => {
    let pick: number | null = null;
    for (let pos = 0; pos < n; pos++) {
      if (used.has(pos)) continue;
      if (slot === 'translate' && !hasTranslation(visible[pos].s)) continue;
      if (avoidTranslatable && hasTranslation(visible[pos].s)) continue;
      if (pick == null) { pick = pos; continue; }
      const freshPos = isFreshSentence(statsOf(visible[pos].s));
      const freshPick = isFreshSentence(statsOf(visible[pick].s));
      if (freshPos !== freshPick) { if (freshPos) pick = pos; continue; }
      const modePos = slotMode(slot, pos);
      const modePick = slotMode(slot, pick);
      // By ear: a sentence that can be heard before one that can only be read.
      if ((modePos === 'listen') !== (modePick === 'listen')) { if (modePos === 'listen') pick = pos; continue; }
      const c = compareLeastKnown(statsOf(visible[pos].s)?.[modePos], statsOf(visible[pick].s)?.[modePick]);
      if (c < 0 || (c === 0 && rank.get(pos)! < rank.get(pick)!)) pick = pos;
    }
    return pick;
  };
  const used = new Set<number>();
  const picked: { pos: number; mode: RoundMode }[] = [];
  const m = Math.min(SENTENCE_ROUND_SIZE, n);
  for (let k = 0; k < m; k++) {
    const want: SentencePractiseMode = k % 2 === 0 ? 'read' : 'translate';
    // A read slot leaves the sentences with English to the translate slots still to come when they
    // are just enough for them (2 sentences, one with English → read the other, translate that one).
    let translateSlotsLeft = 0;
    for (let j = k + 1; j < m; j++) if (j % 2 === 1) translateSlotsLeft++;
    let translatableLeft = 0;
    for (let pos = 0; pos < n; pos++) if (!used.has(pos) && hasTranslation(visible[pos].s)) translatableLeft++;
    const spare = want === 'read' && translateSlotsLeft > 0 && translatableLeft <= translateSlotsLeft;
    let pos = (spare ? best(want, used, true) : null) ?? best(want, used);
    let slot = want;
    if (pos == null && want === 'translate') {
      pos = best('read', used);
      slot = 'read';
    }
    if (pos == null) break;
    used.add(pos);
    picked.push({ pos, mode: slotMode(slot, pos) });
  }
  const make = (pos: number, mode: RoundMode): RoundExercise => {
    const { s, index } = visible[pos];
    return { id: roundExerciseId(mode, s.key), key: s.key, mode, index };
  };
  // One exercise per sentence: a sentence's English is never the answer to another exercise (nor the
  // other way round), so a sentence never comes twice. Fewer sentences = fewer exercises.
  return picked.slice().sort((a, b) => a.pos - b.pos).map((p) => make(p.pos, p.mode));
}

// --- the listening card's round: "say it in Chinese" -------------------------------------------

/** How many exercises the listening card's round offers at most. */
export const LISTEN_ROUND_SIZE = 3;

/** The card's own sentence (`clue:<noteId>`, the key both lists use). */
export function isCardSentenceKey(key: string): boolean {
  return key.startsWith('clue:');
}

/** Spaces (ASCII and the ideographic one) never count when looking for the word in a sentence. */
function squeeze(text: string): string {
  return text.replace(/[ \t\n\r\u3000]+/g, '');
}

/**
 * The sentences the listening card's round can ask for (Jerome: "for the listening card … maybe I should
 * just get a few English sentences that I need to say"): the card's own sentence and the set's sentences
 * that contain the word, each with English (it is the question), not hidden, and not the word itself
 * (`isCardHanziSentence`: a sentence card's own sentence is what he just heard). In list order.
 */
export function listenRoundCandidates(
  sentences: readonly RoundSentence[],
  word: string,
  stats?: ReadonlyMap<string, SentenceStats>,
): { s: RoundSentence; index: number }[] {
  const w = squeeze(word);
  return sentences
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => hasTranslation(s) && !stats?.get(sentenceHistoryKey(s.key))?.hidden && !isCardHanziSentence(s.hanzi, word))
    .filter(({ s }) => isCardSentenceKey(s.key) || !w || squeeze(s.hanzi).includes(w));
}

/**
 * The listening card's round: up to `LISTEN_ROUND_SIZE` "🔁 Say it in Chinese" exercises — the English up,
 * he says the sentence in Chinese (judged like the round's translate take). Fresh sentences first
 * (`isFreshSentence`), then the ones he knows LEAST in translate mode (`compareLeastKnown`; ties: list order), shown easiest → harder. Any two right
 * (`sentenceRoundProgress`) open the answer with Good / Easy. Deterministic (parity-tested).
 */
export function pickListenRoundExercises(
  sentences: readonly RoundSentence[],
  word: string,
  stats?: ReadonlyMap<string, SentenceStats>,
): RoundExercise[] {
  const full = (s: RoundSentence) => stats?.get(sentenceHistoryKey(s.key));
  const fresh = (s: RoundSentence) => (isFreshSentence(full(s)) ? 0 : 1);
  const ranked = listenRoundCandidates(sentences, word, stats)
    .slice()
    .sort((a, b) => fresh(a.s) - fresh(b.s) || compareLeastKnown(full(a.s)?.translate, full(b.s)?.translate) || a.index - b.index)
    .slice(0, LISTEN_ROUND_SIZE);
  return ranked
    .sort((a, b) => a.index - b.index)
    .map(({ s, index }) => ({ id: roundExerciseId('translate', s.key), key: s.key, mode: 'translate' as const, index }));
}

/** The listening card's gate counts these (the round's needed: min(2, this)). */
export function listenRoundSentenceCount(
  sentences: readonly RoundSentence[],
  word: string,
  stats?: ReadonlyMap<string, SentenceStats>,
): number {
  return listenRoundCandidates(sentences, word, stats).length;
}

/** The listening round's lead line, before "Get any 2 of these 3 right". */
export const LISTEN_ROUND_LEAD = 'You heard it — now say these in Chinese.';
/** Offline (or no microphone): say it aloud, show the Chinese, check yourself. */
export const LISTEN_ROUND_SELF_CHECK_NOTE = 'Say each one out loud, then show the Chinese and check yourself.';
export const LISTEN_ROUND_SHOW_CHINESE = 'Show the Chinese';
export const LISTEN_ROUND_SELF_RIGHT = 'I said it';
export const LISTEN_ROUND_SELF_WRONG = 'Not quite';

/** Under the listening round's title: "You heard it — now say these in Chinese. Get any 2 of these 3 right". */
export function listenRoundIntro(p: RoundProgress, exerciseCount: number): string {
  return `${LISTEN_ROUND_LEAD} ${sentenceRoundIntro(p, exerciseCount)}`;
}

/** The round happens on this showing: the setting on, a gated card type, and not known to have no sentences. */
export function sentenceRoundOpens(args: { enabled: boolean; cardType: string; sentenceCount: number | null }): boolean {
  if (!args.enabled || !SENTENCE_GATE_CARD_TYPES.includes(args.cardType)) return false;
  return args.sentenceCount == null || args.sentenceCount > 0;
}

export interface RoundProgress {
  /** Exercises to get right: two, or as many sentences as the card has. */
  needed: number;
  /** Got right so far (distinct exercises of this round, capped at `needed`). */
  got: number;
  /** Enough right: the answer opens with Good / Easy unlocked. */
  done: boolean;
}

/**
 * The round's progress. A right id counts when it is one of the exercises — or, given `sentenceKeys`
 * (the sentences in rotation), any read / translate id of those: a round shown again (back from the
 * coach, a reload) may pick other exercises once this showing's takes are in the history, and what was
 * already right must still count.
 */
export function sentenceRoundProgress(
  exercises: readonly RoundExercise[],
  rightIds: readonly string[],
  sentenceKeys?: readonly string[],
): RoundProgress {
  const sentences = new Set(exercises.map((e) => e.key)).size;
  const needed = Math.min(SENTENCE_GATE_TARGET, sentences);
  const ids = new Set(exercises.map((e) => e.id));
  for (const k of sentenceKeys ?? []) {
    ids.add(roundExerciseId('read', k));
    ids.add(roundExerciseId('translate', k));
    ids.add(roundExerciseId('listen', k));
  }
  const got = Math.min(needed, new Set(rightIds.filter((id) => ids.has(id))).size);
  return { needed, got, done: needed > 0 && got >= needed };
}

// --- words (both apps) --------------------------------------------------------------------------

export const SENTENCE_ROUND_TITLE = 'Sentence round';
export const SENTENCE_ROUND_SKIP = 'Skip to the answer';
/**
 * Skip is quiet (muted text, no outline) and asks first (Jerome: "the button should be kind of greyed
 * out and not look clickable, but you can click it, and there should be a little pop up"): the
 * question, then Skip / Keep going. No line under it explains the gate — the flow says it.
 */
export const SENTENCE_ROUND_SKIP_CONFIRM = 'Skip this exercise?';
export const SENTENCE_ROUND_SKIP_CONFIRM_YES = 'Skip';
export const SENTENCE_ROUND_SKIP_CONFIRM_NO = 'Keep going';
export const SENTENCE_ROUND_TRY_AGAIN = 'Try again';
export const SENTENCE_ROUND_SEE_ANSWER = 'See the answer';
export const SENTENCE_ROUND_SHOW_ENGLISH = 'Show English';
export const SENTENCE_ROUND_HIDE_ENGLISH = 'Hide English';

/** The read exercise's small tap-to-reveal toggle (like the sentence rows' EN). */
export const SENTENCE_ROUND_ENGLISH_CHIP = 'EN';
/** A card sentence with no English on the note: fetched as it is shown (the rows' words). */
export const SENTENCE_ROUND_TRANSLATION_OFFLINE = 'Translation needs a connection';
export const SENTENCE_ROUND_TRANSLATING = 'Translating…';
export const SENTENCE_ROUND_TRANSLATION_FAILED = 'Couldn’t get the English';

/**
 * Whether a 📖 Read it aloud exercise shows its English line. Before an attempt: hidden (it's a
 * reading exercise) — the small EN reveals it. Once judged — ✓ Right, ≈ Nearly or ✗ Not quite — at
 * once (Jerome: "there is no English version here, so I can't read what the English is"); EN hides
 * it again. `toggled` = his own EN on this showing (null / undefined = he hasn't touched it). While a
 * take is still being judged (answered, no status yet) it waits. A translate exercise's English is its
 * question: always up.
 */
export function roundEnglishShown(
  mode: RoundMode,
  status: 'right' | 'close' | 'wrong' | null,
  answered: boolean,
  toggled: boolean | null | undefined,
): boolean {
  if (mode === 'translate') return true;
  // A listen exercise's English is its answer: only once he has answered (or asked to see it).
  if (mode === 'listen') return answered;
  if (toggled != null) return toggled;
  return answered && status != null;
}
/** Each exercise's heading. */
export const SENTENCE_ROUND_PROMPT: Record<RoundMode, string> = {
  read: '📖 Read it aloud',
  translate: '🔁 Say it in Chinese',
  listen: '👂 What does it mean?',
};

/** The counter: "1 / 2". */
export function sentenceRoundCounter(p: RoundProgress): string {
  return `${p.got} / ${p.needed}`;
}

/** Under the title: "Get any 2 of these 4 right". */
export function sentenceRoundIntro(p: RoundProgress, exerciseCount: number): string {
  if (p.needed === 1) return exerciseCount > 1 ? `Get any 1 of these ${exerciseCount} right` : 'Get this one right';
  return `Get any ${p.needed} of these ${exerciseCount} right`;
}

/** After a right take: "🎉 Nice — 1 / 2" … "🎉 2 / 2 — Good and Easy unlocked". */
export function sentenceRoundCheer(p: RoundProgress): string {
  return p.done ? `🎉 ${p.got} / ${p.needed} — Good and Easy unlocked` : `🎉 Nice — ${p.got} / ${p.needed}`;
}

/** An exercise's result line (icon + words: never colour alone). */
export const SENTENCE_ROUND_RESULT: Record<'right' | 'close' | 'wrong', string> = {
  right: '✓ Right',
  close: '≈ Nearly',
  wrong: '✗ Not quite',
};

// --- the round on the answer side --------------------------------------------------------------

/** How an exercise of this showing's round went (right sticks; untried = never said). */
export type RoundOutcome = 'right' | 'close' | 'wrong' | 'untried';

/** One exercise of the round as shown, and its last judged take (resume point `round_log`). */
export interface RoundLogEntry {
  id: string;
  result?: 'right' | 'close' | 'wrong' | null;
}

/** `read:<key>` / `translate:<key>` / `listen:<key>` → its parts (null = not an exercise id). */
export function roundExerciseParts(id: string): { mode: RoundMode; key: string } | null {
  const at = id.indexOf(':');
  if (at <= 0) return null;
  const mode = id.slice(0, at);
  if (mode !== 'read' && mode !== 'translate' && mode !== 'listen') return null;
  const key = id.slice(at + 1);
  return key ? { mode, key } : null;
}

/** A sentence of the answer side's list that was in the round: its outline and label. */
export interface RoundRowMark {
  key: string;
  mode: RoundMode;
  outcome: RoundOutcome;
  label: string;
}

/** "In the round · ✓ Right" / "· ≈ Nearly" / "· ✗ Not quite" / "In the round" (icon + words, never colour alone). */
export function roundRowLabel(outcome: RoundOutcome): string {
  return outcome === 'untried' ? 'In the round' : `In the round · ${SENTENCE_ROUND_RESULT[outcome]}`;
}

/**
 * The round's sentences for the answer side, in the round's order (each sentence once): right when it
 * was said right on this showing (`rightIds` — the gate's count — or its last take), else its last
 * result, else untried (he skipped it).
 */
export function roundRowMarks(log: readonly RoundLogEntry[], rightIds: readonly string[]): RoundRowMark[] {
  const right = new Set(rightIds);
  const seen = new Set<string>();
  const out: RoundRowMark[] = [];
  for (const entry of log) {
    const parts = roundExerciseParts(entry.id);
    if (!parts || seen.has(parts.key)) continue;
    seen.add(parts.key);
    const outcome: RoundOutcome = right.has(entry.id) || entry.result === 'right' ? 'right' : entry.result ?? 'untried';
    out.push({ key: parts.key, mode: parts.mode, outcome, label: roundRowLabel(outcome) });
  }
  return out;
}

/** The answer side's order: the round's sentences first (in the round's order), then the rest as they were. */
export function orderKeysForRound(keys: readonly string[], marks: readonly RoundRowMark[]): string[] {
  const present = new Set(keys);
  const first = marks.map((m) => m.key).filter((k) => present.has(k));
  const firstSet = new Set(first);
  return [...first, ...keys.filter((k) => !firstSet.has(k))];
}

/**
 * The exercises of a round shown before (resume): the logged ids whose sentences are still in
 * rotation, in sentence order — null when none (pick afresh).
 */
export function exercisesFromLog(sentences: readonly RoundSentence[], ids: readonly string[], hidden?: (key: string) => boolean): RoundExercise[] | null {
  const index = new Map(sentences.map((s, i) => [s.key, i]));
  const out: RoundExercise[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const parts = roundExerciseParts(id);
    if (!parts || seen.has(parts.key) || !index.has(parts.key) || hidden?.(parts.key)) continue;
    seen.add(parts.key);
    out.push({ id: roundExerciseId(parts.mode, parts.key), key: parts.key, mode: parts.mode, index: index.get(parts.key)! });
  }
  if (!out.length) return null;
  return out.sort((a, b) => a.index - b.index);
}

// --- Sentences by ear: the listen exercise (docs/STUDY_SESSION.md "Sentences by ear") -------------

/** Settings → Study, next to Hard mode (per device, ON by default). */
export const SENTENCES_BY_EAR_TITLE = 'Sentences by ear in Hard mode';
export const SENTENCES_BY_EAR_HINT =
  'In the Sentence round, hear a sentence and say what it means in English instead of reading it aloud. Off: read and translate only.';
export const SENTENCES_BY_EAR_DEFAULT = true;

/** A stored per-device value ('1' / '0', missing = the default). */
export function parseSentencesByEar(raw: string | null | undefined): boolean {
  if (raw === '0' || raw === 'false') return false;
  if (raw === '1' || raw === 'true') return true;
  return SENTENCES_BY_EAR_DEFAULT;
}

/** The clip again, slower ("0.75×"). */
export const LISTEN_SLOW_RATE = 0.75;

/** How a listen exercise is checked: Claude online with English to compare against; else he checks himself. */
export type ListenCheckBy = 'claude' | 'self';

export function listenCheckBy(online: boolean, translation: string | null | undefined): ListenCheckBy {
  return online && !!(translation ?? '').trim() ? 'claude' : 'self';
}

/**
 * Claude's check of a listen answer: the lesson answer check (`POST /api/lessons/answer-check`) as a
 * MEANING check — exercise_type listen_translate, the Chinese he heard as the prompt, the sentence's English
 * as the model answer, his English as the answer (`isMeaningCheck` in shared/lesson/answerCheck.ts). Cached
 * for everyone; an answer that IS the English is right on the device with no call (`exactAnswerCheck`).
 */
export function listenCheckInput(
  row: { hanzi: string; pinyin?: string | null; translation?: string | null },
  said: string,
  input: 'spoken' | 'edited' | 'typed',
): AnswerCheckInput {
  const out: AnswerCheckInput = {
    prompt_en: row.hanzi.trim(),
    model_answer: (row.translation ?? '').trim(),
    answer: said.trim(),
    exercise_type: 'listen_translate',
    input,
  };
  const pinyin = (row.pinyin ?? '').trim();
  if (pinyin) out.model_pinyin = pinyin;
  return out;
}

/** Claude's verdict → the round's result: correct / acceptable = right (counts), almost = ≈ Nearly, wrong. */
export function listenVerdictResult(verdict: AnswerCheckVerdict): 'right' | 'close' | 'wrong' {
  if (verdict === 'correct' || verdict === 'acceptable') return 'right';
  return verdict === 'almost' ? 'close' : 'wrong';
}

/** The self-check (offline / no English / no check to be had): ✓ Got it = right, ✗ Missed it = wrong. */
export function listenSelfResult(gotIt: boolean): 'right' | 'wrong' {
  return gotIt ? 'right' : 'wrong';
}

/**
 * The listen exercise that has the floor (its clip plays by itself once, its answer box is open): the one
 * he chose (▶ on it) while unanswered, else the first unanswered listen exercise in the round's order;
 * null = none left. One box at a time, so one microphone.
 */
export function listenActiveId(
  exercises: readonly RoundExercise[],
  answeredIds: readonly string[],
  chosen?: string | null,
): string | null {
  const answered = new Set(answeredIds);
  const open = exercises.filter((e) => e.mode === 'listen' && !answered.has(e.id));
  if (chosen && open.some((e) => e.id === chosen)) return chosen;
  return open[0]?.id ?? null;
}

/** A listen exercise whose clip won't play after all (gone, not on the device offline): read it instead. */
export function exerciseAsRead(ex: RoundExercise): RoundExercise {
  return ex.mode === 'listen' ? { ...ex, id: roundExerciseId('read', ex.key), mode: 'read' } : ex;
}

export const LISTEN_EX_PLACEHOLDER = 'What does it mean? (in English)';
export const LISTEN_EX_LISTENING = 'Listening… say what it means in English';
export const LISTEN_EX_CHECKING = 'Checking what you understood…';
export const LISTEN_EX_PLAY = 'Play again';
export const LISTEN_EX_SLOW = '0.75×';
export const LISTEN_EX_SHOW_ANSWER = 'Show the answer';
export const LISTEN_EX_SUBMIT = 'Check';
export const LISTEN_EX_SELF_QUESTION = 'Did you understand it?';
export const LISTEN_EX_GOT_IT = 'Got it';
export const LISTEN_EX_MISSED_IT = 'Missed it';
export const LISTEN_EX_YOU_SAID = 'You said';
export const LISTEN_EX_NO_AUDIO = 'This clip can’t play here — read it instead.';
