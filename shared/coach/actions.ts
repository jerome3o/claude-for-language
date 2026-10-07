/**
 * Sentence Coach: which action buttons the home screen offers for what is in
 * the box, and which action the server runs for a request.
 *
 * - Chinese (any Han character) → TWO buttons: "Check my sentence" (I wrote
 *   this — grade / correct it) and "Explain" (a translation plus the
 *   word-by-word breakdown, used instead of Google Translate).
 * - Mixed Chinese + English → the same two buttons (the Chinese is what gets
 *   checked or explained).
 * - English only → ONE button, "Translate" (how do I say this in Chinese?).
 * - Empty → the two Chinese buttons, disabled: the widget's ✏️ and the study
 *   card's ⋯ → Sentence coach land here without sending anything.
 *
 * Shared by the web page, the worker (request validation) and the native Lab
 * app (ported in core/CoachActions.kt, parity-tested against this file).
 */

export type CoachAction = 'check' | 'explain' | 'translate';

export type CoachInputKind = 'empty' | 'chinese' | 'mixed' | 'english';

export interface CoachButtons {
  kind: CoachInputKind;
  /** Buttons in order; the first is the primary one. */
  actions: CoachAction[];
  /** False only for an empty box. */
  enabled: boolean;
  /** The one-line hint under the box (null when empty). */
  hint: string | null;
}

/** Any Han character (CJK Unified Ideographs, Extension A, compatibility ideographs). */
export function hasHan(text: string): boolean {
  return /[㐀-䶿一-鿿豈-﫿]/.test(text);
}

/** Latin letters (ASCII or full-width) — English words mixed into the Chinese. */
export function hasLatinLetters(text: string): boolean {
  return /[A-Za-zＡ-Ｚａ-ｚ]/.test(text);
}

export function coachInputKind(text: string): CoachInputKind {
  const t = text.trim();
  if (!t) return 'empty';
  if (!hasHan(t)) return 'english';
  return hasLatinLetters(t) ? 'mixed' : 'chinese';
}

export const COACH_ACTION_LABELS: Record<CoachAction, string> = {
  check: 'Check my sentence',
  explain: 'Explain',
  translate: 'Translate',
};

/** What each action's button says while it runs. */
export const COACH_ACTION_BUSY: Record<CoachAction, string> = {
  check: 'Checking…',
  explain: 'Explaining…',
  translate: 'Translating…',
};

export function coachButtons(text: string): CoachButtons {
  const kind = coachInputKind(text);
  switch (kind) {
    case 'empty':
      return { kind, actions: ['check', 'explain'], enabled: false, hint: null };
    case 'english':
      return {
        kind,
        actions: ['translate'],
        enabled: true,
        hint: "🇬🇧 English — I'll show you how to say it in Chinese",
      };
    case 'mixed':
      return {
        kind,
        actions: ['check', 'explain'],
        enabled: true,
        hint: '🇨🇳 Chinese with some English — check it if you wrote it, or explain it word by word',
      };
    default:
      return {
        kind,
        actions: ['check', 'explain'],
        enabled: true,
        hint: '🇨🇳 Chinese — check it if you wrote it, or explain it word by word',
      };
  }
}

/**
 * The action the server runs. No `requested` action (an older client) keeps
 * the old auto-detection: Chinese → check, English → translate. Check and
 * Explain need Chinese to work on; anything else is a 400 with this reason.
 */
export function resolveCoachAction(
  text: string,
  requested: unknown,
): { ok: true; action: CoachAction } | { ok: false; error: string } {
  const chinese = hasHan(text);
  if (requested === undefined || requested === null || requested === '') {
    return { ok: true, action: chinese ? 'check' : 'translate' };
  }
  if (requested !== 'check' && requested !== 'explain' && requested !== 'translate') {
    return { ok: false, error: 'action must be check, explain or translate' };
  }
  if ((requested === 'check' || requested === 'explain') && !chinese) {
    return { ok: false, error: 'There is no Chinese to check or explain — use Translate for English' };
  }
  return { ok: true, action: requested };
}

/**
 * A deep link `/coach?text=…[&action=…]`: which action runs AT ONCE, or null
 * (the text waits in the box on its buttons). An explicit valid action runs
 * ("Open in Coach" from a chat message sends action=check / explain); without
 * one, only English runs (translate — its only button); Chinese waits, since
 * only the learner knows whether to check or explain it.
 */
export function coachDeepLinkAction(text: string, action: unknown): CoachAction | null {
  if (!text.trim()) return null;
  if (action !== undefined && action !== null && action !== '') {
    const resolved = resolveCoachAction(text.trim(), action);
    return resolved.ok ? resolved.action : null;
  }
  const buttons = coachButtons(text);
  return buttons.enabled && buttons.actions.length === 1 ? buttons.actions[0] : null;
}

/** A conversation's action; rows from before actions were recorded fall back to their language. */
export function conversationAction(conv: { action?: string | null; input_language?: string | null }): CoachAction {
  if (conv.action === 'check' || conv.action === 'explain' || conv.action === 'translate') return conv.action;
  return conv.input_language === 'en' ? 'translate' : 'check';
}

/**
 * "+ Add whole sentence as card" from an Explain result: the sentence, its
 * pinyin and translation, and fun_facts to the card standard for a sentence —
 * every word in order as 汉字 (pīnyīn) meaning, then the construction.
 */
export function breakdownSentenceCard(b: {
  hanzi: string;
  pinyin: string;
  translation?: string | null;
  words: Array<{ hanzi: string; pinyin: string; gloss: string }>;
  construction?: string | null;
}): { hanzi: string; pinyin: string; english: string; fun_facts?: string } {
  const lines = b.words
    .filter((w) => w.hanzi.trim())
    .map((w) => {
      const py = w.pinyin.trim() ? ` (${w.pinyin.trim()})` : '';
      const gloss = w.gloss.trim() ? ` ${w.gloss.trim()}` : '';
      return `${w.hanzi.trim()}${py}${gloss}`;
    });
  const construction = (b.construction ?? '').trim();
  if (construction) lines.push(construction);
  const funFacts = lines.join('\n');
  return {
    hanzi: b.hanzi.trim(),
    pinyin: b.pinyin.trim(),
    english: (b.translation ?? '').trim(),
    ...(funFacts ? { fun_facts: funFacts } : {}),
  };
}

/** The icon a conversation shows in the Recent list. */
export const COACH_ACTION_ICONS: Record<CoachAction, string> = {
  check: '✏️',
  explain: '🔍',
  translate: '🇬🇧',
};
