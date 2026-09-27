/**
 * Study-state debug reports (shared/debug): the web app and the native Lab app
 * each upload what they think is due and why (after a sync, every 30 min at
 * most, or from their "Send debug report" buttons); these tools read them and
 * the server-side diff so a chat can work out why the two apps show different
 * numbers. Endpoints: worker/src/routes/debug-reports.ts. Reports belong to the
 * signed-in user; a report can hold ~9k card rows, so nothing here returns the
 * whole thing — sections and pages only.
 */
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { errorResult, guard, jsonResult } from './context.js';

const CLIENT = z.enum(['lab', 'web']);

interface ReportRow {
  id: string;
  client: 'lab' | 'web';
  app_version: string | null;
  created_at: string;
  size_bytes: number;
  summary: unknown;
}

/** `latest_lab` / `latest_web` → the newest report id of that client. */
export async function resolveReportId(api: ToolContext['api'], id: string): Promise<string | null> {
  const m = /^latest[_-](lab|web)$/i.exec(id.trim());
  if (!m) return id.trim();
  const { reports } = await api.get<{ reports: ReportRow[] }>('/api/debug/reports', { client: m[1].toLowerCase(), limit: 1 });
  return reports[0]?.id ?? null;
}

export function registerDebugTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'list_debug_reports',
    'Study-state debug reports the user\'s apps uploaded (newest first): the Lab app (native Android, client "lab") and the web app / PWA (client "web"). Each row has the id, client, app version, when, size and a summary (what the home screen showed: total + new / secondaryNew / learning / review, study-queue size, decks, cards, events, unsynced events, latest review). Use it to find ids for get_debug_report / compare_debug_reports. Reports arrive after a sync (every 30 min at most) or from "Send debug report" (web: Settings → Advanced; Lab: home ⚙ settings sheet).',
    {
      client: CLIENT.optional().describe('Only this app\'s reports.'),
      limit: z.number().int().min(1).max(100).optional().describe('Default 20.'),
    },
    async ({ client, limit }) =>
      guard(async () => {
        const query: Record<string, string> = { limit: String(limit ?? 20) };
        if (client) query.client = client;
        return jsonResult(await api.get('/api/debug/reports', query));
      })
  );

  server.tool(
    'get_debug_report',
    'Read one debug report, a section at a time (never the whole file). `overview` (default): timezone, now, the "due today" cutoff, local day start, daily budget, "Study 10 more" bonus, sync cursors, totals, exactly what the home screen showed, the study queue a session would get, homework (web), and one line per deck (counts, introduced today, allocation). `decks`: every deck in full (priority, caps, introduced today — web also from events —, raw pools, budget allocation, counts shown, note / card counts). `cards`: per-card rows [card_id, note_id, deck_id, card_type, queue (0 new 1 learning 2 review 3 relearning), due_ms, reps, lapses, event_count, in_due_queue, first_review_ms], paged and filterable. `events`: the sorted event-id hashes, paged. `id` may be `latest_lab` / `latest_web`.',
    {
      id: z.string().min(1).describe('Report id, or latest_lab / latest_web.'),
      section: z.enum(['overview', 'decks', 'cards', 'events']).optional(),
      offset: z.number().int().min(0).optional().describe('cards / events: first row (default 0).'),
      limit: z.number().int().min(1).max(500).optional().describe('cards / events: rows per page (default 50).'),
      deck_id: z.string().optional().describe('cards: only this deck.'),
      queue: z.number().int().min(0).max(3).optional().describe('cards: only this queue state.'),
      in_due_queue: z.boolean().optional().describe('cards: only cards in (true) / out of (false) the study queue.'),
      card_id: z.string().optional().describe('cards: one card (or every card of a note id).'),
    },
    async ({ id, section, offset, limit, deck_id, queue, in_due_queue, card_id }) =>
      guard(async () => {
        const resolved = await resolveReportId(api, id);
        if (!resolved) return errorResult(`No ${id.replace(/^latest[_-]/i, '')} report yet — send one from the app first.`);
        const query: Record<string, string> = { section: section ?? 'overview' };
        if (section === 'cards' || section === 'events') {
          query.offset = String(offset ?? 0);
          query.limit = String(limit ?? 50);
        }
        if (deck_id) query.deck_id = deck_id;
        if (queue !== undefined) query.queue = String(queue);
        if (in_due_queue !== undefined) query.in_due_queue = in_due_queue ? '1' : '0';
        if (card_id) query.card_id = card_id;
        return jsonResult(await api.get(`/api/debug/reports/${encodeURIComponent(resolved)}`, query));
      })
  );

  server.tool(
    'compare_debug_reports',
    'Diff two debug reports on the server — by default the newest Lab report (a) against the newest web report (b) — to explain why the apps show different numbers of cards due. Returns: `hints` (plain-language pointers — read these first), `context` (minutes apart, local dates, timezones, cutoffs, budgets, bonus), `headline` (every home / queue / totals number side by side, diff = b − a), `decks` (per-deck fields that differ: pools, introduced today, allocation, counts), `cards` (how many differ and by which field, queue transitions, cards in one side\'s queue only, "same events but different state", the first `max_cards` differing cards with both sides\' state and the SERVER\'s event count, cards only one side has), and `events` (event ids only one side has, which of those the server has, and how many server events each side is missing).',
    {
      a: z.string().optional().describe('Report id (default: newest lab). latest_lab / latest_web work too.'),
      b: z.string().optional().describe('Report id (default: newest web).'),
      max_cards: z.number().int().min(0).max(200).optional().describe('How many differing cards to list in full (default 25).'),
      with_server: z.boolean().optional().describe('Include the server\'s own review events as the truth column (default true).'),
    },
    async ({ a, b, max_cards, with_server }) =>
      guard(async () => {
        const query: Record<string, string> = { max_cards: String(max_cards ?? 25) };
        if (a) {
          const id = await resolveReportId(api, a);
          if (!id) return errorResult(`No report for ${a}.`);
          query.a = id;
        }
        if (b) {
          const id = await resolveReportId(api, b);
          if (!id) return errorResult(`No report for ${b}.`);
          query.b = id;
        }
        if (with_server === false) query.server = '0';
        return jsonResult(await api.get('/api/debug/compare', query));
      })
  );
}
