/**
 * Word checks: likely-wrong pinyin or English on a note, found by a cheap
 * batched Haiku call (worker/src/services/card-check.ts) plus the
 * deterministic 一 / 不 rule (shared/pinyin). Never applied automatically:
 * the note shows "⚠ Possible issue" with Apply fix / Dismiss.
 *
 * Shapes and pure rules shared by the worker, the web app and the Lab app
 * (core/…/CardCheck.kt, parity-tested: android-lab/parity/fixtures/card-check.ts).
 */
import { applyYiBuToneChanges } from '../pinyin/toneChange';

export type CheckField = 'pinyin' | 'english';
/** tone_change = a missing / wrong 一 不 tone change; tones = a wrong tone; reading = the wrong reading of a multi-reading character; gloss = wrong or misleading English. */
export type CheckKind = 'tone_change' | 'tones' | 'reading' | 'gloss';

/** One possible issue stored on a note (`notes.check_issues`, JSON array). */
export interface NoteCheckIssue {
  id: string;
  field: CheckField;
  kind: CheckKind;
  current: string;
  proposed: string;
  reason: string;
}

/** One word to check (a note, or a row of a pasted list before it is saved). */
export interface CheckWord {
  hanzi: string;
  pinyin: string;
  english: string;
}

/** An issue found in a batch, by the word's index in that batch. */
export interface IndexedCheckIssue extends Omit<NoteCheckIssue, 'id'> {
  index: number;
}

/** Words per Haiku call. */
export const CHECK_BATCH_SIZE = 40;
/** The model the checks run on. */
export const CHECK_MODEL = 'claude-haiku-4-5';

/**
 * Cost model of a check, in tokens: the fixed prompt sent with every batch, the
 * tokens one word adds to the input, and the average output per word (only
 * issues come back, ~1 word in 8 has one). Haiku 4.5: $1 / M input, $5 / M output.
 */
export const CHECK_COST = {
  promptTokens: 900,
  inputTokensPerWord: 30,
  outputTokensPerWord: 12,
  outputTokensPerBatch: 20,
  usdPerInputToken: 1 / 1_000_000,
  usdPerOutputToken: 5 / 1_000_000,
} as const;

export interface CheckEstimate {
  words: number;
  batches: number;
  usd: number;
  /** "~319 words · about $0.03" */
  label: string;
}

/** Dollars as the estimate shows them: "less than $0.01", "$0.03", "$1.20". */
export function formatUsd(usd: number): string {
  if (usd < 0.01) return 'less than $0.01';
  return `$${(Math.round(usd * 100) / 100).toFixed(2)}`;
}

export function estimateCheckCost(words: number): CheckEstimate {
  const n = Math.max(0, Math.floor(words));
  const batches = Math.ceil(n / CHECK_BATCH_SIZE);
  const input = batches * CHECK_COST.promptTokens + n * CHECK_COST.inputTokensPerWord;
  const output = batches * CHECK_COST.outputTokensPerBatch + n * CHECK_COST.outputTokensPerWord;
  const usd = input * CHECK_COST.usdPerInputToken + output * CHECK_COST.usdPerOutputToken;
  const label = `~${n} word${n === 1 ? '' : 's'} · about ${formatUsd(usd)}`;
  return { words: n, batches, usd, label };
}

/** Actual cost of a run from the usage the API reported. */
export function checkCostUsd(inputTokens: number, outputTokens: number): number {
  return inputTokens * CHECK_COST.usdPerInputToken + outputTokens * CHECK_COST.usdPerOutputToken;
}

const FIELDS = new Set<CheckField>(['pinyin', 'english']);
const KINDS = new Set<CheckKind>(['tone_change', 'tones', 'reading', 'gloss']);

/** `notes.check_issues` → the list (bad JSON or anything malformed → dropped). */
export function parseCheckIssues(raw: unknown): NoteCheckIssue[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is NoteCheckIssue =>
    !!v && typeof v === 'object' &&
    typeof (v as NoteCheckIssue).id === 'string' &&
    FIELDS.has((v as NoteCheckIssue).field) &&
    KINDS.has((v as NoteCheckIssue).kind) &&
    typeof (v as NoteCheckIssue).current === 'string' &&
    typeof (v as NoteCheckIssue).proposed === 'string' &&
    typeof (v as NoteCheckIssue).reason === 'string'
  );
}

/** Issues still about the note as it is now (a field edited since makes its issue stale). */
export function liveCheckIssues(issues: NoteCheckIssue[], note: CheckWord): NoteCheckIssue[] {
  return issues.filter(i => (i.field === 'pinyin' ? note.pinyin : note.english).trim() === i.current.trim());
}

/** Compare pinyin ignoring spacing, apostrophes and case ("yí gè" = "yígè"). */
export function samePinyin(a: string, b: string): boolean {
  const n = (s: string) => s.normalize('NFC').toLowerCase().replace(/[\s'’·-]+/g, '');
  return n(a) === n(b);
}

/** Han characters of a hanzi string. */
function hanCount(hanzi: string): number {
  return Array.from(hanzi).filter(c => /\p{Script=Han}/u.test(c)).length;
}

/** The deterministic 一 / 不 issue of one word, or null. */
export function toneChangeIssue(word: CheckWord): Omit<NoteCheckIssue, 'id'> | null {
  const fixed = applyYiBuToneChanges(word.hanzi, word.pinyin);
  if (fixed === word.pinyin) return null;
  return {
    field: 'pinyin',
    kind: 'tone_change',
    current: word.pinyin,
    proposed: fixed,
    reason: /一/.test(word.hanzi) && /不/.test(word.hanzi)
      ? '一 and 不 change tone before the next syllable'
      : /一/.test(word.hanzi)
        ? '一 changes tone: yí before a 4th tone, yì before the others, yī alone / as a number'
        : '不 changes tone: bú before a 4th tone, otherwise bù',
  };
}

/**
 * Clean what the model returned for one batch and add the 一 / 不 rule:
 * - drop issues for an index outside the batch, a field that isn't pinyin /
 *   english, an empty proposal or one equal to the current value;
 * - a pinyin proposal gets the 一 / 不 rule applied, and is dropped when its
 *   syllables don't match the hanzi;
 * - at most one issue per word and field (the first);
 * - every word whose pinyin breaks the 一 / 不 rule has a pinyin issue (the
 *   model's, when it made one, else the rule's).
 */
export function mergeCheckIssues(words: CheckWord[], modelIssues: IndexedCheckIssue[]): IndexedCheckIssue[] {
  const out: IndexedCheckIssue[] = [];
  const seen = new Set<string>();
  for (const raw of modelIssues) {
    const word = words[raw.index];
    if (!word || !FIELDS.has(raw.field)) continue;
    const key = `${raw.index}:${raw.field}`;
    if (seen.has(key)) continue;
    const current = raw.field === 'pinyin' ? word.pinyin : word.english;
    let proposed = (raw.proposed ?? '').trim();
    if (!proposed) continue;
    if (raw.field === 'pinyin') {
      proposed = applyYiBuToneChanges(word.hanzi, proposed);
      if (samePinyin(proposed, current)) continue;
      // The proposal must be pinyin for exactly these characters.
      const count = proposedSyllables(proposed);
      if (count !== null && count !== hanCount(word.hanzi) && count !== hanCount(word.hanzi.replace(/儿/g, ''))) continue;
    } else if (proposed.toLowerCase() === current.trim().toLowerCase()) {
      continue;
    }
    seen.add(key);
    const kind: CheckKind = KINDS.has(raw.kind) ? raw.kind : raw.field === 'english' ? 'gloss' : 'tones';
    out.push({
      index: raw.index,
      field: raw.field,
      kind: raw.field === 'english' ? 'gloss' : kind === 'gloss' ? 'tones' : kind,
      current,
      proposed,
      reason: (raw.reason ?? '').trim().slice(0, 300) || 'This looks wrong',
    });
  }
  words.forEach((word, index) => {
    if (seen.has(`${index}:pinyin`)) return;
    const rule = toneChangeIssue(word);
    if (rule) out.push({ index, ...rule });
  });
  return out.sort((a, b) => a.index - b.index || (a.field === b.field ? 0 : a.field === 'pinyin' ? -1 : 1));
}

/** Syllable count of a pinyin string (spaces / joined words), null when it isn't plain pinyin. */
function proposedSyllables(pinyin: string): number | null {
  const words = pinyin.normalize('NFC').toLowerCase().replace(/[^a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ'\s]/g, ' ').trim();
  if (!words) return null;
  let count = 0;
  for (const token of words.split(/\s+/)) {
    const n = countSyllables(token);
    if (n === null) return null;
    count += n;
  }
  return count;
}

const VOWEL_GROUP = /[aeiouüāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+/g;
/** Rough syllable count of one pinyin word: its vowel groups, with "er" endings / erhua r folded in. */
function countSyllables(token: string): number | null {
  const groups = token.replace(/'/g, ' ').match(VOWEL_GROUP);
  if (!groups) return null;
  return groups.length;
}

/** The note after an issue is applied (only the issue's field changes). */
export function applyIssueTo<T extends CheckWord>(note: T, issue: NoteCheckIssue): T {
  return issue.field === 'pinyin' ? { ...note, pinyin: issue.proposed } : { ...note, english: issue.proposed };
}

/** Short label of the kind, for the ⚠ line ("Tones", "一/不 tone change", "Reading", "Meaning"). */
export function checkKindLabel(kind: CheckKind): string {
  switch (kind) {
    case 'tone_change': return '一/不 tone change';
    case 'tones': return 'Tones';
    case 'reading': return 'Reading';
    case 'gloss': return 'Meaning';
  }
}

/** One proposal of a per-deck "Check for errors" run. */
export interface DeckCheckProposal extends NoteCheckIssue {
  note_id: string;
  hanzi: string;
  /** The tutor's matching note in her source deck (same hanzi), when she checks a student's copy. */
  source_note_id?: string | null;
  /** Set once applied (to the note; `source_applied` to the source note too). */
  applied?: boolean;
  source_applied?: boolean;
}

export type DeckCheckStatus = 'queued' | 'running' | 'done' | 'failed';

/** A deck check as the API returns it. */
export interface DeckCheckJob {
  id: string;
  deck_id: string;
  deck_name: string | null;
  relationship_id: string | null;
  source_deck_id: string | null;
  status: DeckCheckStatus;
  total: number;
  checked: number;
  proposals: DeckCheckProposal[];
  /** What the run actually cost, from the API's usage. */
  cost_usd: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

/** "Checked 120 of 319 words" / "3 possible issues in 319 words" / "No issues found in 319 words". */
export function deckCheckSummary(job: Pick<DeckCheckJob, 'status' | 'total' | 'checked' | 'proposals'>): string {
  if (job.status === 'queued') return `Starting… ${job.total} word${job.total === 1 ? '' : 's'} to check`;
  if (job.status === 'running') return `Checked ${job.checked} of ${job.total} words`;
  if (job.status === 'failed') return `Stopped after ${job.checked} of ${job.total} words`;
  const open = job.proposals.filter(p => !p.applied).length;
  const words = `${job.total} word${job.total === 1 ? '' : 's'}`;
  if (job.proposals.length === 0) return `No issues found in ${words}`;
  if (open === 0) return `All ${job.proposals.length} fixes applied`;
  return `${open} possible issue${open === 1 ? '' : 's'} in ${words}`;
}
