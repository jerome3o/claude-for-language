/**
 * Where a chat's ← goes: the Chats inbox when the chat was opened from it
 * (router state `{ from: '/chats' }`), otherwise the person's page.
 */
export function chatBackTarget(state: unknown, relId: string | undefined): string {
  const from = (state as { from?: unknown } | null)?.from;
  if (from === '/chats') return '/chats';
  return relId ? `/connections/${relId}` : '/chats';
}
