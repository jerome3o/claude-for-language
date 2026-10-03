/**
 * "Check my Chinese automatically" (docs/CHAT.md "Auto-check"): when a learner
 * sends a text message with Chinese, the server checks it in the background and
 * stores the result on the message (`messages.auto_check`). The sender's bubble
 * then carries a calm ✎ mark when it could be better, and the long-press menu
 * starts with "✨ How to say it better".
 *
 * Pure rules shared by the worker (who is checked, what is skipped, how the
 * stored JSON is read back) and both apps (the indicator state). The Lab app's
 * `core/…/SayBetter.kt` ports the client half, parity-tested.
 */

export type AutoCheckStatus = 'ok' | 'improvable';
export type AutoCheckSeverity = 'minor' | 'moderate' | 'major';

/** A card the sheet can hand to the add-card sheet as it is (CARD_STANDARD fields). */
export interface AutoCheckCard {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts: string;
}

export interface AutoCheckMistake {
  /** The short span of what was written ("" when something is missing). */
  quote: string;
  /** What it should be. */
  fix: string;
  /** One line: why. */
  why: string;
  /** A card for the word / pattern fix, when one is worth having. */
  card: AutoCheckCard | null;
}

export interface AutoCheckAlternative {
  hanzi: string;
  pinyin: string;
  english: string;
  note: string | null;
}

export interface AutoCheckResult {
  /** The exact text that was checked — the result is served only while the message still says this. */
  text: string;
  status: AutoCheckStatus;
  /** The corrected sentence (= text when ok). */
  corrected: string;
  corrected_pinyin: string;
  corrected_english: string;
  mistakes: AutoCheckMistake[];
  /** A more natural way to say it, if any. */
  alternative: AutoCheckAlternative | null;
  severity: AutoCheckSeverity | null;
  /** The corrected sentence as a card. */
  card: AutoCheckCard | null;
  checked_at: string;
}

const HAN = /[㐀-鿿豈-﫿]/g;
const LATIN_WORD = /[A-Za-z]+/g;

export type AutoCheckSkip = 'no_chinese' | 'too_short' | 'mostly_english' | 'too_long';

/** Longest message checked (a chat message, not an essay). */
export const AUTO_CHECK_MAX_CHARS = 400;

/**
 * Why a message is not checked, or null when it is: no Chinese (English,
 * emoji only), ≤ 2 characters of content, more English words than Chinese
 * characters, or very long.
 */
export function autoCheckSkipReason(text: string): AutoCheckSkip | null {
  const t = (text || '').trim();
  const han = t.match(HAN)?.length ?? 0;
  if (han === 0) return 'no_chinese';
  // Content characters: Han, letters and digits (punctuation, spaces and emoji don't count).
  const content = t.replace(/[^\p{L}\p{N}]/gu, '');
  if ([...content].length <= 2) return 'too_short';
  const latinWords = t.match(LATIN_WORD)?.length ?? 0;
  if (latinWords > han) return 'mostly_english';
  if (t.length > AUTO_CHECK_MAX_CHARS) return 'too_long';
  return null;
}

/**
 * Is this sender's message checked? `setting` is `users.chat_auto_check`
 * (null = the default). The default is on for the learner: the student side of
 * a tutor relationship, or the person in a Claude practice chat. On = always,
 * off = never.
 */
export function autoCheckApplies(setting: boolean | null | undefined, senderRole: 'tutor' | 'student' | null, isAiConversation: boolean): boolean {
  if (setting === true) return true;
  if (setting === false) return false;
  return isAiConversation || senderRole === 'student';
}

/** What Settings shows for the switch: the stored choice, else on unless it is a tutor account. */
export function autoCheckSettingShown(setting: boolean | null | undefined, accountRole: string | null | undefined): boolean {
  if (typeof setting === 'boolean') return setting;
  return accountRole !== 'tutor';
}

/** The indicator / sheet state of one message, as its sender sees it. The tutor's correction wins. */
export type SayBetterState = 'corrected' | 'improvable' | null;

export function sayBetterState(
  msg: {
    sender_id: string;
    content: string;
    deleted_at?: string | null;
    attachment?: unknown;
    correction?: { text: string } | null;
    auto_check?: Pick<AutoCheckResult, 'status' | 'text'> | null;
  },
  viewerId: string,
): SayBetterState {
  if (msg.deleted_at || msg.sender_id !== viewerId || msg.attachment) return null;
  if (msg.correction && msg.correction.text) return 'corrected';
  if (msg.auto_check && msg.auto_check.status === 'improvable' && msg.auto_check.text === msg.content) return 'improvable';
  return null;
}

/** The accessible label of the ✎ mark. */
export function sayBetterLabel(state: SayBetterState, tutorName?: string | null): string {
  if (state === 'corrected') return `${(tutorName || 'Your tutor').split(' ')[0]} corrected this — hold to see`;
  if (state === 'improvable') return 'Could be better — hold to see';
  return '';
}

// ---------- Reading the stored JSON (worker) ----------

const s = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function readCard(v: unknown): AutoCheckCard | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const card = { hanzi: s(o.hanzi, 200), pinyin: s(o.pinyin, 400), english: s(o.english, 300), fun_facts: s(o.fun_facts, 1500) };
  return card.hanzi && card.pinyin && card.english ? card : null;
}

/**
 * `messages.auto_check` → the result, only while it is about the message's
 * current text (an edit makes it stale). Null for anything unreadable.
 */
export function parseAutoCheck(raw: string | null | undefined, content: string): AutoCheckResult | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.text !== 'string' || o.text !== content) return null;
  if (o.status !== 'ok' && o.status !== 'improvable') return null;
  const mistakes = (Array.isArray(o.mistakes) ? o.mistakes : [])
    .map((m) => {
      const r = (m ?? {}) as Record<string, unknown>;
      return { quote: s(r.quote, 200), fix: s(r.fix, 200), why: s(r.why, 400), card: readCard(r.card) };
    })
    .filter((m) => m.fix || m.quote);
  const alt = o.alternative && typeof o.alternative === 'object' ? (o.alternative as Record<string, unknown>) : null;
  const alternative = alt && s(alt.hanzi) ? { hanzi: s(alt.hanzi, 400), pinyin: s(alt.pinyin), english: s(alt.english), note: s(alt.note, 400) || null } : null;
  const severity = o.severity === 'minor' || o.severity === 'moderate' || o.severity === 'major' ? o.severity : null;
  return {
    text: o.text,
    status: o.status,
    corrected: s(o.corrected, 800) || o.text,
    corrected_pinyin: s(o.corrected_pinyin, 1200),
    corrected_english: s(o.corrected_english, 800),
    mistakes,
    alternative,
    severity,
    card: readCard(o.card),
    checked_at: s(o.checked_at, 40),
  };
}
