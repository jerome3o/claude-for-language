import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import type { ResultLink } from '@shared/claude/cardTools';
import { db } from '../../db/database';
import { track } from '../../services/analytics';
import './result-link.css';

/**
 * A tool-result line under a Claude reply is a link to what it made (docs/CHAT.md "Tool lines you
 * can tap"; the target per line is `toolResultLink` in shared/claude/cardTools.ts). The thread view
 * provides how to open it ([ResultOpenProvider]): it remembers where he was — the thread, its scroll,
 * the sheet it was in — on the CURRENT history entry (`claudeReturn`), then opens the path; back
 * lands on that entry and the host reopens its sheet / the thread restores its scroll.
 */

/** Where he was when he opened a line (kept in `history.state.usr.claudeReturn`). */
export interface ClaudeReturn {
  /** The thread on screen (null = a fresh one not made yet). */
  thread_id: string | null;
  /** The thread view's `source` — which sheet to reopen ("study_card", "chat_message", "reader", "exercise"…). */
  source: string | null;
  /** What the thread is about — a card's note, a chat message, a reader, a lesson (a host reopens its sheet only on the same one). */
  ref: string | null;
  /** A reader thread's page (1-based): the reader opens on it again. */
  page?: number | null;
  /** The thread's scroll (a sheet's body, or the page). */
  scroll: number | null;
  at: number;
}

/** Older than this, a remembered place is ignored (a tab left open overnight). */
export const CLAUDE_RETURN_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** The remembered place on this history entry, if any (and recent). */
export function readClaudeReturn(state: unknown, now = Date.now()): ClaudeReturn | null {
  const r = state && typeof state === 'object' ? (state as { claudeReturn?: unknown }).claudeReturn : null;
  if (!r || typeof r !== 'object') return null;
  const o = r as Partial<ClaudeReturn>;
  if (typeof o.at !== 'number' || now - o.at > CLAUDE_RETURN_MAX_AGE_MS || now < o.at - 60_000) return null;
  return {
    thread_id: typeof o.thread_id === 'string' ? o.thread_id : null,
    source: typeof o.source === 'string' ? o.source : null,
    ref: typeof o.ref === 'string' ? o.ref : null,
    page: typeof o.page === 'number' && Number.isFinite(o.page) ? o.page : null,
    scroll: typeof o.scroll === 'number' && Number.isFinite(o.scroll) ? o.scroll : null,
    at: o.at,
  };
}

/** The history state without the remembered place (a host clears it once its sheet is closed again). */
export function withoutClaudeReturn(state: unknown): unknown {
  if (!state || typeof state !== 'object' || !('claudeReturn' in state)) return state;
  const { claudeReturn: _drop, ...rest } = state as Record<string, unknown>;
  void _drop;
  return Object.keys(rest).length ? rest : null;
}

type OpenResult = (link: ResultLink) => void;
const ResultOpenContext = createContext<OpenResult | null>(null);
export const ResultOpenProvider = ResultOpenContext.Provider;

/** How a line opens its link: the thread view's (remembers where he was), else a plain navigation. */
export function useOpenResult(context = 'coach'): OpenResult {
  const provided = useContext(ResultOpenContext);
  const navigate = useNavigate();
  const plain = useCallback(
    (link: ResultLink) => {
      track('claude.tool_result_open', { kind: link.kind, context });
      navigate(link.path);
    },
    [navigate, context],
  );
  return provided ?? plain;
}

/**
 * Whether the line can open now: 'ok', or 'offline' = not on this device and no connection (the
 * line says so instead of opening an empty page). A target that turns out deleted is said by the
 * destination ("This lesson was deleted" / "This card was deleted").
 */
export function useResultAvailability(link: ResultLink | null | undefined): 'ok' | 'offline' {
  const isOnline = useOnline();
  const here = useLiveQuery(async () => {
    if (!link?.id) return true;
    if (link.target === 'lesson') return !!(await db.customLessons.get(link.id));
    if (link.target === 'card') return !!(await db.notes.get(link.id));
    if (link.target === 'deck') return !!(await db.decks.get(link.id));
    return true;
  }, [link?.target, link?.id]);
  if (!link || isOnline || here !== false) return 'ok';
  return 'offline';
}

/** The browser's connection (kept light: no app context, so any screen can draw a line). */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

const OFFLINE_NOTE = 'Not on this device yet — needs a connection';

/** "Start ›" / "Open card ›": the affordance at the end of a line with other controls on it (Undo, word chips). */
export function ResultLinkGo({ link, context }: { link: ResultLink; context?: string }) {
  const open = useOpenResult(context);
  const availability = useResultAvailability(link);
  const off = availability === 'offline';
  return (
    <button
      type="button"
      className="claude-result-go"
      onClick={() => open(link)}
      disabled={off}
      aria-label={off ? `${link.aria} — ${OFFLINE_NOTE.toLowerCase()}` : link.aria}
      title={off ? OFFLINE_NOTE : undefined}
      data-testid={`claude-result-go-${link.kind}`}
    >
      {off ? 'Needs a connection' : link.label} <span aria-hidden="true">›</span>
    </button>
  );
}

/**
 * A whole line as one tap target (≥ 44px): its text, then "Start ›". Offline and not on this device:
 * the line stays, not tappable, with "Not on this device yet — needs a connection".
 */
export function ResultLinkLine({ link, className, testId, context, children }: { link: ResultLink; className: string; testId?: string; context?: string; children: ReactNode }) {
  const open = useOpenResult(context);
  const availability = useResultAvailability(link);
  if (availability === 'offline') {
    return (
      <div className={`${className} claude-result-line is-off`} data-testid={testId} data-link-path={link.path}>
        <span>{children}</span>
        <span className="claude-result-off">{OFFLINE_NOTE}</span>
      </div>
    );
  }
  return (
    <button type="button" className={`${className} claude-result-line`} onClick={() => open(link)} aria-label={link.aria} data-testid={testId} data-link-path={link.path}>
      <span className="claude-result-text">{children}</span>
      <span className="claude-result-go-label" aria-hidden="true">
        {link.label} ›
      </span>
    </button>
  );
}

/** What a thread context is about (the `ref` a host matches its sheet against). */
export function contextRefOf(ctx: { kind: string; note_id?: string; message_id?: string; reader_id?: string; lesson_id?: string }): string | null {
  switch (ctx.kind) {
    case 'card':
      return ctx.note_id ?? null;
    case 'chat_message':
      return ctx.message_id ?? null;
    case 'reader':
      return ctx.reader_id ?? null;
    case 'exercise':
      return ctx.lesson_id ?? null;
    default:
      return null;
  }
}
