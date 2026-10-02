/**
 * Word chips and corrections on chat messages (docs/CHAT.md PR 3) — the
 * stored shapes and how they are read back. A leaf module (no D1, no Claude)
 * so `services/conversations.ts` can shape messages with it.
 *
 * `messages.words` holds `{ source, words }`: the words of the message's
 * `content`, or of a voice message's transcript. They are served only while
 * they still concatenate to that text exactly (`parseReaderWords`), so an
 * edit never shows stale chips.
 */

import { parseReaderWords, type ReaderWord } from '@shared/reader/words';
import type { ChatAttachment, ChatCorrection } from '../../types';

export type WordsSource = 'content' | 'transcript';

export const HAN = /[㐀-鿿]/;

/** Longest text split into words (a reader page is ~130 characters; chat messages are short). */
export const WORDS_MAX_CHARS = 1500;

export const CORRECTION_TEXT_MAX = 2000;
export const CORRECTION_NOTE_MAX = 1000;

/**
 * Which text of a message gets word chips: a voice message's transcript (once
 * transcribed), else the content (a text message, a photo's caption). Null
 * when there is no Chinese in it.
 */
export function wordsTextOf(message: { content: string; attachment?: Pick<ChatAttachment, 'kind'> & { transcript?: string | null } | null }): { source: WordsSource; text: string } | null {
  if (message.attachment?.kind === 'voice') {
    const transcript = message.attachment.transcript ?? '';
    return transcript && HAN.test(transcript) ? { source: 'transcript', text: transcript } : null;
  }
  return message.content && HAN.test(message.content) ? { source: 'content', text: message.content } : null;
}

export function serializeWords(source: WordsSource, words: ReaderWord[]): string {
  return JSON.stringify({ source, words });
}

/**
 * `messages.words` → the words, if they still match the message's current
 * text. A bare array is read as words of the content.
 */
export function parseStoredWords(
  raw: string | null | undefined,
  message: { content: string; attachment?: { kind: string; transcript?: string | null } | null },
): { source: WordsSource; words: ReaderWord[] } | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  let source: WordsSource = 'content';
  let list: unknown = value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as { source?: unknown; words?: unknown };
    source = o.source === 'transcript' ? 'transcript' : 'content';
    list = o.words;
  }
  const text = source === 'transcript'
    ? (message.attachment?.kind === 'voice' ? message.attachment.transcript ?? '' : '')
    : message.content;
  if (!text) return null;
  const words = parseReaderWords(list, text);
  return words ? { source, words } : null;
}

export function parseCorrection(raw: string | null | undefined): ChatCorrection | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ChatCorrection>;
    if (!v || typeof v.text !== 'string' || !v.text) return null;
    return {
      text: v.text,
      note: typeof v.note === 'string' && v.note ? v.note : null,
      by: typeof v.by === 'string' ? v.by : '',
      at: typeof v.at === 'string' ? v.at : '',
    };
  } catch {
    return null;
  }
}
