/**
 * 成语 Idioms (beta; worker routes/idioms.ts, shared/idioms, docs/IDIOMS.md): one entry per
 * idiom — meaning, the 典故 told in simple Chinese, usage, examples, a short quiz — generated
 * once and shared by every account. Read / generate only: nothing here sends anything to a
 * student; a tutor can point a student at an idiom by its app_path (/idioms/<hanzi>).
 */
import { z } from 'zod';
import type { IdiomRecord, IdiomSummary } from '../../../shared/idioms/types';
import type { ToolContext } from './context.js';
import { guard, jsonResult } from './context.js';

export const IDIOM_WAIT_MS = 90_000;

const appPath = (hanzi: string) => `/idioms/${encodeURIComponent(hanzi)}`;

export function shapeIdiom(record: IdiomRecord) {
  const base = { hanzi: record.hanzi, status: record.status, app_path: appPath(record.hanzi) };
  if (record.status === 'ready' && record.entry) {
    return { ...base, entry: record.entry, ...(record.entry.confidence !== 'high' ? { caution: `Confidence ${record.entry.confidence}: ${record.entry.confidence_note ?? 'check the origin before teaching it as fact.'}` } : {}) };
  }
  if (record.status === 'not_idiom') return { ...base, reason: record.error, did_you_mean: record.suggestion };
  if (record.status === 'failed') return { ...base, error: record.error, note: 'Call get_idiom again with retry: true to try again.' };
  return { ...base, note: 'Still being written — call get_idiom again in a minute.' };
}

export function registerIdiomTools(ctx: ToolContext, opts: { waitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {}): void {
  const { server, api } = ctx;
  const waitMs = opts.waitMs ?? IDIOM_WAIT_MS;
  const pollMs = opts.pollMs ?? 3000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  server.tool(
    'get_idiom',
    'Get the app\'s 成语 (Chinese idiom) entry: pinyin, the literal meaning character by character, the figurative meaning, the origin story (典故) retold in simple Chinese with pinyin + English and its source when known, usage (grammatical role, register, 褒义 / 贬义), collocations, example sentences easiest → hardest, the common mistake, 近义 / 反义 idioms and a short quiz. Entries are shared by every account; a missing one is generated now (up to ~1–2 minutes — this call waits). `caution` appears when the generator was not fully sure of the facts. Point a learner at it in the app with app_path. Read / generate only: this sends nothing to anyone.',
    {
      hanzi: z.string().min(1).max(40).describe('The idiom in Chinese characters, e.g. 画蛇添足.'),
      retry: z.boolean().optional().describe('true = regenerate after a failure or a "not an idiom" answer.'),
    },
    async ({ hanzi, retry }) =>
      guard(async () => {
        let { idiom } = await api.post<{ idiom: IdiomRecord }>('/api/idioms', { hanzi, ...(retry ? { retry: true } : {}) });
        const deadline = Date.now() + waitMs;
        while (idiom.status === 'generating' && Date.now() < deadline) {
          await sleep(pollMs);
          ({ idiom } = await api.get<{ idiom: IdiomRecord }>(`/api/idioms/${encodeURIComponent(idiom.hanzi)}`));
        }
        return jsonResult({ idiom: shapeIdiom(idiom) });
      }),
  );

  server.tool(
    'list_idioms',
    'The app\'s 成语 Idioms list: the curated starter idioms (with whether each entry has been written yet: ready / missing / generating / failed) and every other idiom someone has looked up, most opened first. Each row has hanzi, pinyin, a short English meaning and app_path. Use get_idiom for the full entry.',
    { limit: z.number().int().min(1).max(300).optional().describe('How many looked-up (non-starter) idioms to include (default 80).') },
    async ({ limit }) =>
      guard(async () => {
        const res = await api.get<{ starter: IdiomSummary[]; more: IdiomSummary[] }>(`/api/idioms${limit ? `?limit=${limit}` : ''}`);
        const row = (s: IdiomSummary) => ({ hanzi: s.hanzi, pinyin: s.pinyin, english: s.english, status: s.status, app_path: appPath(s.hanzi) });
        return jsonResult({ starter: res.starter.map(row), more: res.more.map(row) });
      }),
  );
}
