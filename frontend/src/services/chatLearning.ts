/**
 * Learning tools in the chat (docs/CHAT.md PR 3) — the pure parts: what to ask
 * Claude for when making flashcards, the review sheet → batch body, the
 * per-conversation pinyin / translation toggles kept on the device, which
 * messages still need word chips, and the correction diff.
 */
import { diffHanzi, normalizeHanziAnswer } from '@shared/lesson/answer-check';
import { looksLikeChinese } from '@shared/chats/messageTools';
import type { BatchNoteInput } from '../api/client';
import type { ProposeFlashcardsBody } from '../api/chat';
import type { ChatWord, MessageWithSender, ProposedChatCard } from '../types';

// ---------- Make flashcards: what to send ----------

/** The server's cap on picked messages. */
export const MAX_SELECTED_MESSAGES = 80;

export type FlashcardScope =
  | { kind: 'selected'; ids: string[] }
  | { kind: 'message'; id: string }
  | { kind: 'correction'; id: string }
  | { kind: 'today' }
  | { kind: 'last50' };

/** Local midnight of `now`. */
export function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** The propose request for a scope (no ids and no since = the server's last 50 messages). */
export function proposeBodyFor(scope: FlashcardScope, now: Date = new Date()): ProposeFlashcardsBody {
  switch (scope.kind) {
    case 'selected': {
      const ids = [...new Set(scope.ids.filter((id) => id && !id.startsWith('outbox:')))];
      return { message_ids: ids.slice(-MAX_SELECTED_MESSAGES) };
    }
    case 'message':
      return { message_ids: [scope.id] };
    case 'correction':
      return { message_ids: [scope.id], focus: 'correction' };
    case 'today':
      return { since: startOfLocalDay(now).toISOString() };
    case 'last50':
      return {};
  }
}

/** A short label for the review sheet's subtitle. */
export function scopeLabel(scope: FlashcardScope): string {
  switch (scope.kind) {
    case 'selected':
      return `${scope.ids.length} message${scope.ids.length === 1 ? '' : 's'}`;
    case 'message':
      return 'this message';
    case 'correction':
      return 'the correction';
    case 'today':
      return "today's messages";
    case 'last50':
      return 'the last 50 messages';
  }
}

// ---------- Review sheet → batch ----------

export interface CardDraft extends ProposedChatCard {
  key: string;
  checked: boolean;
}

/** Every proposed card, ticked unless it is already in one of my decks. */
export function draftsFromProposal(cards: ProposedChatCard[]): CardDraft[] {
  return cards.map((c, i) => ({ ...c, key: `${i}:${c.hanzi}`, checked: !c.already_have }));
}

/** The ticked cards as notes for `POST /api/decks/:id/notes/batch` (blank optional fields left out). */
export function batchNotesFrom(drafts: CardDraft[]): BatchNoteInput[] {
  const out: BatchNoteInput[] = [];
  for (const d of drafts) {
    if (!d.checked) continue;
    const hanzi = d.hanzi.trim();
    const english = d.english.trim();
    if (!hanzi || !english) continue;
    const note: BatchNoteInput = { hanzi, pinyin: d.pinyin.trim(), english };
    const facts = (d.fun_facts || '').trim();
    if (facts) note.fun_facts = facts;
    const clue = (d.sentence_clue || '').trim();
    if (clue) {
      note.sentence_clue = clue;
      const py = (d.sentence_clue_pinyin || '').trim();
      const tr = (d.sentence_clue_translation || '').trim();
      if (py) note.sentence_clue_pinyin = py;
      if (tr) note.sentence_clue_translation = tr;
    }
    out.push(note);
  }
  return out;
}

// ---------- Pinyin / translation toggles (per conversation, on the device) ----------

export type DisplayKind = 'pinyin' | 'translate';

export interface ChatDisplayPrefs {
  pinyinAll: boolean;
  translateAll: boolean;
  /** Per-message overrides of the "for all" switch. */
  pinyin: Record<string, boolean>;
  translate: Record<string, boolean>;
}

export const EMPTY_DISPLAY_PREFS: ChatDisplayPrefs = { pinyinAll: false, translateAll: false, pinyin: {}, translate: {} };

/** Overrides kept per kind (oldest dropped) so the stored prefs stay small. */
const MAX_OVERRIDES = 300;

const allKey = (kind: DisplayKind) => (kind === 'pinyin' ? 'pinyinAll' : 'translateAll');

export function isShown(prefs: ChatDisplayPrefs, kind: DisplayKind, messageId: string): boolean {
  const own = prefs[kind][messageId];
  return own ?? prefs[allKey(kind)];
}

/** Flip one message; an override equal to the "for all" switch is dropped. */
export function toggleShown(prefs: ChatDisplayPrefs, kind: DisplayKind, messageId: string): ChatDisplayPrefs {
  const next = !isShown(prefs, kind, messageId);
  const map = { ...prefs[kind] };
  delete map[messageId];
  if (next !== prefs[allKey(kind)]) map[messageId] = next;
  const keys = Object.keys(map);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_OVERRIDES))) delete map[k];
  return { ...prefs, [kind]: map };
}

/** "Show pinyin for all" / "Show translations for all": the switch, and every message follows it. */
export function setShownForAll(prefs: ChatDisplayPrefs, kind: DisplayKind, on: boolean): ChatDisplayPrefs {
  return { ...prefs, [allKey(kind)]: on, [kind]: {} };
}

const prefsKey = (conversationId: string) => `chat-display:${conversationId}`;

function cleanMap(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'boolean') out[k] = v;
  return out;
}

export function loadDisplayPrefs(conversationId: string): ChatDisplayPrefs {
  try {
    const raw = localStorage.getItem(prefsKey(conversationId));
    if (!raw) return EMPTY_DISPLAY_PREFS;
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      pinyinAll: o.pinyinAll === true,
      translateAll: o.translateAll === true,
      pinyin: cleanMap(o.pinyin),
      translate: cleanMap(o.translate),
    };
  } catch {
    return EMPTY_DISPLAY_PREFS;
  }
}

export function saveDisplayPrefs(conversationId: string, prefs: ChatDisplayPrefs): void {
  try {
    localStorage.setItem(prefsKey(conversationId), JSON.stringify(prefs));
  } catch {
    // storage blocked: the toggles last for this visit
  }
}

// ---------- Word chips ----------

/** Same limit as the server's words splitter. */
export const WORDS_MAX_CHARS = 1500;

/** The text a message's words cover: the voice transcript, else the content. */
export function wordsTextOf(msg: Pick<MessageWithSender, 'content' | 'attachment'>): { text: string; source: 'content' | 'transcript' } | null {
  const att = msg.attachment;
  if (att?.kind === 'voice') {
    if (att.transcript_status !== 'done') return null;
    const t = att.transcript || '';
    return t.trim() ? { text: t, source: 'transcript' } : null;
  }
  return msg.content.trim() ? { text: msg.content, source: 'content' } : null;
}

/** The message's words when they match its current text (else null). */
export function usableWords(msg: Pick<MessageWithSender, 'content' | 'attachment' | 'words' | 'words_source'>): ChatWord[] | null {
  const target = wordsTextOf(msg);
  const words = msg.words;
  if (!target || !words || words.length === 0) return null;
  if ((msg.words_source ?? 'content') !== target.source) return null;
  return words.map((w) => w.text).join('') === target.text ? words : null;
}

/** True when the message has Chinese but no words yet (→ ask for them once it scrolls into view). */
export function needsWords(msg: Pick<MessageWithSender, 'id' | 'content' | 'attachment' | 'words' | 'words_source' | 'deleted_at'>): boolean {
  if (msg.deleted_at || msg.id.startsWith('outbox:')) return false;
  const target = wordsTextOf(msg);
  if (!target || target.text.length > WORDS_MAX_CHARS || !looksLikeChinese(target.text)) return false;
  return usableWords(msg) === null;
}

// ---------- Correction diff ----------

export type DiffKind = 'same' | 'del' | 'ins' | 'punct';
export interface DiffPart {
  text: string;
  kind: DiffKind;
}

/**
 * The corrected text marked against the original, red-pen style: characters
 * kept ('same'), struck out ('del', only in the original) and written in
 * ('ins', only in the correction). Characters are compared with `diffHanzi`
 * (punctuation and spaces don't count); the correction's own punctuation is
 * kept in place as 'punct'.
 */
export function correctionDiff(original: string, corrected: string): DiffPart[] {
  const d = diffHanzi(original, corrected);
  // One merged walk along the common subsequence: typed (original) vs expected (corrected).
  const merged: Array<{ ch: string; kind: 'same' | 'del' | 'ins' }> = [];
  let i = 0;
  let j = 0;
  while (i < d.typed.length || j < d.expected.length) {
    if (i < d.typed.length && !d.typed[i].hit) {
      merged.push({ ch: d.typed[i++].ch, kind: 'del' });
    } else if (j < d.expected.length && !d.expected[j].hit) {
      merged.push({ ch: d.expected[j++].ch, kind: 'ins' });
    } else {
      merged.push({ ch: d.expected[j].ch, kind: 'same' });
      i++;
      j++;
    }
  }
  // Re-thread the correction's punctuation / spaces into the merged walk.
  const parts: DiffPart[] = [];
  const push = (text: string, kind: DiffKind) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ text, kind });
  };
  let p = 0;
  for (const raw of Array.from(corrected)) {
    if (!normalizeHanziAnswer(raw)) {
      push(raw, 'punct');
      continue;
    }
    while (p < merged.length && merged[p].kind === 'del') push(merged[p++].ch, 'del');
    if (p < merged.length) {
      push(merged[p].ch, merged[p].kind);
      p++;
    }
  }
  while (p < merged.length) push(merged[p].ch, merged[p++].kind);
  return parts;
}

/** True when the correction changes no characters (only punctuation / spacing, or nothing). */
export function correctionIsNoop(original: string, corrected: string): boolean {
  return normalizeHanziAnswer(original) === normalizeHanziAnswer(corrected);
}
