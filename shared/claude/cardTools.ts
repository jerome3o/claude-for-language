/**
 * Claude's card tools in a card thread (Ask Claude on a study card; docs/STUDY_SESSION.md "Ask
 * Claude"). The server applies them when the reply finishes (services/claude-agent/apply.ts) and
 * keeps the results on the reply (`tool_results`, JSON); the app then brings its own copy of the
 * study state in line ONCE per reply (`cardToolEffects`) and draws one line per result under the
 * reply (`cardToolLines`) — "✓ Claude edited this card · Undo" instead of the old Approve / Reject,
 * which only ever decided whether the device heard about a change the server had already made.
 * Undo puts back the fields the edit changed (`undoEditFields`, a normal note update).
 *
 * Pure. Web: components/claude/CardClaudeSheet.tsx; Lab port core `claude/CardTools.kt`
 * (parity-tested by android-lab/parity/fixtures/claude-card-tools.ts).
 */

export interface CardToolResult {
  tool: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/** The note fields Claude's edit_current_card may change, in the order the line lists them. */
export const CARD_EDIT_FIELDS = ['hanzi', 'pinyin', 'english', 'fun_facts', 'sentence_clue', 'sentence_clue_pinyin', 'sentence_clue_translation'] as const;
export type CardEditField = (typeof CARD_EDIT_FIELDS)[number];

/** How a changed field reads in the line ("✓ Claude edited this card · notes, example sentence"). */
const FIELD_LABELS: Record<CardEditField, string> = {
  hanzi: 'characters',
  pinyin: 'pinyin',
  english: 'meaning',
  fun_facts: 'notes',
  sentence_clue: 'example sentence',
  sentence_clue_pinyin: 'example sentence',
  sentence_clue_translation: 'example sentence',
};

/** The note as the edit left it (the server's row; only the fields the device keeps). */
export type EditedNote = Partial<Record<CardEditField | 'sentence_clue_audio_url' | 'audio_url' | 'updated_at', string | null>>;

/** `tool_results` as stored on the reply; anything unreadable → []. */
export function parseCardToolResults(raw: string | null | undefined): CardToolResult[] {
  if (!raw) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: CardToolResult[] = [];
  for (const r of v) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.tool !== 'string') continue;
    out.push({
      tool: o.tool,
      success: o.success === true,
      ...(o.data && typeof o.data === 'object' && !Array.isArray(o.data) ? { data: o.data as Record<string, unknown> } : {}),
      ...(typeof o.error === 'string' ? { error: o.error } : {}),
    });
  }
  return out;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
}

/** The hanzi of the cards create_flashcards made (`data.created[].hanzi`, else `data.notes[].hanzi`). */
function createdHanzi(data: Record<string, unknown> | undefined): string[] {
  const created = Array.isArray(data?.created) ? data?.created : data?.notes;
  if (!Array.isArray(created)) return [];
  return created.map((c) => (c && typeof c === 'object' ? str((c as Record<string, unknown>).hanzi) : null)).filter((h): h is string => !!h);
}

function createdCount(data: Record<string, unknown> | undefined): number {
  const n = data?.count;
  if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return Math.floor(n);
  return createdHanzi(data).length;
}

/**
 * A card create_flashcards made, as the tappable word under the reply ("✓ Added 2 cards" · 机会 ›
 * 难得 ›): a tap opens the language explorer on it, where "⚡ Study it today" / Open card are
 * (docs/CHAT.md "Claude thread view" → "Cards Claude added").
 */
export interface AddedCard {
  note_id: string;
  hanzi: string;
  pinyin: string | null;
  english: string | null;
  deck_id: string | null;
  deck_name: string | null;
}

/**
 * The cards ONE create_flashcards result made, in order, each once: `data.created` (a card thread —
 * the server's note rows, services/claude-agent/apply.ts) or `data.notes` (every other Claude chat
 * and the Coach — services/coach-replies.ts). Entries without an id or hanzi are left out, so an old
 * row carrying only a count gives [] (its plain line stays as it was).
 */
export function addedCards(data: Record<string, unknown> | undefined): AddedCard[] {
  const list = Array.isArray(data?.created) ? data!.created : Array.isArray(data?.notes) ? data!.notes : [];
  const deckId = str(data?.deck_id) ?? str(data?.targetDeckId);
  const deckName = str(data?.deck_name);
  const out: AddedCard[] = [];
  const seen = new Set<string>();
  for (const c of list as unknown[]) {
    if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    const id = str(o.id)?.trim();
    const hanzi = str(o.hanzi)?.trim();
    if (!id || !hanzi || seen.has(id)) continue;
    seen.add(id);
    out.push({ note_id: id, hanzi, pinyin: str(o.pinyin)?.trim() || null, english: str(o.english)?.trim() || null, deck_id: deckId, deck_name: deckName });
  }
  return out;
}

/** "✓ Added 2 cards" — the added line's start when its words follow as chips. */
export function addedCardsHead(n: number): string {
  return `✓ Added ${n} card${n === 1 ? '' : 's'}`;
}

/** The fields the edit asked for (`data.changes`), in CARD_EDIT_FIELDS order. */
export function editedFields(data: Record<string, unknown> | undefined): CardEditField[] {
  const changes = data?.changes;
  if (!changes || typeof changes !== 'object') return [];
  const c = changes as Record<string, unknown>;
  return CARD_EDIT_FIELDS.filter((f) => typeof c[f] === 'string');
}

/** What the device does about one reply's results. */
export interface CardToolEffects {
  /** The note as edit_current_card left it (the last edit wins), or null. */
  edited: EditedNote | null;
  /** delete_current_card ran: the card leaves the session. */
  deleted: boolean;
  /** Cards made in a deck (the device syncs to have them). */
  cardsAdded: number;
  /** Mini lessons made (the device pulls them). */
  lessons: number;
  /** Words put first in today's study (the device refreshes its pocket). */
  bumped: string[];
}

export function cardToolEffects(results: readonly CardToolResult[]): CardToolEffects {
  const out: CardToolEffects = { edited: null, deleted: false, cardsAdded: 0, lessons: 0, bumped: [] };
  for (const r of results) {
    if (!r.success) continue;
    switch (r.tool) {
      case 'edit_current_card': {
        const note = r.data?.note;
        if (note && typeof note === 'object') {
          const n = note as Record<string, unknown>;
          const edited: EditedNote = {};
          for (const k of [...CARD_EDIT_FIELDS, 'sentence_clue_audio_url', 'audio_url', 'updated_at'] as const) {
            if (k in n && (typeof n[k] === 'string' || n[k] === null)) edited[k] = n[k] as string | null;
          }
          out.edited = edited;
        }
        break;
      }
      case 'delete_current_card':
        out.deleted = true;
        break;
      case 'create_flashcards':
        out.cardsAdded += createdCount(r.data);
        break;
      case 'create_custom_lesson':
        out.lessons += 1;
        break;
      case 'bump_cards':
        for (const h of strings(r.data?.bumped)) if (!out.bumped.includes(h)) out.bumped.push(h);
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * One line under the reply. `undo` = the line offers Undo (an edit). An `added` line also carries
 * the cards with their note ids (`cards`, [] for an old row) and `head` ("✓ Added 2 cards"): the
 * apps show `head` + one tappable chip per card when there are cards, else `text`.
 */
export interface CardToolLine {
  kind: 'edited' | 'added' | 'deleted' | 'lesson' | 'bumped' | 'failed';
  text: string;
  undo: boolean;
  head?: string;
  cards?: AddedCard[];
}

const FAILED_LABELS: Record<string, string> = {
  edit_current_card: 'Couldn’t edit this card',
  delete_current_card: 'Couldn’t delete this card',
  create_flashcards: 'Couldn’t add the cards',
  create_custom_lesson: 'Couldn’t make the mini lesson',
  bump_cards: 'Couldn’t bump those words',
};

/** The lines under a reply, one per result (tools the app doesn't show are left out). */
export function cardToolLines(results: readonly CardToolResult[]): CardToolLine[] {
  const lines: CardToolLine[] = [];
  for (const r of results) {
    if (!r.success) {
      const label = FAILED_LABELS[r.tool];
      if (label) lines.push({ kind: 'failed', text: `✗ ${label}${r.error ? `: ${r.error}` : ''}`, undo: false });
      continue;
    }
    switch (r.tool) {
      case 'edit_current_card': {
        const fields = [...new Set(editedFields(r.data).map((f) => FIELD_LABELS[f]))];
        lines.push({ kind: 'edited', text: `✓ Claude edited this card${fields.length ? ` · ${fields.join(', ')}` : ''}`, undo: true });
        break;
      }
      case 'delete_current_card':
        lines.push({ kind: 'deleted', text: '🗑 Claude deleted this card', undo: false });
        break;
      case 'create_flashcards': {
        const n = createdCount(r.data);
        const hanzi = createdHanzi(r.data);
        lines.push({ kind: 'added', text: `${addedCardsHead(n)}${hanzi.length ? `: ${hanzi.join('、')}` : ''}`, undo: false, head: addedCardsHead(n), cards: addedCards(r.data) });
        break;
      }
      case 'create_custom_lesson': {
        const title = str(r.data?.title)?.trim();
        lines.push({ kind: 'lesson', text: `🎓 Mini lesson made${title ? `: ${title}` : ''} — it’s on your Mini Lessons page`, undo: false });
        break;
      }
      case 'bump_cards': {
        const bumped = strings(r.data?.bumped);
        const already = strings(r.data?.already_bumped);
        if (bumped.length) lines.push({ kind: 'bumped', text: `⚡ Study it today: ${bumped.join('、')}`, undo: false });
        else if (already.length) lines.push({ kind: 'bumped', text: `⚡ Already in today’s study: ${already.join('、')}`, undo: false });
        break;
      }
      default:
        break;
    }
  }
  return lines;
}

/**
 * Undo an edit: the fields the edit changed, back to what the card said before it (`before` = the
 * note as the device had it when the reply came). Fields the edit left alone, or that already say
 * the old value, are left out; an old empty field comes back as ''.
 */
export function undoEditFields(before: Partial<Record<CardEditField, string | null | undefined>>, edited: EditedNote): Partial<Record<CardEditField, string>> {
  const out: Partial<Record<CardEditField, string>> = {};
  for (const f of CARD_EDIT_FIELDS) {
    if (!(f in edited)) continue;
    const was = before[f] ?? '';
    const now = edited[f] ?? '';
    if (was !== now) out[f] = was;
  }
  return out;
}

// ---------- The sheet's "Earlier about 银行" ----------

/** A card's other threads, newest activity first (the sheet's list). */
export function earlierCardThreads<T extends { id: string; context_kind: string; context: { kind: string; note_id?: string }; last_message_at: string | null; created_at: string; archived?: boolean }>(
  threads: readonly T[],
  noteId: string,
  currentId: string | null,
): T[] {
  const at = (t: T) => {
    const v = Date.parse(t.last_message_at ?? t.created_at);
    return Number.isNaN(v) ? 0 : v;
  };
  return threads
    .filter((t) => t.context_kind === 'card' && t.context.kind === 'card' && t.context.note_id === noteId && !t.archived && t.id !== currentId)
    .sort((a, b) => at(b) - at(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** "Earlier about 银行 · 2 chats" (null with none). */
export function earlierCardThreadsLabel(hanzi: string, count: number): string | null {
  if (count <= 0) return null;
  return `Earlier about ${hanzi} · ${count} chat${count === 1 ? '' : 's'}`;
}
