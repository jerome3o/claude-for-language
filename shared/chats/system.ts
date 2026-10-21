/**
 * System messages (docs/CHAT.md "System messages"): lines the PLATFORM posts into
 * a chat on someone's behalf — the tutor changed the daily new cards, a video
 * call started, a card was flagged / a flag answered, the install how-to, a
 * group-class link. The person stays the sender (permissions, threads, unread),
 * but the row is drawn from `messages.system_kind` + `system_data`, in the third
 * person and from the VIEWER's side: the student reads "Minghui set your new
 * cards to 2 a day (+5 extra) 📚", the tutor herself "You set Jerome's new cards
 * to 2 a day (+5 extra)". A centred, muted row like the day pills — never a
 * bubble (no ticks, reactions, listening-mode hiding, read-aloud or auto-check).
 *
 * `content` still holds a readable fallback (the recipient's view, third person)
 * so older apps, e-mails and notifications read well; an app that doesn't know a
 * kind shows that fallback as a plain system row.
 *
 * Pure. Lab port: core `chat/SystemMessages.kt`, parity-tested
 * (android-lab/parity/fixtures/chat-system.ts).
 */

export const SYSTEM_KINDS = ['study_budget', 'call_started', 'card_flag', 'flag_reply', 'install_howto', 'group_class'] as const;
export type SystemKind = (typeof SYSTEM_KINDS)[number];

/** `system_data` of each kind (JSON in `messages.system_data`). */
export interface StudyBudgetData {
  new_cards_per_day: number;
  secondary_cards_per_day: number;
  /** Back to the default numbers. */
  is_default?: boolean;
}
export interface CallStartedData {
  call_id: string;
  /** The call is over (set when it ends). */
  ended?: boolean;
  /** It ended and the other person never joined. */
  missed?: boolean;
}
export interface CardFlagData {
  flag_id?: string | null;
  note_id?: string | null;
  hanzi: string;
  pinyin?: string | null;
  english?: string | null;
  /** The student's own words (quoted, never rewritten). */
  message: string;
}
export interface FlagReplyData {
  flag_id?: string | null;
  note_id?: string | null;
  hanzi: string;
  /** The tutor's own words (quoted). */
  reply: string;
}
export interface InstallHowtoData {
  app_url?: string | null;
}
export interface GroupClassData {
  session_id?: string | null;
  group_name: string;
}

export interface SystemContext {
  /** The viewer posted it (the person the platform spoke for). */
  viewerIsSender: boolean;
  /** The OTHER person in the chat: the sender when the viewer received it, the recipient when the viewer sent it. */
  otherName: string | null | undefined;
  /** The chat's tutor relationship (the tutor's card links need it). */
  relationshipId?: string | null;
}

export interface SystemAction {
  label: string;
  /** An app path (the web route; the Lab app navigates by the same paths). */
  path: string;
}

export interface SystemMessageView {
  kind: SystemKind | 'unknown';
  icon: string;
  /** The line itself, third person, from the viewer's side. */
  text: string;
  /** Someone's own words, shown as a quote under the line (never rewritten). */
  quote: string | null;
  /** Longer text under the line (the install steps), else null. */
  body: string | null;
  action: SystemAction | null;
  /** Drawn quieter (an ended call). */
  quiet: boolean;
}

export interface SystemMessageLike {
  content?: string | null;
  system_kind?: string | null;
  /** Parsed JSON (the API sends an object) or the raw stored string. */
  system_data?: unknown;
}

export function isSystemMessage(msg: Pick<SystemMessageLike, 'system_kind'> | null | undefined): boolean {
  return !!msg && typeof msg.system_kind === 'string' && msg.system_kind.trim() !== '';
}

export function isKnownSystemKind(kind: string | null | undefined): kind is SystemKind {
  return !!kind && (SYSTEM_KINDS as readonly string[]).includes(kind);
}

/** First word of a name ("Minghui Wang" → "Minghui"), else the fallback. */
export function systemFirstName(name: string | null | undefined, fallback: string): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first || fallback;
}

/** "Jerome's" / "your student's". */
function possessive(name: string): string {
  return `${name}'s`;
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function record(data: unknown): Record<string, unknown> {
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

/** "5 a day (+10 extra)" / "5 a day (no extra cards)". */
function budgetNumbers(d: Record<string, unknown>): string {
  const secondary = count(d.secondary_cards_per_day);
  const extra = secondary > 0 ? ` (+${secondary} extra)` : ' (no extra cards)';
  return `${count(d.new_cards_per_day)} a day${extra}`;
}

/** The install how-to's steps (the old message's body, minus the greeting). */
export function installHowToSteps(appUrl: string | null | undefined): string {
  const url = (appUrl ?? '').trim() || 'the app’s address';
  return (
    `Android app (recommended):\n` +
    `1. Install Obtainium from the Play Store or https://github.com/ImranR98/Obtainium\n` +
    `2. In Obtainium tap "Add App" and paste https://github.com/jerome3o/claude-for-language\n` +
    `3. Install the app it finds, open it and sign in with Google once.\n\n` +
    `Or add a home-screen shortcut: open ${url} in Chrome, tap the ⋮ menu → "Add to Home screen" / "Install app".\n\n` +
    `Once it is installed, open it while you have internet so your words and audio download. After that it works without a connection.`
  );
}

/** Where a card link goes: the tutor's view of the student's card, or the student's own card hub. */
function cardPath(noteId: string, tutorSide: boolean, relationshipId: string | null | undefined): string | null {
  if (!noteId) return null;
  if (!tutorSide) return `/cards/${encodeURIComponent(noteId)}`;
  const rel = (relationshipId ?? '').trim();
  return rel ? `/connections/${encodeURIComponent(rel)}/cards/${encodeURIComponent(noteId)}` : null;
}

/**
 * How a system message reads for this viewer, or null for an ordinary message.
 * An unknown kind (a newer server) shows the stored fallback text.
 */
export function systemMessageView(msg: SystemMessageLike, ctx: SystemContext): SystemMessageView | null {
  if (!isSystemMessage(msg)) return null;
  const kind = (msg.system_kind ?? '').trim();
  const d = record(msg.system_data);
  const me = ctx.viewerIsSender;
  const view = (icon: string, text: string, extra: Partial<SystemMessageView> = {}): SystemMessageView => ({
    kind: kind as SystemKind,
    icon,
    text,
    quote: null,
    body: null,
    action: null,
    quiet: false,
    ...extra,
  });
  const fallback = (): SystemMessageView => ({
    kind: 'unknown',
    icon: 'ℹ️',
    text: (msg.content ?? '').trim(),
    quote: null,
    body: null,
    action: null,
    quiet: false,
  });

  switch (kind) {
    case 'study_budget': {
      if (typeof d.new_cards_per_day !== 'number') return fallback();
      const to = d.is_default === true ? 'back to the usual ' : 'to ';
      const nums = budgetNumbers(d);
      return me
        ? view('📚', `You set ${possessive(systemFirstName(ctx.otherName, 'your student'))} new cards ${to}${nums}`)
        : view('📚', `${capitalise(systemFirstName(ctx.otherName, 'your tutor'))} set your new cards ${to}${nums}`);
    }
    case 'call_started': {
      const callId = str(d.call_id);
      const who = systemFirstName(ctx.otherName, 'someone');
      if (d.ended === true) {
        if (d.missed === true) {
          return me
            ? view('📹', `Video call · ${capitalise(who)} didn't join`, { quiet: true })
            : view('📹', `Missed video call from ${who}`, { quiet: true });
        }
        return view('📹', 'Video call ended', { quiet: true });
      }
      const action = callId ? { label: 'Join', path: `/calls/${encodeURIComponent(callId)}` } : null;
      return me ? view('📹', 'You started a video call', { action }) : view('📹', `${capitalise(who)} started a video call`, { action });
    }
    case 'card_flag': {
      const hanzi = str(d.hanzi);
      if (!hanzi) return fallback();
      const quote = str(d.message) || null;
      // The student flags; the tutor opens the student's card from her side.
      const path = cardPath(str(d.note_id), !me, ctx.relationshipId);
      const action = path ? { label: 'Open card', path } : null;
      return me
        ? view('🚩', `You flagged ${hanzi} for ${systemFirstName(ctx.otherName, 'your tutor')}`, { quote, action })
        : view('🚩', `${capitalise(systemFirstName(ctx.otherName, 'your student'))} flagged ${hanzi} for you`, { quote, action });
    }
    case 'flag_reply': {
      const hanzi = str(d.hanzi);
      if (!hanzi) return fallback();
      const quote = str(d.reply) || null;
      // The tutor replies; the student opens their own card.
      const path = cardPath(str(d.note_id), me, ctx.relationshipId);
      const action = path ? { label: 'Open card', path } : null;
      return me
        ? view('🚩', `You replied about ${hanzi}`, { quote, action })
        : view('🚩', `${capitalise(systemFirstName(ctx.otherName, 'your tutor'))} replied about ${hanzi}`, { quote, action });
    }
    case 'install_howto': {
      const body = installHowToSteps(str(d.app_url) || null);
      return me
        ? view('📲', `You sent ${systemFirstName(ctx.otherName, 'your student')} how to install the app`, { body })
        : view('📲', `${capitalise(systemFirstName(ctx.otherName, 'your tutor'))} sent you how to install the app`, { body });
    }
    case 'group_class': {
      const name = str(d.group_name);
      if (!name) return fallback();
      const session = str(d.session_id);
      const action = !me && session ? { label: 'Join', path: `/group-class/${encodeURIComponent(session)}` } : null;
      const body = 'An experimental group class: your tutor and a few other students on one video call.';
      return me
        ? view('🧪', `You sent ${systemFirstName(ctx.otherName, 'your student')} the link to the group class “${name}”`)
        : view('🧪', `${capitalise(systemFirstName(ctx.otherName, 'your tutor'))} started the group class “${name}”`, { action, body });
    }
    default:
      return fallback();
  }
}

/** One line: icon + text (+ “quote”). For Copy, the inbox, notifications. */
export function systemViewText(view: SystemMessageView): string {
  const line = view.icon && view.kind !== 'unknown' ? `${view.icon} ${view.text}` : view.text;
  return view.quote ? `${line}: “${view.quote}”` : line;
}

/** The one-line text of a system message for this viewer ('' for an ordinary message). */
export function systemMessageText(msg: SystemMessageLike, ctx: SystemContext): string {
  const view = systemMessageView(msg, ctx);
  return view ? systemViewText(view) : '';
}

/**
 * What the server stores in `content`: the RECIPIENT's view, third person, plus
 * what an older app needs to act on it (the join link, the install steps).
 */
export function systemFallbackContent(
  kind: SystemKind,
  data: unknown,
  senderName: string | null | undefined,
  opts: { url?: string | null } = {},
): string {
  const view = systemMessageView({ system_kind: kind, system_data: data, content: '' }, { viewerIsSender: false, otherName: senderName });
  if (!view) return '';
  let text = systemViewText(view);
  const url = (opts.url ?? '').trim();
  if (url && (kind === 'call_started' || kind === 'group_class')) text += ` — join here: ${url}`;
  if (view.body) text += `\n\n${view.body}`;
  return text;
}
