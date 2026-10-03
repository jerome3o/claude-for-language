/**
 * Drafts per conversation (round 2 PR 3): what was typed but not sent stays in
 * that chat's box (this device), like Signal. Newest 50 conversations kept.
 */
const KEY = 'chat-drafts-v1';
const MAX = 50;

type Drafts = Record<string, { text: string; at: number }>;

function read(): Drafts {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Drafts;
  } catch {
    return {};
  }
}

export function loadDraft(conversationId: string | undefined): string {
  if (!conversationId) return '';
  return read()[conversationId]?.text ?? '';
}

export function saveDraft(conversationId: string | undefined, text: string, now = Date.now()): void {
  if (!conversationId) return;
  const all = read();
  if (text.trim()) all[conversationId] = { text, at: now };
  else delete all[conversationId];
  const keep = Object.entries(all)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    /* ignore */
  }
}

/** "1 message waiting to send" / "3 messages waiting…" for the header while the outbox holds this chat's sends. */
export function queueLabel(waiting: number, online: boolean): string | null {
  if (waiting <= 0) return null;
  const n = waiting === 1 ? '1 message' : `${waiting} messages`;
  return online ? `🕓 Sending ${n}…` : `🕓 ${n} waiting for a connection`;
}
