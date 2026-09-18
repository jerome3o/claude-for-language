import type { RelationshipRole, MessageCheckStatus } from '../../types';

/**
 * Role-aware per-message tool set for the chat page.
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
  | 'copy';

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
