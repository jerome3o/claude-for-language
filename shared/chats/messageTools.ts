/** Mirrors RelationshipRole / MessageCheckStatus in frontend/src/types.ts. */
type RelationshipRole = 'tutor' | 'student';
type MessageCheckStatus = 'correct' | 'needs_improvement';

/**
 * Role-aware per-message tool set for the chat page (web: components/chat,
 * Lab app: android-lab core `MessageTools.kt`, parity-tested).
 *
 * Inline (always visible, 44px): Reply, Play.
 * Menu (⋯ / long-press): everything else, filtered by who is looking and whose
 * message it is:
 *   - "Check my Chinese" only on the viewer's own Chinese messages, and only when
 *     the viewer is the learner (a tutor never sees it; in the Claude practice
 *     chat the user is always the learner).
 *   - "Translate" only on the other party's Chinese messages. For a tutor it is
 *     labelled "Make a card from this" (same endpoint, different intent).
 *   - "Word by word" (interactive segmented translation) only for a learner on
 *     the other party's Chinese messages.
 *   - Discuss with Claude, React and Copy everywhere.
 */

export type MessageToolId =
  | 'reply'
  | 'play'
  | 'react'
  | 'check'
  | 'view_corrections'
  | 'translate'
  | 'word_by_word'
  | 'discuss'
  | 'copy'
  // PR 2 (manageToolsForMessage only — toolsForMessage never returns these):
  | 'pin'
  | 'unpin'
  | 'edit'
  | 'delete';

export interface MessageToolInput {
  sender_id: string;
  content: string;
  check_status?: MessageCheckStatus | null;
  has_discussion?: boolean;
}

export interface MessageTool {
  id: MessageToolId;
  label: string;
  icon: string;
  /** Needs a network round-trip (AI call, TTS or a server write). */
  needsInternet: boolean;
}

export interface MessageToolSet {
  /** Shown inline next to the timestamp. */
  inline: MessageTool[];
  /** Shown in the ⋯ sheet / popover. */
  menu: MessageTool[];
  isMine: boolean;
  hasChinese: boolean;
}

export function looksLikeChinese(text: string): boolean {
  return /[一-鿿]/.test(text);
}

export function toolsForMessage(
  message: MessageToolInput,
  viewerRole: RelationshipRole,
  isAiConversation: boolean,
  viewerId: string
): MessageToolSet {
  const isMine = message.sender_id === viewerId;
  const hasChinese = looksLikeChinese(message.content);
  // In the Claude practice chat the user is always the one learning.
  const isLearner = viewerRole === 'student' || isAiConversation;

  const inline: MessageTool[] = [
    { id: 'reply', label: 'Reply', icon: '↩', needsInternet: false },
  ];
  if (hasChinese) {
    inline.push({ id: 'play', label: 'Play', icon: '🔊', needsInternet: true });
  }

  const menu: MessageTool[] = [
    { id: 'react', label: 'React', icon: '😊', needsInternet: true },
  ];

  if (isMine && hasChinese && isLearner) {
    if (message.check_status === 'needs_improvement') {
      menu.push({ id: 'view_corrections', label: 'View corrections', icon: '📝', needsInternet: false });
    } else if (message.check_status !== 'correct') {
      menu.push({ id: 'check', label: 'Check my Chinese', icon: '✓', needsInternet: true });
    }
  }

  if (!isMine && hasChinese) {
    menu.push({
      id: 'translate',
      label: isLearner ? 'Translate & make flashcard' : 'Make a card from this',
      icon: '🔤',
      needsInternet: true,
    });
    if (isLearner) {
      menu.push({ id: 'word_by_word', label: 'Word by word', icon: '🈯', needsInternet: true });
    }
  }

  menu.push({
    id: 'discuss',
    label: message.has_discussion ? 'Continue discussion with Claude' : 'Discuss with Claude',
    icon: '💬',
    needsInternet: true,
  });
  menu.push({ id: 'copy', label: 'Copy text', icon: '📋', needsInternet: false });

  return { inline, menu, isMine, hasChinese };
}

/** What `manageToolsForMessage` needs to know about a message (docs/CHAT.md PR 2). */
export interface ManageToolInput {
  sender_id: string;
  deleted_at?: string | null;
  pinned_at?: string | null;
  attachment?: { kind: string } | null;
  /** A send still in the outbox: nothing to manage until the server has it. */
  pending?: boolean;
}

/**
 * Pin / edit / delete for the ⋯ sheet, appended after `toolsForMessage(...).menu`
 * (kept separate so the original tool set — and its Lab parity vectors — stay
 * exactly as they were). Pin / unpin for either participant; edit (text, or a
 * photo's caption) and delete only on my own messages. Nothing on a deleted or
 * pending message, nor in the Claude practice chat.
 */
export function manageToolsForMessage(message: ManageToolInput, isAiConversation: boolean, viewerId: string): MessageTool[] {
  if (isAiConversation || message.deleted_at || message.pending) return [];
  const isMine = message.sender_id === viewerId;
  const kind = message.attachment?.kind ?? null;
  const out: MessageTool[] = [
    message.pinned_at
      ? { id: 'unpin', label: 'Unpin', icon: '📌', needsInternet: true }
      : { id: 'pin', label: 'Pin', icon: '📌', needsInternet: true },
  ];
  if (isMine && kind !== 'voice') {
    out.push({ id: 'edit', label: kind === 'image' ? 'Edit caption' : 'Edit', icon: '✏️', needsInternet: true });
  }
  if (isMine) out.push({ id: 'delete', label: 'Delete', icon: '🗑', needsInternet: true });
  return out;
}
