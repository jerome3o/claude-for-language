/**
 * Where a chat's ← goes: the Chats inbox when the chat was opened from it
 * (router state `{ from: '/chats' }`), otherwise the person's page — except for a
 * learner (no students): since the Tutor tab went (Nov 2026) the chat is the hub and the
 * tutor page is opened FROM it (header name / ⋯), so ← goes to the Chats inbox (never a
 * chat → tutor page → chat loop).
 */
export function chatBackTarget(state: unknown, relId: string | undefined, learner = false): string {
  const from = (state as { from?: unknown } | null)?.from;
  if (from === '/chats') return '/chats';
  if (learner) return '/chats';
  return relId ? `/connections/${relId}` : '/chats';
}
