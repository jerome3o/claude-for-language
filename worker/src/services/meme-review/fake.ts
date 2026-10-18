/**
 * E2E_TEST_MODE (or no ANTHROPIC_API_KEY): a stand-in for the research agent's model, so the whole
 * flow — search results → URLs collected → submit_issue → validation → the issue — runs hermetically.
 * Round 1 "searches" (a web_search_tool_result with the sample's URLs, then a pause_turn); round 2
 * hands in the SAMPLE submission (shared/meme-review/sample.ts), which carries one invented URL the
 * validator drops. Short delays so the page shows "Researching…" first.
 */
import { SAMPLE_MEME_SEEN_URLS, SAMPLE_MEME_SUBMISSION } from '@shared/meme-review';
import type { MemeModelCall } from './agent';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function fakeMemeCall(opts: { delayMs?: number } = {}): MemeModelCall {
  const delay = opts.delayMs ?? 600;
  return async ({ messages }) => {
    await sleep(delay);
    const searched = messages.some((m) => m.role === 'assistant');
    if (!searched) {
      return {
        stop_reason: 'pause_turn',
        usage: { input_tokens: 3000, output_tokens: 400, server_tool_use: { web_search_requests: 2 } },
        content: [
          { type: 'text', text: 'Let me look at this month’s buzzword lists.' },
          { type: 'server_tool_use', id: 'srvtoolu_fake1', name: 'web_search', input: { query: '网络热词 10月' } },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'srvtoolu_fake1',
            content: SAMPLE_MEME_SEEN_URLS.map((url) => ({ type: 'web_search_result', url, title: url, encrypted_content: 'x', page_age: null })),
          },
        ],
      };
    }
    return {
      stop_reason: 'tool_use',
      usage: { input_tokens: 9000, output_tokens: 5200, cache_read_input_tokens: 3000 },
      content: [{ type: 'tool_use', id: 'toolu_fake_submit', name: 'submit_issue', input: SAMPLE_MEME_SUBMISSION }],
    };
  };
}
