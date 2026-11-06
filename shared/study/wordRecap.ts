/**
 * Reader word recap (docs/STUDY_SESSION.md "Reader word recap"). Jerome (Nov 2026): "during a graded
 * reader we remember all of those words [the ones I tap, the ones I say wrong] and then optionally have
 * a recap at the end which is kind of like a one-off … and then maybe we have the option to add them to
 * long term if I want but it's default toggled off, for each of those words."
 *
 * A RUN = one reading of one reader (any reading view: the session's reader, a homework pass,
 * /readers/:id, the Lab's Today's story). While he reads, the run collects
 *   - every word chip he TAPS (→ the explorer) — he didn't remember it, or needed to know it;
 *   - every word a 🎤 Read it aloud take heard WRONG (another character, a tone slip, a missed
 *     character — never a homophone that "sounded right", never extra words), with the reason line.
 *     These are kept for "📖 Ask Claude about this page" (`readerPageWords`) but are NOT recapped:
 *     Jerome (Nov 2026) — a take stopped half-way and started again marked the whole sentence wrong,
 *     so the recap was "basically reading the entire story again". A reader's recap is the words he
 *     TAPPED only (`recapWords`); a chat's recap keeps both (its 🎤 Read it back is the exercise).
 * Words are deduplicated by `recapKey` (the reasons merge), kept on the device (a closed app or the
 * next day loses nothing) and listed in STORY ORDER (page, then place on the page): the recap retells
 * the story, and each card's cue is the sentence the word came from.
 *
 * After the story is finished the reading view offers "📝 Recap N words" (never forced). The recap is
 * a ONE-OFF pass (shared/homework/pass.ts rules: each word once, "Not yet" words come back until
 * "Got it", the retry bar) — practice only, no review events. Each word has a switch, OFF by default:
 * "Add to my long-term review" for a word he doesn't have yet (a new card in the "From my readers"
 * deck, put on Up next), "⚡ Study it today" for one already in his decks (a bump).
 *
 * Pure rules, used by the web app and ported to the Lab app (core WordRecap.kt, parity-tested by
 * android-lab/parity/fixtures/word-recap.ts).
 */
import { passProgress, type PassEvent, type PassProgress } from '../homework/pass';
import { passRetryBar, type RetryBar } from '../homework/retry-bar';
import { passSuggestion, type PassOutcome } from '../homework/pass-card';
import type { SpokenResultState } from '../cards/spoken-result';
import { readAloudDifferences, type ReadAloudResult } from '../reader/readAloud';
import { sentenceAround, type ReaderWord } from '../reader/words';
import { cardTextProblems } from '../cards/standard';
import type { AskRecapWord } from '../coach/askChat';

/** Why a word is in the recap: tapped while reading, or read aloud wrong. */
export type WordRecapReason = 'tapped' | 'said_wrong';

const REASON_ORDER: readonly WordRecapReason[] = ['tapped', 'said_wrong'];

export interface WordRecapWord {
  /** The word as it is on the page (the first time it was collected). */
  hanzi: string;
  /** Its pinyin in context ('' when unknown). */
  pinyin: string;
  /** A short English gloss from the word chip ('' when the chip had none). */
  gloss: string;
  /** The sentence it was met in — the earliest place in the story. */
  sentence: string;
  /** The page's English (its translation; a page is one or two sentences). */
  page_english: string;
  /** 0-based page index and the word's place on the page (code points) — the story order. */
  page: number;
  pos: number;
  /** Why it is here, in a fixed order (tapped, said_wrong). */
  reasons: WordRecapReason[];
  /** What the take heard, one line per character ("都 dū → you said dù (4th tone instead of 1st)"). */
  said: string[];
  /** When it was first collected (ISO). */
  at: string;
}

/**
 * Where a recap's words come from: a reading of a graded reader, or a chat with Claude (the Coach's
 * "💬 Ask Claude" — the words tapped there and the words a 🎤 Read it back found mistakes in,
 * shared/coach/askChat.ts `AskRecapWord`). The pass, the switches and what Done does are the same;
 * the copy, the deck the new words go into and the analytics events follow the source.
 */
export type WordRecapSource = 'reader' | 'chat';

export interface WordRecapRun {
  /**
   * The run's id: the reader's id, or `chat:<thread id>` for a chat run (`chatRecapRunId`). The
   * name stays: runs already stored on devices are keyed by it.
   */
  reader_id: string;
  /** Absent = 'reader' (every run stored before chat recaps existed). */
  source?: WordRecapSource;
  /** Chat runs only: the words recapped in this chat's EARLIER runs (keys) — they don't come back. */
  before?: string[];
  started_at: string;
  /** The story was finished (Finish ✓ / listened to the end) — the recap is offered from then on. */
  finished_at: string | null;
  /** The recap's Done was pressed (the choices applied). */
  recapped_at: string | null;
  words: WordRecapWord[];
  /** The recap's answers: pass events (`item_id` = the word's `recapKey`). */
  events: PassEvent[];
  /** Words whose switch is ON (by key): long-term review for new words, ⚡ for words he has. */
  keep: string[];
}

/** A tapped word chip. `pos` = the word's first code point on the page. */
export interface WordRecapTap {
  text: string;
  pinyin: string;
  gloss: string;
  sentence: string;
  page: number;
  pos: number;
  page_english: string;
}

/** One word a read-aloud take heard wrong. */
export interface WordRecapMistake {
  text: string;
  pinyin: string;
  /** First code point on the page. */
  pos: number;
  /** The reason lines of its wrong / tone / missed characters. */
  said: string[];
}

/** The page a take was read on. `words` = the page's word chips (their texts concatenate to `text`). */
export interface WordRecapPage {
  index: number;
  text: string;
  english: string;
  words: readonly ReaderWord[] | null;
}

const HAN = /\p{Script=Han}/u;

/** The dedupe key: NFC, letters and digits only (punctuation / spaces dropped). */
export function recapKey(text: string): string {
  return text.normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '');
}

/** A word worth recapping: it has a Chinese character. */
export function isRecapWord(text: string): boolean {
  return HAN.test(recapKey(text));
}

export function emptyRecapRun(readerId: string, now: string): WordRecapRun {
  return { reader_id: readerId, started_at: now, finished_at: null, recapped_at: null, words: [], events: [], keep: [] };
}

/**
 * The run a word read in a reading view opened at `openedAt` goes into: the stored run while it is
 * this reader's and not finished before this opening (a story closed half-way carries on, the next
 * day too); otherwise a NEW run — so the last finished run stays recappable until a new reading of
 * the story actually collects a word.
 */
export function recapRunFor(existing: WordRecapRun | null | undefined, readerId: string, openedAt: string, now: string): WordRecapRun {
  if (existing && existing.reader_id === readerId && (!existing.finished_at || existing.finished_at > openedAt)) return existing;
  return emptyRecapRun(readerId, now);
}

/** Story order: page, place on the page, then when it was collected. */
function storyOrder(a: WordRecapWord, b: WordRecapWord): number {
  if (a.page !== b.page) return a.page - b.page;
  if (a.pos !== b.pos) return a.pos - b.pos;
  return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
}

function withReason(reasons: readonly WordRecapReason[], r: WordRecapReason): WordRecapReason[] {
  const set = new Set([...reasons, r]);
  return REASON_ORDER.filter((x) => set.has(x));
}

interface Incoming {
  text: string;
  pinyin: string;
  gloss: string;
  sentence: string;
  page_english: string;
  page: number;
  pos: number;
  reason: WordRecapReason;
  said: readonly string[];
}

function addWord(run: WordRecapRun, w: Incoming, now: string): WordRecapRun {
  const key = recapKey(w.text);
  if (!key || !HAN.test(key)) return run;
  const i = run.words.findIndex((x) => recapKey(x.hanzi) === key);
  let words: WordRecapWord[];
  if (i < 0) {
    words = [
      ...run.words,
      {
        hanzi: w.text, pinyin: w.pinyin, gloss: w.gloss, sentence: w.sentence, page_english: w.page_english,
        page: w.page, pos: w.pos, reasons: [w.reason], said: [...new Set(w.said)], at: now,
      },
    ];
  } else {
    const old = run.words[i];
    // The earliest place in the story gives the sentence (and the order); the first chip's text stays.
    const earlier = w.page < old.page || (w.page === old.page && w.pos < old.pos);
    const merged: WordRecapWord = {
      ...old,
      pinyin: old.pinyin || w.pinyin,
      gloss: old.gloss || w.gloss,
      sentence: earlier ? w.sentence : old.sentence,
      page_english: earlier ? w.page_english : old.page_english,
      page: earlier ? w.page : old.page,
      pos: earlier ? w.pos : old.pos,
      reasons: withReason(old.reasons, w.reason),
      said: [...new Set([...old.said, ...w.said])],
    };
    words = run.words.map((x, j) => (j === i ? merged : x));
  }
  return { ...run, words: [...words].sort(storyOrder) };
}

/** A word chip was tapped (opened in the explorer). Words without Chinese are left out. */
export function addRecapTap(run: WordRecapRun, tap: WordRecapTap, now: string): WordRecapRun {
  return addWord(run, { ...tap, reason: 'tapped', said: [] }, now);
}

const MISTAKE_MARKS = new Set(['wrong', 'close', 'missed']);

/** A reason line of a wrong / tone / missed character (not "extra …", not "— sounded right"). */
function isMistakeReason(line: string): boolean {
  return !line.startsWith('extra ') && !line.includes(' — sounded right (written ');
}

/**
 * The words a take got wrong (`readAloudDifferences` grouped by the page's words): a difference with
 * at least one character read as ANOTHER character, with a tone slip or missed. A homophone-only word
 * ("sounded right") and extra words are not mistakes.
 */
export function recapMistakes(result: ReadAloudResult, words?: readonly string[] | null): WordRecapMistake[] {
  const out: WordRecapMistake[] = [];
  for (const d of readAloudDifferences(result, words)) {
    if (d.end <= d.start) continue;
    const span = result.chars.slice(d.start, d.end);
    if (!span.some((c) => !c.unitCont && MISTAKE_MARKS.has(c.mark))) continue;
    out.push({ text: d.page, pinyin: d.pagePinyin, pos: d.start, said: d.reasons.filter(isMistakeReason) });
  }
  return out;
}

/** Code point `cp` of `text` as a UTF-16 index. */
function utf16At(text: string, cp: number): number {
  let i = 0;
  let n = 0;
  for (const ch of text) {
    if (n === cp) return i;
    i += ch.length;
    n++;
  }
  return i;
}

/** The gloss of the page word starting at code point `pos` with text `text` ('' when none). */
function glossAt(words: readonly ReaderWord[] | null, pos: number, text: string): string {
  if (!words) return '';
  let at = 0;
  for (const w of words) {
    if (at === pos && w.text === text) return w.gloss;
    at += [...w.text].length;
  }
  return '';
}

/** A read-aloud take's result on `page`: its mistakes join the run (a re-take adds more, never removes). */
export function addRecapMistakes(run: WordRecapRun, page: WordRecapPage, result: ReadAloudResult, now: string): WordRecapRun {
  let next = run;
  const texts = page.words ? page.words.map((w) => w.text) : null;
  for (const m of recapMistakes(result, texts)) {
    const from = utf16At(page.text, m.pos);
    const to = utf16At(page.text, m.pos + [...m.text].length);
    next = addWord(next, {
      text: m.text,
      pinyin: m.pinyin,
      gloss: glossAt(page.words, m.pos, m.text),
      sentence: sentenceAround(page.text, from, to),
      page_english: page.english,
      page: page.index,
      pos: m.pos,
      reason: 'said_wrong',
      said: m.said,
    }, now);
  }
  return next;
}

/**
 * The words the recap goes through. A reader's run: only the words he TAPPED (read-aloud mistakes
 * are left out — they stay in the run for Ask Claude), each shown as tapped only. A chat's run: all.
 */
export function recapWords(run: WordRecapRun): WordRecapWord[] {
  if (recapSource(run) === 'chat') return run.words;
  return run.words
    .filter((w) => w.reasons.includes('tapped'))
    .map((w) => (w.reasons.length === 1 && w.said.length === 0 ? w : { ...w, reasons: ['tapped'] as WordRecapReason[], said: [] }));
}

/** The story was finished: the run can be recapped (if it has words). */
export function finishRecapRun(run: WordRecapRun, now: string): WordRecapRun {
  return { ...run, finished_at: now };
}

/** The recap's Done: choices applied. */
export function markRecapped(run: WordRecapRun, now: string): WordRecapRun {
  return { ...run, recapped_at: now };
}

/** The run can be recapped: finished, with at least one word. */
export function recapAvailable(run: WordRecapRun | null | undefined): boolean {
  return !!run && !!run.finished_at && recapWords(run).length > 0;
}

/** The recap's items (word keys) in story order. */
export function recapItemIds(run: WordRecapRun): string[] {
  return recapWords(run).map((w) => recapKey(w.hanzi));
}

/** The word of an item id. */
export function recapWordFor(run: WordRecapRun, key: string): WordRecapWord | null {
  return recapWords(run).find((w) => recapKey(w.hanzi) === key) ?? null;
}

/** Where the pass stands (`passProgress`: unseen in story order, then "Not yet" words oldest first). */
export function recapProgress(run: WordRecapRun): PassProgress {
  return passProgress(recapItemIds(run), run.events);
}

/** The retry bar of the recap (blue = answers given, orange = "Not yet" words still owed). */
export function recapBar(run: WordRecapRun): RetryBar {
  return passRetryBar(recapItemIds(run), run.events);
}

/** Got it / Not yet on a word. */
export function answerRecap(run: WordRecapRun, key: string, right: boolean, now: string, id: string): WordRecapRun {
  return { ...run, events: [...run.events, { id, item_id: key, result: right ? 'right' : 'wrong', created_at: now }] };
}

/** "Go through them again": the answers cleared (the switches stay). */
export function restartRecap(run: WordRecapRun): WordRecapRun {
  return { ...run, events: [], recapped_at: null };
}

/** A word's switch (default OFF). */
export function setRecapKeep(run: WordRecapRun, key: string, on: boolean): WordRecapRun {
  const keep = run.keep.filter((k) => k !== key);
  return { ...run, keep: on ? [...keep, key] : keep };
}

export function isRecapKept(run: WordRecapRun, key: string): boolean {
  return run.keep.includes(key);
}

/** Words got right the FIRST time they were shown (their first answer was Got it). */
export function recapRightFirstTime(run: WordRecapRun): number {
  const first = new Map<string, string>();
  for (const e of run.events) {
    if (e.result !== 'right' && e.result !== 'wrong') continue;
    if (!first.has(e.item_id)) first.set(e.item_id, e.result);
  }
  const ids = new Set(recapItemIds(run));
  let n = 0;
  for (const [id, r] of first) if (ids.has(id) && r === 'right') n++;
  return n;
}

/** What the switches ask for: new words to add, words he has to bump. `owned(key)` = a note with it exists. */
export function recapChoices(run: WordRecapRun, owned: (key: string) => boolean): { add: WordRecapWord[]; bump: WordRecapWord[] } {
  const add: WordRecapWord[] = [];
  const bump: WordRecapWord[] = [];
  for (const w of recapWords(run)) {
    const key = recapKey(w.hanzi);
    if (!run.keep.includes(key)) continue;
    (owned(key) ? bump : add).push(w);
  }
  return { add, bump };
}

/** The deck the chosen new words go into (made on first use, the shared new-deck defaults). */
export const READER_RECAP_DECK = 'From my readers';
export const READER_RECAP_DECK_DESCRIPTION = 'Words you chose to keep from your graded readers.';

/** The longest story sentence used as the card's own example sentence. */
export const RECAP_CLUE_MAX = 24;

/**
 * The story sentence as the new card's sentence_clue, when it suits the card standard: short (≤
 * RECAP_CLUE_MAX characters), one line, containing the word, no forbidden symbols, more than the word
 * itself. '' = let the card writer make one.
 */
export function recapSentenceClue(word: WordRecapWord): string {
  const s = word.sentence.trim();
  if (!s || s.includes('\n') || !s.includes(word.hanzi) || recapKey(s) === recapKey(word.hanzi)) return '';
  if ([...s].length > RECAP_CLUE_MAX) return '';
  if (cardTextProblems({ sentence_clue: s }).length > 0) return '';
  return s;
}

/** "📝 Recap 3 words" — the end-of-story button. */
export function recapPromptLabel(n: number): string {
  return `📝 Recap ${n} ${n === 1 ? 'word' : 'words'}`;
}

/** The prompt's line: "You tapped 2 and read 1 differently" style, from the reasons. */
export function recapPromptLine(run: WordRecapRun): string {
  const words = recapWords(run);
  const tapped = words.filter((w) => w.reasons.includes('tapped')).length;
  const said = words.filter((w) => w.reasons.includes('said_wrong')).length;
  const parts: string[] = [];
  if (tapped) parts.push(`${tapped} you tapped`);
  if (said) parts.push(`${said} you read aloud differently`);
  return parts.length ? `Words from this story: ${parts.join(' · ')}.` : '';
}

/** Why a word is in the recap, one line each. */
export function recapWhyLines(word: WordRecapWord, source: WordRecapSource = 'reader'): string[] {
  const out: string[] = [];
  const chat = source === 'chat';
  if (word.reasons.includes('tapped')) out.push(chat ? 'You tapped it in the chat' : 'You tapped it while reading');
  if (word.reasons.includes('said_wrong')) {
    if (word.said.length === 0) out.push(chat ? 'You read it back differently' : 'You read it aloud differently');
    for (const line of word.said) out.push(`${chat ? 'Read it back' : 'Read aloud'}: ${line}`);
  }
  return out;
}

// ---------- 🎤 Say it (practice only) ----------

/**
 * "🎤 Say it" on a recap card (Jerome, Nov 2026: "I'd love to be able to say these words to practise
 * them in this view"): the Sentence Coach's "Practise saying it" (shared/coach/practise.ts
 * `practiseSentence` — `tidySpokenTranscript` + `checkSpokenAnswer`, homophones by sound, the word said
 * inside a phrase = "Contains the answer") against the card's word, on the question side and on the
 * answer side; the compact "You said" row. Nothing stored: no review event, no recording kept.
 */
export const RECAP_SAY_LABEL = 'Say it';
export const RECAP_SAY_LISTENING = 'Listening… say the word';

/**
 * What a take said BEFORE Show answer suggests on the answer side (the homework pass's
 * `passSuggestion` for a read card's take): said right (a match, a homophone, or the word inside a
 * phrase) → Got it is suggested; a miss suggests nothing (the recogniser can be wrong, and the recap
 * asks whether he knows the word). A take after the reveal never suggests (pass null).
 */
export function recapSaySuggestion(state: SpokenResultState | null): PassOutcome | null {
  if (!state) return null;
  return passSuggestion({ take: { isMatch: state === 'match' || state === 'sound', containsExpected: state === 'contains' } });
}

export const RECAP_KEEP_NEW = 'Add to my long-term review';
export const RECAP_KEEP_OWNED = '⚡ Study it today';

/** The switch's label for a word (`owned` = already in his decks). */
export function recapKeepLabel(owned: boolean): string {
  return owned ? RECAP_KEEP_OWNED : RECAP_KEEP_NEW;
}

/** The line after Done: "2 words added to your long-term review · 1 for today" / "Nothing kept — that's fine". */
export function recapDoneLine(added: number, bumped: number): string {
  const parts: string[] = [];
  if (added) parts.push(`${added} ${added === 1 ? 'word' : 'words'} added to your long-term review`);
  if (bumped) parts.push(`${bumped} for today ⚡`);
  return parts.length ? parts.join(' · ') : 'Nothing kept — that’s fine.';
}

// ---------- Sources: a graded reader or a chat with Claude ----------

/** The run's source (runs stored before chat recaps carry none: a reader). */
export function recapSource(run: Pick<WordRecapRun, 'source'>): WordRecapSource {
  return run.source === 'chat' ? 'chat' : 'reader';
}

/** "from the story “小明在成都”" / "from your chat with Claude" — under the recap's title. */
export function recapSourceLabel(source: WordRecapSource, title?: string | null): string {
  if (source === 'chat') return 'from your chat with Claude';
  const t = (title ?? '').trim();
  return t ? `from the story “${t}”` : 'from your graded reader';
}

/** The summary's hint. */
export function recapKeepHint(source: WordRecapSource): string {
  return `Switch on the words you want to remember on purpose — the rest were just for this ${source === 'chat' ? 'chat' : 'story'}.`;
}

/** The recap page with no words. */
export function recapEmptyLine(source: WordRecapSource): string {
  return source === 'chat'
    ? 'No words to recap from this chat yet. Tap words in Claude’s answers, or read one back — they gather here.'
    : 'No words to recap from this story yet. Tap words while you read — they gather here.';
}

/**
 * The deck chosen new words go into, one per source (made on first use, the shared new-deck
 * defaults, at the bottom of the deck queue — the words themselves go on Up next). A chat's words get
 * their own "From my chats" deck beside "From my readers": the deck says where a word was met, and
 * the readers' deck keeps its name (devices find it by name — renaming it would leave a second deck).
 */
export const CHAT_RECAP_DECK = 'From my chats';
export const CHAT_RECAP_DECK_DESCRIPTION = 'Words you chose to keep from your chats with Claude.';

export function recapDeck(source: WordRecapSource): { name: string; description: string } {
  return source === 'chat'
    ? { name: CHAT_RECAP_DECK, description: CHAT_RECAP_DECK_DESCRIPTION }
    : { name: READER_RECAP_DECK, description: READER_RECAP_DECK_DESCRIPTION };
}

/** Up next's `source` for the chosen new words (shared/decks/up-next.ts UP_NEXT_SOURCES). */
export function recapUpNextSource(source: WordRecapSource): 'reader_recap' | 'chat_recap' {
  return source === 'chat' ? 'chat_recap' : 'reader_recap';
}

/** The bump's `source` for "⚡ Study it today" (shared/decks/bumps.ts BUMP_SOURCES). */
export function recapBumpSource(source: WordRecapSource): 'reader' | 'coach_chat' {
  return source === 'chat' ? 'coach_chat' : 'reader';
}

/**
 * The analytics event of a recap's start / finish (same props for both sources): a reader's are
 * `reader.word_recap_*`, a chat's `coach.ask_recap_*` — so adoption is told per place.
 */
export type WordRecapEvent = `reader.word_recap_${'start' | 'finish'}` | `coach.ask_recap_${'start' | 'finish'}`;
export function recapEvent(source: WordRecapSource, what: 'start' | 'finish'): WordRecapEvent {
  return source === 'chat' ? `coach.ask_recap_${what}` : `reader.word_recap_${what}`;
}

// ---------- A chat's recap ----------

/** The run id of a chat thread's recap. */
export function chatRecapRunId(threadId: string): string {
  return `chat:${threadId}`;
}

/** A chat's recap word as a recap card: its sentence is the message's sentence it was met in. */
export function chatRecapWord(w: AskRecapWord, index: number, at: string): WordRecapWord {
  const line = (w.reason_line ?? '').trim();
  return {
    hanzi: w.hanzi,
    pinyin: (w.pinyin ?? '').trim(),
    gloss: (w.gloss ?? '').trim(),
    sentence: (w.sentence ?? '').trim(),
    page_english: '',
    page: index,
    pos: 0,
    reasons: REASON_ORDER.filter((r) => w.reasons.includes(r)),
    said: line ? [line] : [],
    at,
  };
}

/** Keys this chat recapped before: an earlier run's `before`, plus a recapped run's own words. */
function chatRecappedBefore(stored: WordRecapRun | null | undefined): Set<string> {
  const out = new Set(stored?.before ?? []);
  if (stored?.recapped_at) for (const w of stored.words) out.add(recapKey(w.hanzi));
  return out;
}

/**
 * The chat's words still to recap: those with Chinese, once each (by `recapKey`), in the chat's order,
 * minus the ones an earlier recap of this chat covered. `stored` = the thread's stored run.
 */
export function chatRecapPending(words: readonly AskRecapWord[], stored: WordRecapRun | null | undefined): AskRecapWord[] {
  const before = chatRecappedBefore(stored);
  const seen = new Set<string>();
  const out: AskRecapWord[] = [];
  for (const w of words) {
    const key = recapKey(w.hanzi);
    if (!key || !HAN.test(key) || before.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

/** "📝 N words to recap" in the chat's ⋯ menu (shown only when N ≥ 1). */
export function chatRecapCount(words: readonly AskRecapWord[], stored: WordRecapRun | null | undefined): number {
  return chatRecapPending(words, stored).length;
}

/**
 * The run a chat's recap opens on. A run not yet done carries on (its answers and switches kept, the
 * words collected since appended); after a Done the next run holds only words met since. A chat run
 * is "finished" from the start — a chat has no end to wait for.
 */
export function chatRecapRun(threadId: string, words: readonly AskRecapWord[], stored: WordRecapRun | null | undefined, now: string): WordRecapRun {
  const id = chatRecapRunId(threadId);
  const own = stored && stored.reader_id === id ? stored : null;
  const carry = own && !own.recapped_at ? own : null;
  const old = new Map((carry?.words ?? []).map((w) => [recapKey(w.hanzi), w] as const));
  const list = chatRecapPending(words, own).map((w, i) => {
    const fresh = chatRecapWord(w, i, now);
    const prev = old.get(recapKey(w.hanzi));
    return prev ? { ...fresh, at: prev.at } : fresh;
  });
  const keys = new Set(list.map((w) => recapKey(w.hanzi)));
  return {
    reader_id: id,
    source: 'chat',
    before: [...chatRecappedBefore(own)],
    started_at: carry?.started_at ?? now,
    finished_at: carry?.finished_at ?? now,
    recapped_at: null,
    words: list,
    events: (carry?.events ?? []).filter((e) => keys.has(e.item_id)),
    keep: (carry?.keep ?? []).filter((k) => keys.has(k)),
  };
}
