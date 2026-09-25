/** Where a card's hub page lives: the student's own, or the tutor's view through the relationship. */
export function cardHubPath(noteId: string, relId?: string | null): string {
  return relId ? `/connections/${relId}/cards/${noteId}` : `/cards/${noteId}`;
}

export function claudeChatsPath(relId?: string | null): string {
  return relId ? `/connections/${relId}/claude-chats` : '/claude-chats';
}
