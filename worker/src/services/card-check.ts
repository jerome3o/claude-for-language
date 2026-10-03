/**
 * Word checks (shared/cards/check.ts): likely-wrong pinyin (wrong tones, a
 * missing 一 / 不 tone change, the wrong reading of a multi-reading character)
 * or a wrong / misleading English gloss — a cheap batched Haiku call through
 * structuredCall, plus the deterministic 一 / 不 rule (shared/pinyin).
 *
 * NOTHING here changes a note's text on its own. Results are stored as
 * `notes.check_issues` (the note shows "⚠ Possible issue" with Apply fix /
 * Dismiss) or as the proposals of a deck check (`deck_check_jobs`), and only an
 * explicit apply writes through the content service's updateNote.
 *
 * Runs:
 * - new / edited words, when the account's "Check new words" is on (default on
 *   for tutors): content service → queueNoteCheck → card-check-queue → runNotesCheck;
 * - Paste a list's preview and the MCP pre-check: checkWords, synchronous;
 * - a whole deck ("Check for errors"): startDeckCheck → card-check-queue →
 *   runDeckCheckJob, progress per batch.
 * Without ANTHROPIC_API_KEY only the 一 / 不 rule runs.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../types';
import { structuredCall } from './structured-call';
import {
  CHECK_BATCH_SIZE,
  CHECK_MODEL,
  checkCostUsd,
  liveCheckIssues,
  mergeCheckIssues,
  parseCheckIssues,
  type CheckWord,
  type DeckCheckJob,
  type DeckCheckProposal,
  type IndexedCheckIssue,
  type NoteCheckIssue,
} from '@shared/cards/check';
import { YI_BU_CONVENTION } from '@shared/pinyin/toneChange';
import { normalizeHanzi } from '@shared/import/parse';
import { fakeCheckClient } from './card-check-fake';

export interface CardCheckMessage {
  kind: 'notes' | 'deck';
  userId?: string;
  noteIds?: string[];
  jobId?: string;
}

export interface CheckDeps {
  /** Test seam: the Anthropic client. */
  client?: Pick<Anthropic, 'messages'>;
  sleep?: (ms: number) => Promise<void>;
}

export interface CheckUsage {
  input_tokens: number;
  output_tokens: number;
}

export const CHECK_SYSTEM = `You proofread Chinese flashcards for a learner. Each card has hanzi, pinyin and an English gloss. Report ONLY real mistakes a teacher would correct:
- pinyin with a wrong tone or syllable;
- the wrong reading of a character with several readings, for THIS word (银行 yínháng not yínxíng, 长大 zhǎngdà, 觉得 juéde, 音乐 yīnyuè);
- a missing or wrong 一 / 不 tone change (the convention below);
- an English gloss that is wrong, or so loose it would teach the wrong meaning.

The pinyin convention of these cards: ${YI_BU_CONVENTION} Tone marks, never numbers. Neutral tones that dictionaries write (duìbuqǐ, xièxie, juéde, kàn yi kàn) are correct.

Do NOT report: spacing between syllables or words, capital letters, punctuation, erhua spelled with or without r, a correct gloss you would merely word differently, missing "to" before a verb, a gloss that gives one of several correct senses, or a missing explanation.
Most cards are fine — report nothing for them. When unsure, report nothing.

For each mistake give: index (the card's number), field (pinyin | english), kind (tone_change | tones | reading | gloss), proposed (the WHOLE corrected field: full pinyin for the whole hanzi with tone marks in the card's own spacing style, or a short English gloss) and reason (one short sentence a learner understands, e.g. "行 reads háng in 银行 (bank)").`;

const REPORT_TOOL = {
  name: 'report_issues',
  description: 'Report the mistakes found in this batch of cards (an empty list when every card is fine).',
  input_schema: {
    type: 'object' as const,
    properties: {
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            field: { type: 'string', enum: ['pinyin', 'english'] },
            kind: { type: 'string', enum: ['tone_change', 'tones', 'reading', 'gloss'] },
            proposed: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['index', 'field', 'kind', 'proposed', 'reason'],
        },
      },
    },
    required: ['issues'],
  },
};

function validateReport(input: unknown): IndexedCheckIssue[] {
  const issues = (input as { issues?: unknown })?.issues;
  if (!Array.isArray(issues)) throw new Error('report_issues: issues must be an array');
  return issues
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
    .map(i => ({
      index: Number(i.index),
      field: i.field as IndexedCheckIssue['field'],
      kind: i.kind as IndexedCheckIssue['kind'],
      current: '',
      proposed: String(i.proposed ?? ''),
      reason: String(i.reason ?? ''),
    }))
    .filter(i => Number.isInteger(i.index));
}

/** The user turn for one batch: one numbered line per card. */
export function batchPrompt(words: CheckWord[]): string {
  const lines = words.map((w, i) => `${i}. ${w.hanzi.trim()} | ${w.pinyin.trim()} | ${w.english.trim()}`);
  return `Cards (number. hanzi | pinyin | english):\n${lines.join('\n')}`;
}

/** The client to use: the test seam, the E2E fake (no key in E2E mode), else undefined = structuredCall's real one. */
function modelClient(env: Env, deps: CheckDeps): Pick<Anthropic, 'messages'> | undefined {
  if (deps.client) return deps.client;
  if (!env.ANTHROPIC_API_KEY && env.E2E_TEST_MODE === 'true') return fakeCheckClient();
  return undefined;
}

/** Can the model part of the check run here? (Otherwise only the 一 / 不 rule runs.) */
export function modelAvailable(env: Env, deps: CheckDeps = {}): boolean {
  return !!deps.client || !!env.ANTHROPIC_API_KEY || env.E2E_TEST_MODE === 'true';
}

/**
 * Check words in batches of CHECK_BATCH_SIZE. Returns issues by index into
 * `words` (current = the word's value). A batch whose model call fails still
 * gets the 一 / 不 rule. Never writes anything.
 */
export async function checkWords(env: Env, words: CheckWord[], deps: CheckDeps = {}, usage?: CheckUsage): Promise<IndexedCheckIssue[]> {
  const out: IndexedCheckIssue[] = [];
  for (let start = 0; start < words.length; start += CHECK_BATCH_SIZE) {
    const batch = words.slice(start, start + CHECK_BATCH_SIZE);
    const found = await checkBatch(env, batch, deps, usage);
    for (const issue of found) out.push({ ...issue, index: issue.index + start });
  }
  return out;
}

async function checkBatch(env: Env, batch: CheckWord[], deps: CheckDeps, usage?: CheckUsage): Promise<IndexedCheckIssue[]> {
  let model: IndexedCheckIssue[] = [];
  if (modelAvailable(env, deps)) {
    try {
      model = await structuredCall({
        apiKey: env.ANTHROPIC_API_KEY ?? 'test',
        model: CHECK_MODEL,
        fallbackModel: null,
        attempts: 2,
        system: CHECK_SYSTEM,
        user: batchPrompt(batch),
        tool: REPORT_TOOL,
        maxTokens: 2000,
        validate: validateReport,
        client: modelClient(env, deps),
        sleep: deps.sleep,
        timeoutMs: 40_000,
        onUsage: u => {
          if (usage) {
            usage.input_tokens += u.input_tokens;
            usage.output_tokens += u.output_tokens;
          }
        },
      });
    } catch (err) {
      console.warn('[card-check] model check failed, using the 一/不 rule only:', err instanceof Error ? err.message : err);
    }
  }
  return mergeCheckIssues(batch, model);
}

// ============ The account switch ============

/** "Check new words for mistakes": the stored choice, or the default (on for tutors). */
export async function cardCheckEnabled(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT u.card_check, u.role,
              EXISTS (SELECT 1 FROM tutor_relationships r
                       WHERE r.status = 'active'
                         AND ((r.requester_id = u.id AND r.requester_role = 'tutor')
                           OR (r.recipient_id = u.id AND r.requester_role = 'student'))) AS teaches
       FROM users u WHERE u.id = ?`
    )
    .bind(userId)
    .first<{ card_check: number | null; role: string | null; teaches: number }>();
  if (!row) return false;
  if (row.card_check !== null && row.card_check !== undefined) return row.card_check !== 0;
  return row.role === 'tutor' || !!row.teaches;
}

export async function setCardCheck(db: D1Database, userId: string, value: boolean | null): Promise<void> {
  await db.prepare('UPDATE users SET card_check = ? WHERE id = ?').bind(value === null ? null : value ? 1 : 0, userId).run();
}

// ============ Checks on notes (stored as notes.check_issues) ============

interface NoteRow extends CheckWord {
  id: string;
  check_issues: string | null;
}

async function loadOwnedNotes(db: D1Database, userId: string, noteIds: string[]): Promise<NoteRow[]> {
  const out: NoteRow[] = [];
  for (let i = 0; i < noteIds.length; i += 80) {
    const ids = noteIds.slice(i, i + 80);
    const res = await db
      .prepare(
        `SELECT n.id, n.hanzi, n.pinyin, n.english, n.check_issues FROM notes n JOIN decks d ON d.id = n.deck_id
          WHERE d.user_id = ? AND n.id IN (${ids.map(() => '?').join(',')})`
      )
      .bind(userId, ...ids)
      .all<NoteRow>();
    out.push(...(res.results ?? []));
  }
  return out;
}

async function writeIssues(db: D1Database, noteId: string, issues: NoteCheckIssue[]): Promise<void> {
  await db
    .prepare(`UPDATE notes SET check_issues = ?, check_at = datetime('now') WHERE id = ?`)
    .bind(issues.length ? JSON.stringify(issues) : null, noteId)
    .run();
}

/**
 * Check notes the user owns and store what was found on each (replacing the
 * note's earlier open issues). Returns the issues per note id.
 */
export async function runNotesCheck(env: Env, userId: string, noteIds: string[], deps: CheckDeps = {}): Promise<Map<string, NoteCheckIssue[]>> {
  const notes = await loadOwnedNotes(env.DB, userId, [...new Set(noteIds)]);
  const result = new Map<string, NoteCheckIssue[]>();
  if (!notes.length) return result;
  const found = await checkWords(env, notes, deps);
  const byNote = new Map<number, NoteCheckIssue[]>();
  for (const f of found) {
    const { index, ...rest } = f;
    const list = byNote.get(index) ?? [];
    list.push({ id: crypto.randomUUID(), ...rest });
    byNote.set(index, list);
  }
  for (let i = 0; i < notes.length; i++) {
    const issues = byNote.get(i) ?? [];
    const before = parseCheckIssues(notes[i].check_issues);
    result.set(notes[i].id, issues);
    if (issues.length === 0 && before.length === 0) continue; // nothing to sync
    await writeIssues(env.DB, notes[i].id, issues);
  }
  return result;
}

/**
 * Queue a check of new / edited notes when the user's switch is on. Never
 * throws: a check is a nicety, never a reason for a save to fail.
 */
export async function queueNoteCheck(env: Env, userId: string, noteIds: string[], bg?: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
  if (!noteIds.length) return;
  try {
    if (!(await cardCheckEnabled(env.DB, userId))) return;
    if (env.CARD_CHECK_QUEUE) {
      for (let i = 0; i < noteIds.length; i += 200) {
        await env.CARD_CHECK_QUEUE.send({ kind: 'notes', userId, noteIds: noteIds.slice(i, i + 200) });
      }
      return;
    }
    const run = runNotesCheck(env, userId, noteIds).then(() => undefined);
    if (bg) bg.waitUntil(run.catch(err => console.error('[card-check] check failed', err)));
    else await run;
  } catch (err) {
    console.error('[card-check] could not queue a check', err);
  }
}

/** A note's issues after an edit: the ones about fields that changed are stale. */
export async function dropStaleIssues(db: D1Database, note: CheckWord & { id: string; check_issues?: string | null }): Promise<void> {
  const before = parseCheckIssues(note.check_issues ?? null);
  if (!before.length) return;
  const live = liveCheckIssues(before, note);
  if (live.length !== before.length) await writeIssues(db, note.id, live);
}

export class CheckError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

/** Take one issue off a note the user owns (Dismiss, or after Apply). Returns the remaining issues. */
export async function removeNoteIssue(db: D1Database, userId: string, noteId: string, issueId: string): Promise<{ issue: NoteCheckIssue; remaining: NoteCheckIssue[] }> {
  const [note] = await loadOwnedNotes(db, userId, [noteId]);
  if (!note) throw new CheckError('Note not found', 404);
  const issues = parseCheckIssues(note.check_issues);
  const issue = issues.find(i => i.id === issueId);
  if (!issue) throw new CheckError('This issue was already handled', 404);
  const remaining = issues.filter(i => i.id !== issueId);
  await writeIssues(db, noteId, remaining);
  return { issue, remaining };
}

// ============ Deck checks ============

interface JobRow {
  id: string;
  user_id: string;
  deck_id: string;
  deck_owner_id: string;
  relationship_id: string | null;
  source_deck_id: string | null;
  status: DeckCheckJob['status'];
  total: number;
  checked: number;
  proposals: string | null;
  input_tokens: number;
  output_tokens: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  deck_name?: string | null;
}

export function jobToApi(row: JobRow): DeckCheckJob {
  let proposals: DeckCheckProposal[] = [];
  try {
    proposals = row.proposals ? JSON.parse(row.proposals) : [];
  } catch {
    proposals = [];
  }
  return {
    id: row.id,
    deck_id: row.deck_id,
    deck_name: row.deck_name ?? null,
    relationship_id: row.relationship_id,
    source_deck_id: row.source_deck_id,
    status: row.status,
    total: row.total,
    checked: row.checked,
    proposals,
    cost_usd: checkCostUsd(row.input_tokens, row.output_tokens),
    error: row.error,
    created_at: row.created_at,
    finished_at: row.finished_at,
  };
}

const JOB_SELECT = `SELECT j.*, d.name AS deck_name FROM deck_check_jobs j LEFT JOIN decks d ON d.id = j.deck_id`;

export async function getDeckCheckJob(db: D1Database, jobId: string): Promise<JobRow | null> {
  return db.prepare(`${JOB_SELECT} WHERE j.id = ?`).bind(jobId).first<JobRow>();
}

/** The newest check of a deck started by this user (to reopen it). */
export async function latestDeckCheck(db: D1Database, userId: string, deckId: string): Promise<JobRow | null> {
  return db.prepare(`${JOB_SELECT} WHERE j.user_id = ? AND j.deck_id = ? ORDER BY j.created_at DESC LIMIT 1`).bind(userId, deckId).first<JobRow>();
}

export async function countDeckWords(db: D1Database, deckId: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM notes WHERE deck_id = ?').bind(deckId).first<{ n: number }>();
  return row?.n ?? 0;
}

export interface StartDeckCheck {
  userId: string;
  deckId: string;
  deckOwnerId: string;
  relationshipId?: string | null;
  sourceDeckId?: string | null;
}

/** Start a deck check (or return the one still running for this deck). */
export async function startDeckCheck(env: Env, input: StartDeckCheck, bg?: { waitUntil(p: Promise<unknown>): void }): Promise<JobRow> {
  const running = await env.DB
    .prepare(`${JOB_SELECT} WHERE j.user_id = ? AND j.deck_id = ? AND j.status IN ('queued', 'running') AND j.updated_at > datetime('now', '-15 minutes') ORDER BY j.created_at DESC LIMIT 1`)
    .bind(input.userId, input.deckId)
    .first<JobRow>();
  if (running) return running;
  const total = await countDeckWords(env.DB, input.deckId);
  if (total === 0) throw new CheckError('This deck has no words to check', 400);
  const id = crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO deck_check_jobs (id, user_id, deck_id, deck_owner_id, relationship_id, source_deck_id, status, total, proposals)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, '[]')`
    )
    .bind(id, input.userId, input.deckId, input.deckOwnerId, input.relationshipId ?? null, input.sourceDeckId ?? null, total)
    .run();
  if (env.CARD_CHECK_QUEUE) {
    await env.CARD_CHECK_QUEUE.send({ kind: 'deck', jobId: id });
  } else {
    const run = runDeckCheckJob(env, id).catch(err => console.error('[card-check] deck job failed', id, err));
    if (bg) bg.waitUntil(run);
    else await run;
  }
  return (await getDeckCheckJob(env.DB, id))!;
}

/**
 * Run (or resume) a deck check: notes in a fixed order, from `checked` on, one
 * batch at a time, the proposals and progress saved after every batch.
 */
export async function runDeckCheckJob(env: Env, jobId: string, deps: CheckDeps = {}): Promise<'done' | 'failed' | 'missing'> {
  const job = await getDeckCheckJob(env.DB, jobId);
  if (!job) return 'missing';
  if (job.status === 'done' || job.status === 'failed') return job.status;
  await env.DB.prepare(`UPDATE deck_check_jobs SET status = 'running', updated_at = datetime('now') WHERE id = ?`).bind(jobId).run();
  try {
    const notes = (
      await env.DB
        .prepare('SELECT id, hanzi, pinyin, english FROM notes WHERE deck_id = ? ORDER BY created_at, id')
        .bind(job.deck_id)
        .all<{ id: string; hanzi: string; pinyin: string; english: string }>()
    ).results ?? [];
    const sourceByHanzi = new Map<string, string>();
    if (job.source_deck_id) {
      const src = (await env.DB.prepare('SELECT id, hanzi FROM notes WHERE deck_id = ?').bind(job.source_deck_id).all<{ id: string; hanzi: string }>()).results ?? [];
      for (const s of src) sourceByHanzi.set(normalizeHanzi(s.hanzi), s.id);
    }
    const proposals: DeckCheckProposal[] = jobToApi(job).proposals;
    const usage: CheckUsage = { input_tokens: job.input_tokens, output_tokens: job.output_tokens };
    let checked = Math.min(job.checked, notes.length);
    while (checked < notes.length) {
      const batch = notes.slice(checked, checked + CHECK_BATCH_SIZE);
      const found = await checkBatch(env, batch, deps, usage);
      for (const f of found) {
        const note = batch[f.index];
        const { index: _i, ...issue } = f;
        proposals.push({
          id: crypto.randomUUID(),
          ...issue,
          note_id: note.id,
          hanzi: note.hanzi,
          source_note_id: job.source_deck_id ? sourceByHanzi.get(normalizeHanzi(note.hanzi)) ?? null : null,
        });
      }
      checked += batch.length;
      await env.DB
        .prepare(
          `UPDATE deck_check_jobs SET checked = ?, total = ?, proposals = ?, input_tokens = ?, output_tokens = ?, updated_at = datetime('now') WHERE id = ?`
        )
        .bind(checked, notes.length, JSON.stringify(proposals), usage.input_tokens, usage.output_tokens, jobId)
        .run();
    }
    await env.DB
      .prepare(`UPDATE deck_check_jobs SET status = 'done', total = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .bind(notes.length, jobId)
      .run();
    return 'done';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await env.DB
      .prepare(`UPDATE deck_check_jobs SET status = 'failed', error = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .bind(message.slice(0, 500), jobId)
      .run();
    return 'failed';
  }
}

export interface ApplyResult {
  applied: string[];
  source_applied: string[];
  failed: Array<{ id: string; error: string }>;
  job: DeckCheckJob;
}

/**
 * Apply the selected proposals of a finished deck check through `update`
 * (the content service's updateNote, as the deck's owner). A proposal whose
 * note changed since the check is skipped (its `current` no longer matches).
 * `alsoSource` writes the same fix onto the tutor's matching source note.
 */
export async function applyDeckCheck(
  env: Env,
  job: JobRow,
  proposalIds: string[],
  alsoSource: boolean,
  update: (ownerId: string, noteId: string, patch: { pinyin?: string; english?: string }) => Promise<unknown>
): Promise<ApplyResult> {
  const api = jobToApi(job);
  const wanted = new Set(proposalIds);
  const result: Omit<ApplyResult, 'job'> = { applied: [], source_applied: [], failed: [] };
  for (const p of api.proposals) {
    if (!wanted.has(p.id) || p.applied) continue;
    try {
      const note = await env.DB
        .prepare('SELECT pinyin, english FROM notes WHERE id = ? AND deck_id = ?')
        .bind(p.note_id, job.deck_id)
        .first<{ pinyin: string; english: string }>();
      if (!note) throw new Error('The word is no longer in the deck');
      const now = p.field === 'pinyin' ? note.pinyin : note.english;
      if (now.trim() !== p.current.trim()) throw new Error('The word was edited since the check');
      await update(job.deck_owner_id, p.note_id, { [p.field]: p.proposed });
      p.applied = true;
      result.applied.push(p.id);
      if (alsoSource && p.source_note_id && job.source_deck_id) {
        try {
          const src = await env.DB
            .prepare('SELECT pinyin, english FROM notes WHERE id = ? AND deck_id = ?')
            .bind(p.source_note_id, job.source_deck_id)
            .first<{ pinyin: string; english: string }>();
          if (src && (p.field === 'pinyin' ? src.pinyin : src.english).trim() === p.current.trim()) {
            await update(job.user_id, p.source_note_id, { [p.field]: p.proposed });
            p.source_applied = true;
            result.source_applied.push(p.id);
          }
        } catch (err) {
          console.warn('[card-check] source fix failed', p.source_note_id, err);
        }
      }
    } catch (err) {
      result.failed.push({ id: p.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  await env.DB
    .prepare(`UPDATE deck_check_jobs SET proposals = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(JSON.stringify(api.proposals), job.id)
    .run();
  return { ...result, job: { ...api } };
}
