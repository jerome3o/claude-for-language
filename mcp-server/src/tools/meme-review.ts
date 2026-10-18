/**
 * 梗 Meme review (PROTOTYPE; worker routes/meme-review.ts, shared/meme-review, docs/MEME_REVIEW.md):
 * ONE issue per month about current Chinese internet memes, written by a research agent with web
 * search and shared by every account. `get_meme_review` reads (read only, sends nothing);
 * `generate_meme_review` is ADMIN only (the API answers 403 otherwise) and costs a few dollars.
 */
import { z } from 'zod';
import type { MemeIssueRecord, MemeIssueSummary, MemeLessonJob } from '../../../shared/meme-review/types';
import type { ToolContext } from './context.js';
import { guard, jsonResult } from './context.js';

const appPath = (month: string) => `/meme-review/${month}`;

/** The issue trimmed for a chat: no picture keys / prompts, the rest as is. */
export function shapeMemeIssue(record: MemeIssueRecord) {
  const base = { month: record.month, status: record.status, app_path: appPath(record.month) };
  if (record.status === 'ready' && record.issue) {
    const issue = record.issue;
    return {
      ...base,
      title: issue.title,
      title_en: issue.title_en,
      covers: issue.covers,
      intro: issue.intro,
      items: issue.items.map(({ picture: _picture, ...item }) => item),
      quiz: issue.quiz,
    };
  }
  if (record.status === 'generating') return { ...base, progress: record.progress, note: 'Still being researched — call get_meme_review again in a few minutes.' };
  if (record.status === 'failed') return { ...base, error: record.error };
  return { ...base, note: 'No issue for this month yet (the app makes one on the 1st; an admin can generate one).' };
}

export function registerMemeReviewTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'get_meme_review',
    'Read the app\'s 梗 Meme review (prototype): a monthly issue explaining 6–10 current Chinese internet memes / buzzwords — for each: hanzi, pinyin, gist, meaning in simple Chinese + English, origin (with confidence), 2–3 chat-style example lines, register (who says it, crude or not), whether a ~30-year-old foreigner should say it, older memes it riffs on, and the real source / original video links the research found — plus a short quiz. Without `month`: the newest ready issue and the list of months. Point a learner at it with app_path. Read only: sends nothing.',
    { month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe('YYYY-MM; default the newest ready issue.') },
    async ({ month }) =>
      guard(async () => {
        const list = await api.get<{ issues: MemeIssueSummary[]; current_month: string }>('/api/meme-review');
        const months = list.issues.map((i) => ({ month: i.month, status: i.status, title: i.title, items: i.item_count, app_path: appPath(i.month) }));
        const pick = month ?? list.issues.find((i) => i.status === 'ready')?.month;
        if (!pick) return jsonResult({ issue: null, months, note: 'No ready issue yet.' });
        const { issue } = await api.get<{ issue: MemeIssueRecord; lesson: MemeLessonJob | null }>(`/api/meme-review/${pick}`);
        return jsonResult({ issue: shapeMemeIssue(issue), months });
      }),
  );

  server.tool(
    'generate_meme_review',
    'ADMIN ONLY: start the research agent for a month\'s 梗 Meme review (default the current month). It runs in the background (~5–15 minutes; poll with get_meme_review) and costs roughly $1–3 (Claude + ~25 web searches + pictures). A month that already has a ready issue is kept unless regenerate is true. Only when the user explicitly asked for it.',
    {
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe('YYYY-MM; default the current month. Never a future month.'),
      regenerate: z.boolean().optional().describe('true = write a ready month again from scratch (costs again).'),
    },
    async ({ month, regenerate }) =>
      guard(async () => {
        const res = await api.post<{ issue: MemeIssueRecord; started: boolean }>('/api/meme-review/generate', { ...(month ? { month } : {}), ...(regenerate ? { regenerate: true } : {}), via: 'mcp' });
        return jsonResult({ started: res.started, issue: shapeMemeIssue(res.issue) });
      }),
  );
}
