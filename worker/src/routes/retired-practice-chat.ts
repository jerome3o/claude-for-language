/**
 * The old Claude practice chat's endpoints, retired (Nov 2026; docs/CHAT.md "Practice with Claude" →
 * "Old practice chats"). A role-play with Claude is a Claude thread now (`practice` context), and every
 * old practice chat (`conversations.is_ai_conversation`) was copied into one as `pc-<conversation id>`
 * (services/claude-agent/backfill.ts). Both apps open that thread instead of the old chat; the word
 * lookup it used (`/api/vocabulary/define`) was replaced by the language explorer everywhere.
 *
 * App builds from before still call these, so they answer **410 Gone** with
 * `{ error, moved_to_thread }` — the thread id where there is one (copied again first, so a message an
 * old build just sent into the old chat is in the thread too), else null. The old apps show `error`
 * as their usual "couldn't reply" notice; nothing retries a 410 by itself.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { ensureLegacyPracticeThread } from '../services/claude-agent/backfill';

const retired = new Hono<{ Bindings: Env }>();

export const PRACTICE_CHAT_GONE =
  'Practice chats with Claude have moved to the Chats tab. Update the app, then open this chat there to keep going.';
export const DEFINE_GONE = 'Word look-ups moved to the language explorer. Update the app and tap the word again.';

async function practiceGone(c: Context<{ Bindings: Env }>): Promise<Response> {
  let threadId: string | null = null;
  try {
    threadId = await ensureLegacyPracticeThread(c.env.DB, c.get('user').id, c.req.param('id') ?? '', { refresh: true });
  } catch (err) {
    console.error('[retired-practice-chat] copy failed', err instanceof Error ? err.message : err);
  }
  return c.json({ error: PRACTICE_CHAT_GONE, moved_to_thread: threadId }, 410);
}

// Claude's reply in an old practice chat / its opener.
retired.post('/conversations/:id/ai-respond', practiceGone);
retired.post('/conversations/:id/ai-initiate', practiceGone);

// The old chat's word popup (WordDefinitionPopup) and its cache warm-up.
retired.post('/vocabulary/define', (c) => c.json({ error: DEFINE_GONE, moved_to_thread: null }, 410));
retired.post('/vocabulary/populate', (c) => c.json({ error: DEFINE_GONE, moved_to_thread: null }, 410));

export default retired;
