/**
 * Search inside one chat (docs/CHAT.md "Search"). Pure, so the web chat and
 * the Lab app (android-lab core `ChatSearch`, parity-tested against this file)
 * find exactly the same messages.
 */
import { stripTones } from '../decks/search';

export interface SearchableMessage {
  id: string;
  content: string | null | undefined;
  translation?: string | null;
  deleted_at?: string | null;
  attachment?: { kind: string; transcript?: string | null; translation?: string | null } | null;
  /** Word chips (PR 3): `{ text, pinyin }` segments; pinyin makes "nihao" / "nǐ hǎo" match. */
  words?: ReadonlyArray<{ text: string; pinyin?: string | null }> | null;
}

/** The text fields a message is searched by, lower-cased. */
function haystacks(m: SearchableMessage): string[] {
  const out: string[] = [];
  const add = (s: string | null | undefined) => {
    if (s && s.trim()) out.push(s.toLowerCase());
  };
  add(m.content);
  add(m.translation);
  add(m.attachment?.transcript);
  add(m.attachment?.translation);
  return out;
}

/** The message's pinyin, tone-free, with and without spaces between words. */
function pinyinForms(m: SearchableMessage): string[] {
  if (!m.words || m.words.length === 0) return [];
  const syllables = m.words.map((w) => (w.pinyin || '').trim()).filter(Boolean);
  if (syllables.length === 0) return [];
  const spaced = stripTones(syllables.join(' '));
  return [spaced, spaced.replace(/\s+/g, '')];
}

/** Does one message match the query? Empty query → false; deleted messages never match. */
export function messageMatches(m: SearchableMessage, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q || m.deleted_at) return false;
  if (haystacks(m).some((h) => h.includes(q))) return true;
  const qStripped = stripTones(q);
  if (!qStripped) return false;
  const forms = pinyinForms(m);
  if (forms.length === 0) return false;
  const qCompact = qStripped.replace(/\s+/g, '');
  return forms[0].includes(qStripped) || (qCompact.length > 0 && forms[1].includes(qCompact));
}

/** Ids of the matching messages, newest first (input is oldest first, as the chat holds it). */
export function searchMessages(messages: ReadonlyArray<SearchableMessage>, query: string): string[] {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messageMatches(messages[i], query)) out.push(messages[i].id);
  }
  return out;
}
