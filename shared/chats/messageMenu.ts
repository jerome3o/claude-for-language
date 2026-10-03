import { looksLikeChinese } from './messageTools';

/**
 * The long-press (phone) / right-click + hover ⋯ (desktop) menu of one chat
 * message — chat round 2, docs/CHAT.md "Round 2". One definition for the web
 * (components/chat/MessageMenu.tsx) and the Lab app (core `MessageMenu.kt`,
 * parity-tested). Bubbles carry no buttons any more: every tool lives here.
 *
 * Order (what someone reaches for first): Reply, Copy, Forward, Translate,
 * Pinyin, Explain, Save as flashcard, Make flashcards from selection, Check my
 * Chinese, Correct, Read aloud, Word by word (Claude practice chat), Discuss with
 * Claude, Pin, Info, Edit, Delete, Select. A reaction bar sits on top (`reactions`).
 */

type RelationshipRole = 'tutor' | 'student';

export type MenuActionId =
  | 'reply'
  | 'copy'
  | 'forward'
  | 'translate'
  | 'pinyin'
  | 'explain'
  | 'save_card'
  | 'select_cards'
  | 'check'
  | 'view_corrections'
  | 'correct'
  | 'remove_correction'
  | 'correction_card'
  | 'play'
  | 'word_by_word'
  | 'discuss'
  | 'pin'
  | 'unpin'
  | 'info'
  | 'edit'
  | 'delete'
  | 'select';

export interface MenuMessage {
  sender_id: string;
  content: string;
  deleted_at?: string | null;
  /** Still in the outbox. */
  pending?: boolean;
  attachment?: { kind: string; transcript?: string | null; translation?: string | null } | null;
  /** Machine translation already on the message (text messages). */
  translation?: string | null;
  correction?: { text: string } | null;
  check_status?: 'correct' | 'needs_improvement' | null;
  has_discussion?: boolean;
  pinned_at?: string | null;
}

/** What is switched on for this message right now (the toggles show "Hide …"). */
export interface MenuState {
  pinyinOn: boolean;
  translateOn: boolean;
}

export interface MenuItem {
  id: MenuActionId;
  label: string;
  icon: string;
  needsInternet: boolean;
  /** A toggle that is currently on. */
  active?: boolean;
  /** Shown in red (Delete). */
  danger?: boolean;
}

export interface MessageMenu {
  /** The quick-emoji reaction bar on top. */
  reactions: boolean;
  items: MenuItem[];
}

/** The text the learning tools work on: the voice transcript, else the message / caption. */
export function menuText(msg: Pick<MenuMessage, 'content' | 'attachment'>): string {
  if (msg.attachment?.kind === 'voice') return (msg.attachment.transcript || '').trim();
  return (msg.content || '').trim();
}

export function messageMenu(
  msg: MenuMessage,
  viewerRole: RelationshipRole,
  isAiConversation: boolean,
  viewerId: string,
  state: MenuState = { pinyinOn: false, translateOn: false },
): MessageMenu {
  if (msg.deleted_at) return { reactions: false, items: [] };
  const text = menuText(msg);
  const kind = msg.attachment?.kind ?? null;
  if (msg.pending) {
    return { reactions: false, items: text ? [{ id: 'copy', label: 'Copy', icon: '📋', needsInternet: false }] : [] };
  }
  const isMine = msg.sender_id === viewerId;
  const isLearner = viewerRole === 'student' || isAiConversation;
  const zh = !!text && looksLikeChinese(text);
  const translated = kind === 'voice' ? !!msg.attachment?.translation : !!msg.translation;
  const items: MenuItem[] = [{ id: 'reply', label: 'Reply', icon: '↩️', needsInternet: false }];
  if (text) items.push({ id: 'copy', label: 'Copy', icon: '📋', needsInternet: false });
  if (!isAiConversation) items.push({ id: 'forward', label: 'Forward', icon: '↪️', needsInternet: true });
  if (zh && (kind !== 'voice' || translated)) {
    items.push({
      id: 'translate',
      label: state.translateOn ? 'Hide translation' : 'Translate',
      icon: '🌐',
      needsInternet: !translated && !state.translateOn,
      ...(state.translateOn ? { active: true } : {}),
    });
  }
  if (zh) {
    items.push({ id: 'pinyin', label: state.pinyinOn ? 'Hide pinyin' : 'Pinyin', icon: '拼', needsInternet: false, ...(state.pinyinOn ? { active: true } : {}) });
    items.push({ id: 'explain', label: 'Explain', icon: '🔍', needsInternet: true });
    items.push({ id: 'save_card', label: 'Save as flashcard', icon: '🃏', needsInternet: true });
  }
  if (text) items.push({ id: 'select_cards', label: 'Make flashcards from selection', icon: '🗂️', needsInternet: true });
  if (isMine && zh && isLearner && !kind) {
    if (msg.check_status === 'needs_improvement') items.push({ id: 'view_corrections', label: 'View corrections', icon: '📝', needsInternet: false });
    else if (msg.check_status !== 'correct') items.push({ id: 'check', label: 'Check my Chinese', icon: '✅', needsInternet: true });
  }
  if (!isAiConversation && msg.correction && isMine) {
    items.push({ id: 'correction_card', label: 'Make a card from the correction', icon: '✏️', needsInternet: true });
  }
  if (!isAiConversation && viewerRole === 'tutor' && !isMine && !kind && msg.content.trim()) {
    items.push({ id: 'correct', label: msg.correction ? 'Edit correction' : 'Correct', icon: '✏️', needsInternet: true });
    if (msg.correction) items.push({ id: 'remove_correction', label: 'Remove correction', icon: '✖️', needsInternet: true });
  }
  if (zh && kind !== 'voice') items.push({ id: 'play', label: 'Read aloud', icon: '🔊', needsInternet: true });
  if (isAiConversation && !isMine && zh && isLearner && !kind) {
    items.push({ id: 'word_by_word', label: 'Word by word', icon: '🈯', needsInternet: true });
  }
  if (text) {
    items.push({
      id: 'discuss',
      label: msg.has_discussion ? 'Continue with Claude' : 'Discuss with Claude',
      icon: '💬',
      needsInternet: true,
    });
  }
  if (!isAiConversation) {
    items.push(msg.pinned_at ? { id: 'unpin', label: 'Unpin', icon: '📌', needsInternet: true } : { id: 'pin', label: 'Pin', icon: '📌', needsInternet: true });
    items.push({ id: 'info', label: 'Info', icon: 'ℹ️', needsInternet: false });
    if (isMine && kind !== 'voice') items.push({ id: 'edit', label: kind === 'image' ? 'Edit caption' : 'Edit', icon: '✏️', needsInternet: true });
    if (isMine) items.push({ id: 'delete', label: 'Delete', icon: '🗑️', needsInternet: true, danger: true });
  }
  items.push({ id: 'select', label: 'Select', icon: '☑️', needsInternet: false });
  return { reactions: true, items };
}
