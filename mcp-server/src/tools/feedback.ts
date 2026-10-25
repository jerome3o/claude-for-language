/**
 * Feature requests in MCP results (docs/FEEDBACK.md): in-app feedback is a feature_requests row with
 * `kind` feedback | bug, a JSON `context` (platform, app version, route pattern, device, online…) and
 * maybe a screenshot under the private `feedback/` prefix. `shapeFeatureRequestForMcp` parses the
 * context into an object + one readable line; the caller then runs `signMediaUrls`, which swaps the
 * screenshot's `/api/audio/feedback/…` path for a signed link (24 h) the agent can open.
 */
import { feedbackContextLine, pickFeedbackContext, type FeedbackContext } from '../../../shared/feedback/feedback';

export const FEATURE_REQUEST_KINDS = ['request', 'feedback', 'bug'] as const;

export function shapeFeatureRequestForMcp<T extends Record<string, unknown>>(row: T): Omit<T, 'context' | 'screenshot_key'> & {
  kind: string;
  context: FeedbackContext | null;
  context_line: string | null;
  has_screenshot: boolean;
} {
  let context: FeedbackContext | null = null;
  if (typeof row.context === 'string' && row.context) {
    try {
      context = pickFeedbackContext(JSON.parse(row.context));
    } catch {
      context = null;
    }
  }
  const { context: _raw, screenshot_key: _key, ...rest } = row;
  return {
    ...(rest as Omit<T, 'context' | 'screenshot_key'>),
    kind: typeof row.kind === 'string' ? row.kind : 'request',
    context,
    context_line: context ? feedbackContextLine(context) || null : null,
    has_screenshot: !!row.screenshot_url,
  };
}

/** SQL for a `kind` filter: feedback = feedback + bug. */
export function kindCondition(kind: 'request' | 'feedback' | 'bug' | undefined): { sql: string; params: string[] } | null {
  if (!kind) return null;
  if (kind === 'feedback') return { sql: "fr.kind IN ('feedback', 'bug')", params: [] };
  return { sql: 'fr.kind = ?', params: [kind] };
}
