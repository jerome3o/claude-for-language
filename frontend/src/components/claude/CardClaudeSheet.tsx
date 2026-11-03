/**
 * Ask Claude on a study card = the card's Claude THREAD in a sheet over the card (docs/STUDY_SESSION.md
 * "Ask Claude"; the unified-Claude-chats plan §6.4). The same screen as every Claude chat
 * (`ClaudeThreadView variant="sheet"`): the card's suggestion chips, Ask only, the reply streamed,
 * 🎧 / 中文 | EN / word chips / Read it back, the long-press menu and the ✎ check on my Chinese.
 *
 * - Which thread: the card's recent one (`resumeThreadFor` — its last message within 30 minutes of
 *   opening), else a new one made by the first question. "Earlier about 银行 · 2 chats" lists the
 *   card's other threads (switch to one, or ＋ New chat). The thread shows in the Chats tab with
 *   "📇 Asked on card · 银行".
 * - Claude's card tools (edit / delete this card, make cards, a mini lesson, ⚡ bump) are applied by the
 *   server; when a reply this sheet saw being written finishes, `onToolResults` brings the device's
 *   study state in line (once per reply) and the reply shows a line per result — "✓ Claude edited
 *   this card · Undo" (`shared/claude/cardTools.ts`).
 * - Offline: the question is queued with the thread's client ids ("🕓 Will send when you're online").
 * - Stays mounted (hidden) while closed, so a reply still being written lands and its tools apply.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { resumeThreadFor } from '@shared/claude/contexts';
import { cardToolLines, earlierCardThreads, earlierCardThreadsLabel, parseCardToolResults, type CardToolResult } from '@shared/claude/cardTools';
import { chatRelativeTime } from '@shared/chats/inbox';
import type { ClaudeThreadContext, ClaudeContextSnapshot } from '@shared/claude/context';
import { ClaudeThreadView } from './ClaudeThreadView';
import { markCardEffectsApplied, refreshCardThreads, useCardThreads } from '../../services/cardClaudeThreads';
import type { LocalClaudeMessage } from '../../services/claudeThreads';
import { useNetwork } from '../../contexts/NetworkContext';
import { track } from '../../services/analytics';
import '../askClaude/ask-claude.css';

export interface CardClaudeSheetProps {
  open: boolean;
  noteId: string;
  hanzi: string;
  deckName?: string | null;
  cardType: string;
  /** The answer typed on this showing of a typing card (the "Check my answer" chip + Claude's context). */
  typed: { answer: string; correct?: string } | null;
  hasSentence: boolean;
  /** The card was deleted (by Claude): no more questions. */
  cardDeleted: boolean;
  /** Ask this at once (the leech sheet's memory hook) — once per key. */
  autoAsk?: { text: string; key: string } | null;
  onClose: () => void;
  /** A finished reply's card tools, once per reply: the device's study state follows them. */
  onToolResults: (results: CardToolResult[], reply: LocalClaudeMessage) => void;
  /** This reply's edit can be undone on this device (its "before" was kept when it was applied). */
  canUndo: (replyId: string) => boolean;
  /** Undo the reply's edit (a normal note update); throws on failure. */
  onUndoEdit: (replyId: string) => Promise<void>;
}

type UndoState = { state: 'busy' | 'done' } | { state: 'error'; message: string };

export function CardClaudeSheet(props: CardClaudeSheetProps) {
  const { open, noteId, hanzi } = props;
  const { isOnline } = useNetwork();
  const threads = useCardThreads(noteId);
  const openedAt = useRef(Date.now());
  const [chosen, setChosen] = useState<string | null>(null);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const [undo, setUndo] = useState<Record<string, UndoState>>({});

  // Each time it opens: the card's threads from the server (the device's copy shows at once).
  useEffect(() => {
    if (!open) return;
    if (chosen === null) openedAt.current = Date.now();
    if (isOnline) void refreshCardThreads(noteId).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, noteId]);

  const context = useMemo<ClaudeThreadContext>(() => ({ kind: 'card', note_id: noteId, card_type: props.cardType }), [noteId, props.cardType]);
  const resumed = useMemo(() => (threads ? resumeThreadFor(threads, context, openedAt.current) : null), [threads, context]);
  const threadId = chosen ?? resumed ?? 'new';
  const earlier = useMemo(() => earlierCardThreads(threads ?? [], noteId, threadId === 'new' ? null : threadId), [threads, noteId, threadId]);
  const earlierLabel = earlierCardThreadsLabel(hanzi, earlier.length);

  const newContext = useMemo<ClaudeThreadContext & ClaudeContextSnapshot>(
    () => ({ ...context, ...(props.typed ? { typed: props.typed } : {}), label: hanzi, ...(props.deckName ? { sublabel: props.deckName } : {}) }) as ClaudeThreadContext & ClaudeContextSnapshot,
    [context, props.typed, hanzi, props.deckName],
  );

  const onReplyFinished = (reply: LocalClaudeMessage) => {
    const results = parseCardToolResults(reply.tool_results);
    if (results.length === 0 || !markCardEffectsApplied(reply.id)) return;
    props.onToolResults(results, reply);
  };

  const undoEdit = async (replyId: string) => {
    setUndo((u) => ({ ...u, [replyId]: { state: 'busy' } }));
    try {
      await props.onUndoEdit(replyId);
      setUndo((u) => ({ ...u, [replyId]: { state: 'done' } }));
      track('claude.undo_card_edit', { context_kind: 'card' });
    } catch (err) {
      setUndo((u) => ({ ...u, [replyId]: { state: 'error', message: err instanceof Error && err.message ? err.message : 'Couldn’t undo it' } }));
    }
  };

  const renderToolResults = (reply: LocalClaudeMessage) => {
    const lines = cardToolLines(parseCardToolResults(reply.tool_results));
    if (lines.length === 0) return null;
    const u = undo[reply.id];
    return (
      <div className="card-claude-tools" data-testid="card-claude-tools">
        {lines.map((line, i) => (
          <div key={i} className={`card-claude-tool ${line.kind}`} data-testid={`card-claude-tool-${line.kind}`}>
            <span>{u?.state === 'done' && line.undo ? '↺ Undone — the card is back as it was' : line.text}</span>
            {line.undo && props.canUndo(reply.id) && u?.state !== 'done' && (
              <button
                type="button"
                className="card-claude-undo"
                onClick={() => void undoEdit(reply.id)}
                disabled={u?.state === 'busy' || !isOnline}
                title={isOnline ? undefined : 'Undo needs a connection'}
                data-testid="card-claude-undo"
              >
                {u?.state === 'busy' ? 'Undoing…' : 'Undo'}
              </button>
            )}
            {line.undo && u?.state === 'error' && <span className="card-claude-undo-error" role="alert">{u.message}</span>}
          </div>
        ))}
      </div>
    );
  };

  const headerExtra =
    earlierLabel || threadId !== 'new' ? (
      <div className="card-claude-earlier">
        {earlierLabel && (
          <button type="button" className="card-claude-earlier-toggle" aria-expanded={earlierOpen} onClick={() => setEarlierOpen((o) => !o)} data-testid="card-claude-earlier">
            🕘 {earlierLabel} {earlierOpen ? '▴' : '▾'}
          </button>
        )}
        {threadId !== 'new' && (
          <button
            type="button"
            className="card-claude-new"
            onClick={() => {
              setChosen('new');
              setEarlierOpen(false);
              track('claude.thread_action', { action: 'new', context_kind: 'card' });
            }}
            data-testid="card-claude-new"
          >
            ＋ New chat
          </button>
        )}
        {earlierOpen && earlier.length > 0 && (
          <ul className="card-claude-earlier-list" data-testid="card-claude-earlier-list">
            {earlier.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    setChosen(t.id);
                    setEarlierOpen(false);
                    track('claude.thread_action', { action: 'switch', context_kind: 'card' });
                  }}
                  data-testid="card-claude-earlier-row"
                >
                  <span className="card-claude-earlier-preview">{t.preview || t.title}</span>
                  <span className="card-claude-earlier-time">{chatRelativeTime(t.last_message_at ?? t.created_at, Date.now(), -new Date().getTimezoneOffset())}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    ) : null;

  return (
    <div className="modal-overlay claude-modal-overlay card-claude-overlay" hidden={!open} aria-hidden={!open} onClick={props.onClose}>
      <div className="modal claude-modal ask-claude-modal card-claude-sheet" role="dialog" aria-label={`Ask Claude about ${hanzi}`} onClick={(e) => e.stopPropagation()} data-testid="ask-claude-sheet">
        <ClaudeThreadView
          threadId={threadId}
          newContext={newContext}
          variant="sheet"
          source="study_card"
          hasSentence={props.hasSentence}
          typed={props.typed}
          cardType={props.cardType}
          autoSend={props.autoAsk && threads !== undefined ? { text: props.autoAsk.text, intent: 'ask', key: props.autoAsk.key } : null}
          onClose={props.onClose}
          onThreadCreated={(id) => setChosen(id)}
          onReplyFinished={onReplyFinished}
          renderToolResults={renderToolResults}
          headerExtra={headerExtra}
          closedNote={props.cardDeleted ? 'This card was deleted — moving on to the next one.' : null}
        />
      </div>
    </div>
  );
}

export default CardClaudeSheet;
