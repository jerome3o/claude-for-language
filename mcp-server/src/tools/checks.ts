/**
 * Word checks from the MCP server (worker routes/card-checks.ts): the create
 * tools surface the check's warnings, `check_deck_for_errors` runs a deck
 * check and returns its proposals, `apply_note_fixes` applies ONLY the ones the
 * user approved. Nothing is ever fixed automatically.
 */
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { errorResult, guard, jsonResult } from './context.js';
import { estimateCheckCost, type DeckCheckJob } from '../../../shared/cards/check';

/** One warning the API returns with a created note (`?check=sync`). */
export interface CheckWarning {
  note_id: string;
  hanzi: string;
  issue_id: string;
  field: 'pinyin' | 'english';
  kind: string;
  current: string;
  proposed: string;
  reason: string;
}

/** The sentence a create tool appends when the check found something (empty when not). */
export function checkWarningsMessage(warnings: CheckWarning[]): string {
  if (!warnings.length) return '';
  const lines = warnings.map(w => `${w.hanzi} — ${w.field}: "${w.current}" → "${w.proposed}" (${w.reason})`);
  return ` ⚠ The word check found ${warnings.length} possible issue(s): ${lines.join('; ')}. Nothing was changed — tell the user and, only if they agree, call apply_note_fixes with these note_id + issue_id pairs.`;
}

/** Proposals trimmed for a chat. */
export function proposalsForModel(job: DeckCheckJob) {
  return job.proposals.map(p => ({
    proposal_id: p.id,
    note_id: p.note_id,
    hanzi: p.hanzi,
    field: p.field,
    kind: p.kind,
    current: p.current,
    proposed: p.proposed,
    reason: p.reason,
    ...(p.applied ? { applied: true } : {}),
    ...(p.source_note_id ? { also_in_your_source_deck: true } : {}),
  }));
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function registerCheckTools(ctx: ToolContext, options: { pollMs?: number; maxWaitMs?: number } = {}): void {
  const { server, api } = ctx;
  const pollMs = options.pollMs ?? 2000;
  const maxWaitMs = options.maxWaitMs ?? 100_000;

  server.tool(
    'check_deck_for_errors',
    `Check every word of one deck for likely mistakes — wrong tones, a missing 一/不 tone change, the wrong reading of a multi-reading character, a wrong or misleading English gloss (Haiku in batches; ${estimateCheckCost(100).label.replace('~100 words', '100 words')}). Returns proposals (current → proposed + reason). NOTHING is changed: show them to the user and apply only the ones they approve with apply_note_fixes(job_id, proposal_ids). For a homework deck you sent a student, pass relationship_id + shared_deck_id (checks the student's copy; the proposals say when your own source deck has the same word). Pass job_id to read an earlier check again.`,
    {
      deck_id: z.string().optional().describe('One of YOUR decks'),
      relationship_id: z.string().optional().describe("With shared_deck_id: the student whose copy to check (tutor only)"),
      shared_deck_id: z.string().optional().describe('The shared_deck_id (or the student copy\'s deck id) from list_student_homework'),
      job_id: z.string().optional().describe('An earlier check to read (no new run)'),
    },
    async ({ deck_id, relationship_id, shared_deck_id, job_id }) => guard(async () => {
      let job: DeckCheckJob;
      if (job_id) {
        job = (await api.get<{ job: DeckCheckJob }>(`/api/deck-checks/${encodeURIComponent(job_id)}`)).job;
      } else {
        const path = deck_id
          ? `/api/decks/${encodeURIComponent(deck_id)}/check`
          : relationship_id && shared_deck_id
            ? `/api/relationships/${encodeURIComponent(relationship_id)}/shared-decks/${encodeURIComponent(shared_deck_id)}/check`
            : null;
        if (!path) return errorResult('Pass deck_id (your deck), or relationship_id + shared_deck_id (a student\'s copy), or job_id.');
        job = (await api.post<{ job: DeckCheckJob }>(path, {})).job;
      }
      const started = Date.now();
      while ((job.status === 'queued' || job.status === 'running') && Date.now() - started < maxWaitMs) {
        await sleep(pollMs);
        job = (await api.get<{ job: DeckCheckJob }>(`/api/deck-checks/${encodeURIComponent(job.id)}`)).job;
      }
      const proposals = proposalsForModel(job);
      const open = proposals.filter(p => !p.applied);
      return jsonResult({
        job_id: job.id,
        deck: job.deck_name,
        status: job.status,
        checked: job.checked,
        total: job.total,
        cost_usd: Math.round(job.cost_usd * 10000) / 10000,
        proposals,
        message:
          job.status === 'done'
            ? open.length
              ? `${open.length} possible issue(s) in ${job.total} words. Nothing was changed — show these to the user and apply only what they approve: apply_note_fixes(job_id="${job.id}", proposal_ids=[…]).`
              : `No issues found in ${job.total} words.`
            : job.status === 'failed'
              ? `The check stopped after ${job.checked} of ${job.total} words: ${job.error ?? 'unknown error'}.`
              : `Still checking (${job.checked} of ${job.total}). Call check_deck_for_errors(job_id="${job.id}") again in a moment.`,
      });
    }),
  );

  server.tool(
    'apply_note_fixes',
    'Apply word-check fixes the USER APPROVED — never on your own judgement. Either the proposals of a deck check (job_id + proposal_ids, from check_deck_for_errors; also_source: true also fixes the same word in your own source deck when checking a student\'s copy) or the warnings a create tool returned (fixes: [{ note_id, issue_id }]). Each fix goes through the normal note update (audio etc. as usual); a word edited since the check is skipped and reported.',
    {
      job_id: z.string().optional().describe('A deck check (check_deck_for_errors)'),
      proposal_ids: z.array(z.string()).optional().describe('The approved proposal_ids of that check'),
      also_source: z.boolean().optional().describe("Checking a student's copy: also fix your own source deck (default false)"),
      fixes: z.array(z.object({ note_id: z.string(), issue_id: z.string() })).optional().describe('Approved warnings from add_note / batch_add_notes / create_homework_deck'),
    },
    async ({ job_id, proposal_ids, also_source, fixes }) => guard(async () => {
      if (job_id) {
        if (!proposal_ids?.length) return errorResult('Pass the proposal_ids the user approved.');
        const res = await api.post<{ applied: string[]; source_applied: string[]; failed: Array<{ id: string; error: string }> }>(
          `/api/deck-checks/${encodeURIComponent(job_id)}/apply`,
          { proposal_ids, also_source: also_source === true },
        );
        return jsonResult({
          applied: res.applied.length,
          source_applied: res.source_applied.length,
          failed: res.failed,
          message: `Applied ${res.applied.length} fix(es)${res.source_applied.length ? `, ${res.source_applied.length} also in your source deck` : ''}${res.failed.length ? `; ${res.failed.length} skipped` : ''}.`,
        });
      }
      if (!fixes?.length) return errorResult('Pass job_id + proposal_ids, or fixes: [{ note_id, issue_id }].');
      const applied: string[] = [];
      const failed: Array<{ note_id: string; error: string }> = [];
      for (const f of fixes) {
        try {
          await api.post(`/api/notes/${encodeURIComponent(f.note_id)}/check-issues/${encodeURIComponent(f.issue_id)}/apply`, {});
          applied.push(f.note_id);
        } catch (err) {
          failed.push({ note_id: f.note_id, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return jsonResult({ applied: applied.length, failed, message: `Applied ${applied.length} fix(es)${failed.length ? `; ${failed.length} failed` : ''}.` });
    }),
  );
}
