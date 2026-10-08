import { looksLikeChinese } from './messageTools';
import { autoCheckText, openInCoachRequest, sayBetterState } from './autoCheck';

/**
 * The long-press (phone) / right-click + hover ⋯ (desktop) menu of one chat
 * message — chat round 2, docs/CHAT.md "Round 2". One definition for the web
 * (components/chat/MessageMenu.tsx) and the Lab app (core `MessageMenu.kt`,
 * parity-tested). Bubbles carry no buttons any more: every tool lives here.
 *
 * Order (what someone reaches for first): How to say it better (my own message
 * when the auto-check found something or the tutor corrected it — always FIRST) and
 * Open in Coach right after it, Reply, Copy, Forward, Translate,
 * Pinyin, Explain, Save as flashcard, Open in Coach (any message with Chinese: mine is
 * checked, theirs explained — docs/CHAT.md "Chat ↔ Coach"), Make flashcards from selection, Check my
 * Chinese, Correct, Read aloud, Word by word (Claude practice chat), Discuss with
 * Claude, Pin, Info, Edit, Delete, Select. A reaction bar sits on top (`reactions`).
 */

type RelationshipRole = 'tutor' | 'student';

export type MenuActionId =
  | 'say_better'
  | 'open_coach'
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
  attachment?: { kind: string; transcript?: string | null; transcript_status?: string | null; translation?: string | null } | null;
  /** Machine translation already on the message (text messages). */
  translation?: string | null;
  correction?: { text: string } | null;
  check_status?: 'correct' | 'needs_improvement' | null;
  /** The background check (shared/chats/autoCheck.ts) — only the sender ever has it. */
  auto_check?: { status: 'ok' | 'improvable'; text: string } | null;
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

/**
 * The items both menus share (the chat's `messageMenu` and Ask Claude's `askClaudeMenu`), so a
 * label or an icon never drifts between them.
 */
const ITEM = {
  sayBetter: (): MenuItem => ({ id: 'say_better', label: 'How to say it better', icon: '✨', needsInternet: false }),
  openCoach: (): MenuItem => ({ id: 'open_coach', label: 'Open in Coach', icon: '🎓', needsInternet: true }),
  copy: (): MenuItem => ({ id: 'copy', label: 'Copy', icon: '📋', needsInternet: false }),
  translate: (translated: boolean, on: boolean): MenuItem => ({
    id: 'translate',
    label: on ? 'Hide translation' : 'Translate',
    icon: '🌐',
    needsInternet: !translated && !on,
    ...(on ? { active: true } : {}),
  }),
  pinyin: (on: boolean): MenuItem => ({ id: 'pinyin', label: on ? 'Hide pinyin' : 'Pinyin', icon: '拼', needsInternet: false, ...(on ? { active: true } : {}) }),
  explain: (): MenuItem => ({ id: 'explain', label: 'Explain', icon: '🔍', needsInternet: true }),
  saveCard: (): MenuItem => ({ id: 'save_card', label: 'Save as flashcard', icon: '🃏', needsInternet: true }),
  play: (): MenuItem => ({ id: 'play', label: 'Read aloud', icon: '🔊', needsInternet: true }),
};

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
    return { reactions: false, items: text ? [ITEM.copy()] : [] };
  }
  const isMine = msg.sender_id === viewerId;
  const isLearner = viewerRole === 'student' || isAiConversation;
  const zh = !!text && looksLikeChinese(text);
  const translated = kind === 'voice' ? !!msg.attachment?.translation : !!msg.translation;
  const items: MenuItem[] = [];
  // Auto-check found something, or the tutor corrected it: the first thing to reach for.
  const sayBetter = !!sayBetterState({ ...msg, attachment: kind ? msg.attachment : null }, viewerId);
  if (sayBetter) items.push(ITEM.sayBetter());
  // "Open in Coach": my own message (as the learner) is checked there, anyone else's explained.
  const coach = openInCoachRequest({ ...msg, attachment: kind ? msg.attachment : null }, viewerId);
  const openCoach = !!coach && (!isMine || isLearner);
  const coachItem = ITEM.openCoach();
  if (openCoach && sayBetter) items.push(coachItem);
  // A current auto-check answers "Check my Chinese" already.
  const autoChecked = !!msg.auto_check && msg.auto_check.text === autoCheckText({ ...msg, attachment: kind ? msg.attachment : null });
  items.push({ id: 'reply', label: 'Reply', icon: '↩️', needsInternet: false });
  if (text) items.push(ITEM.copy());
  if (!isAiConversation) items.push({ id: 'forward', label: 'Forward', icon: '↪️', needsInternet: true });
  if (zh && (kind !== 'voice' || translated)) {
    items.push(ITEM.translate(translated, state.translateOn));
  }
  if (zh) {
    items.push(ITEM.pinyin(state.pinyinOn), ITEM.explain(), ITEM.saveCard());
  }
  if (openCoach && !sayBetter) items.push(coachItem);
  if (text) items.push({ id: 'select_cards', label: 'Make flashcards from selection', icon: '🗂️', needsInternet: true });
  if (isMine && zh && isLearner && !kind && !autoChecked) {
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
  if (zh && kind !== 'voice') items.push(ITEM.play());
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

// ---------- Ask Claude on the study card (docs/STUDY_SESSION.md "Ask Claude") ----------

/** One message of the Ask Claude conversation: the learner's question, or Claude's answer. */
export interface AskMenuMessage {
  /** True for the learner's own question. */
  mine: boolean;
  text: string;
  /** The English already fetched for it (Translate then works offline). */
  translation?: string | null;
  /** The background check of the learner's own Chinese (shared/chats/autoCheck.ts). */
  auto_check?: { status: 'ok' | 'improvable'; text: string } | null;
  /** An English Markdown answer (the "English" setting / an older answer): Copy only. */
  markdown?: boolean;
}

/** Longest text the sentence tools take (Explain, Save as flashcard, Open in Coach on Claude's text) — a sentence or two. */
export const ASK_SENTENCE_TOOLS_MAX = 120;

/**
 * The long-press menu of an Ask Claude message — the chat's menu, only the parts that make
 * sense here (no reactions, reply, forward, pin, edit, delete, select): How to say it better +
 * Open in Coach first on my own Chinese the auto-check flagged, then Copy, Translate, Pinyin,
 * Explain / Save as flashcard (a sentence-sized text only), Open in Coach (my own Chinese is
 * checked there; Claude's — when sentence-sized — explained), Read aloud. An English Markdown
 * answer has Copy only.
 * Lab port: core `AskClaude.menu`, parity-tested.
 */
export function askClaudeMenu(msg: AskMenuMessage, state: MenuState = { pinyinOn: false, translateOn: false }): MessageMenu {
  const text = (msg.text || '').trim();
  if (!text) return { reactions: false, items: [] };
  if (msg.markdown) return { reactions: false, items: [ITEM.copy()] };
  const zh = looksLikeChinese(text);
  const short = text.length <= ASK_SENTENCE_TOOLS_MAX;
  const viewer = 'me';
  const asMessage = { sender_id: msg.mine ? viewer : 'claude', content: msg.text, auto_check: msg.auto_check ?? null };
  const sayBetter = !!sayBetterState(asMessage, viewer);
  const coach = !!openInCoachRequest(asMessage, viewer) && (msg.mine || short);
  const items: MenuItem[] = [];
  if (sayBetter) items.push(ITEM.sayBetter());
  if (coach && sayBetter) items.push(ITEM.openCoach());
  items.push(ITEM.copy());
  if (zh) {
    items.push(ITEM.translate(!!msg.translation, state.translateOn), ITEM.pinyin(state.pinyinOn));
    if (short) items.push(ITEM.explain(), ITEM.saveCard());
  }
  if (coach && !sayBetter) items.push(ITEM.openCoach());
  if (zh) items.push(ITEM.play());
  return { reactions: false, items };
}
