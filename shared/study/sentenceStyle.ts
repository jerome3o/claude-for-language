/**
 * "Example sentence style" (Settings → Study, per account; docs/STUDY_SESSION.md "Example sentence style").
 *
 * Jerome (Nov 2026): "I might be learning a relatively formal form of Chinese through this method … a setting
 * where you can change the formality / neutralness of the generated sentences … a gentle suggestion that if there
 * is a relevant colloquial term, saying or usage, occasionally use it."
 *
 * Three registers for the sentence-set generator (worker/src/services/sentence-set.ts):
 *   standard — neutral, textbook-safe (the behaviour before this setting);
 *   everyday — how people actually talk, the occasional common colloquialism where it fits (THE DEFAULT);
 *   casual   — chatty spoken register most of the time.
 * `users.sentence_style` (migration 0155, NULL = everyday), `PUT /api/profile/sentence-style`, on `/api/auth/me` and
 * `/api/sync/changes`. Applies to sentences written from now on — existing sentences are never rewritten.
 * Lab port: core `SentenceStyle.kt` (parity-tested: the choices, labels, default and the parser).
 */

export type SentenceStyle = 'standard' | 'everyday' | 'casual';

export const SENTENCE_STYLES: readonly SentenceStyle[] = ['standard', 'everyday', 'casual'] as const;

/** NULL / unset = this. A gentle nudge towards spoken Chinese, still natural and graded. */
export const DEFAULT_SENTENCE_STYLE: SentenceStyle = 'everyday';

export function isSentenceStyle(value: unknown): value is SentenceStyle {
  return typeof value === 'string' && (SENTENCE_STYLES as readonly string[]).includes(value);
}

/** The style in effect for a stored value (NULL / unknown = the default). */
export function sentenceStyleOf(value: unknown): SentenceStyle {
  return isSentenceStyle(value) ? value : DEFAULT_SENTENCE_STYLE;
}

/** `PUT /api/profile/sentence-style { sentence_style }` — null = back to the default. */
export function pickSentenceStyleUpdate(body: unknown): { value: SentenceStyle | null; problems: string[] } {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).sentence_style : undefined;
  if (raw === null) return { value: null, problems: [] };
  if (raw === undefined) return { value: null, problems: ['sentence_style is required (standard, everyday or casual — or null for the default)'] };
  if (!isSentenceStyle(raw)) return { value: null, problems: ['sentence_style must be standard, everyday or casual'] };
  return { value: raw, problems: [] };
}

/** The Settings words: a name and one line each. */
export const SENTENCE_STYLE_COPY: Record<SentenceStyle, { label: string; description: string }> = {
  standard: {
    label: 'Standard',
    description: 'Neutral, textbook-safe Chinese.',
  },
  everyday: {
    label: 'Everyday',
    description: 'How people actually talk — now and then a common spoken word, particle or saying.',
  },
  casual: {
    label: 'Casual',
    description: 'Chatty, spoken Chinese most of the time — more colloquial words and everyday sayings.',
  },
};

/** The note under the choices: what the setting changes and what it doesn't. */
export const SENTENCE_STYLE_NOTE = 'Applies to new example sentences — the ones you already have stay as they are.';

/**
 * The instruction the sentence-set generator adds for the style (per learner: it goes in the USER message, never
 * in the shared system prompt). Exported for the worker and its tests; not ported (the Lab app never writes it).
 */
export function sentenceStylePrompt(style: SentenceStyle): string {
  switch (style) {
    case 'standard':
      return [
        'REGISTER: standard.',
        '- Neutral, standard Mandarin that is safe in any situation — the register of a good textbook, but still the way people really say it.',
        '- No slang and no strongly colloquial words or particles.',
      ].join('\n');
    case 'everyday':
      return [
        'REGISTER: everyday spoken Chinese.',
        '- Write the sentences the way people actually talk in daily life (to friends, family, in a shop, in a text message), not the way a textbook writes.',
        '- Where a relevant high-frequency colloquial word, spoken construction, sentence-final particle (吧, 呗, 啦, 嘛 …) or common saying fits naturally, occasionally use one — perhaps one or two sentences in the set. Never force one in.',
        '- When a sentence uses one, say so briefly in focus_note (e.g. "挺 = quite, very common in speech") and keep the English translation equally natural and informal.',
        '- Vary the situations and who is speaking (friends, family, a shop, work, a text message) so the set shows the word in different everyday conversations.',
        '- Nothing vulgar, no internet slang that dates fast, and no regional dialect words unless they are widely understood in standard Mandarin.',
      ].join('\n');
    case 'casual':
      return [
        'REGISTER: casual, chatty spoken Chinese.',
        '- Most sentences should sound like relaxed conversation between friends or family, or a casual text message: spoken word choices (挺, 特别, 有点儿, 好像, 干嘛, 怎么了, 没事儿 …), sentence-final particles (吧, 呗, 啦, 嘛, 呢, 哈) and short everyday sayings or set phrases where they fit.',
        '- Use the high-frequency colloquial words and spoken constructions that help a learner understand people talking; prefer them over formal equivalents (e.g. 挺好的 rather than 十分好).',
        '- When a sentence uses a colloquial word or saying, explain it briefly in focus_note; keep the English translation equally casual.',
        '- Vary the situations and speakers (friends, family, roommates, a shop, a group chat).',
        '- Still natural Mandarin a native speaker would say anywhere in China: nothing vulgar, no fleeting internet slang, no obscure regional dialect words. Keep the sentences short and simple.',
      ].join('\n');
  }
}
