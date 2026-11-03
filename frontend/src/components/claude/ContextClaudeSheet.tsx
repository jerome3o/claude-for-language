/**
 * A Claude thread in a sheet over what he is doing — a graded reader's page ("📖 Ask Claude about this
 * page", components/reader/ReaderView.tsx) or a mini lesson's exercise ("💬 Ask Claude",
 * components/lessons/) — the same screen as every Claude chat (`ClaudeThreadView variant="sheet"`):
 * the context's suggestion chips, Ask only, the reply streamed, 中文 | EN, 🎧, word chips.
 * docs/CHAT.md "Claude threads" → "Reader and exercise threads"; the unified-Claude-chats plan §6.5.
 *
 * - Which thread: the context's recent one (`resumeThreadFor` — its last message within 30 minutes of
 *   opening), else a new one made by the first question; "＋ New chat" starts afresh. The thread shows
 *   in the Chats tab with its chip ("📖 Reader · 成都 p.3", "🧩 Exercise · Translate").
 * - `fields` (a reader page's looked-up / misread words, an exercise's answer + check) ride with every
 *   question, so Claude reads them as they stand now.
 * - Offline: the question is queued (services/claudeThreads.ts) and sent when a connection comes back.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { resumeThreadFor } from '@shared/claude/contexts';
import type { ClaudeContextSnapshot, ClaudeThreadContext } from '@shared/claude/context';
import { ClaudeThreadView } from './ClaudeThreadView';
import { refreshContextThreads, useContextThreads } from '../../services/contextClaudeThreads';
import { useNetwork } from '../../contexts/NetworkContext';
import { track } from '../../services/analytics';
import '../askClaude/ask-claude.css';

export interface ContextClaudeSheetProps {
  /** The context (with the fields of this showing) + its badge snapshot. */
  context: ClaudeThreadContext & ClaudeContextSnapshot;
  /** The context's fields as they stand now, sent with each follow-up (reader: looked_up / said_wrong; exercise: answer). */
  fields?: Record<string, unknown>;
  /** What the dialog is called for a screen reader ("Ask Claude about this page"). */
  label: string;
  /** Where it was opened from (analytics: claude.thread_open). */
  source: string;
  /** The thread it resumed (or null for a new one), once known — the entry point's analytics. */
  onResolved?: (resumed: boolean) => void;
  onClose: () => void;
}

export function ContextClaudeSheet(props: ContextClaudeSheetProps) {
  const { context } = props;
  const { isOnline } = useNetwork();
  const threads = useContextThreads(context);
  const openedAt = useRef(Date.now());
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    if (isOnline) void refreshContextThreads(context).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resumed = useMemo(() => (threads ? resumeThreadFor(threads, context, openedAt.current) : null), [threads, context]);
  const threadId = chosen ?? resumed ?? 'new';

  const reported = useRef(false);
  const onResolved = props.onResolved;
  useEffect(() => {
    if (reported.current || threads === undefined) return;
    reported.current = true;
    onResolved?.(!!resumed);
  }, [threads, resumed, onResolved]);

  const headerExtra =
    threadId !== 'new' ? (
      <div className="card-claude-earlier">
        <button
          type="button"
          className="card-claude-new"
          onClick={() => {
            setChosen('new');
            track('claude.thread_action', { action: 'new', context_kind: context.kind });
          }}
          data-testid="context-claude-new"
        >
          ＋ New chat
        </button>
      </div>
    ) : null;

  return (
    <div className="modal-overlay claude-modal-overlay card-claude-overlay" onClick={props.onClose}>
      <div className="modal claude-modal ask-claude-modal card-claude-sheet" role="dialog" aria-label={props.label} onClick={(e) => e.stopPropagation()} data-testid="context-claude-sheet">
        {threads === undefined ? (
          <p className="claude-chat-empty">Loading…</p>
        ) : (
          <ClaudeThreadView
            threadId={threadId}
            newContext={context}
            contextFields={props.fields}
            variant="sheet"
            source={props.source}
            onClose={props.onClose}
            onThreadCreated={(id) => setChosen(id)}
            headerExtra={headerExtra}
          />
        )}
      </div>
    </div>
  );
}

export default ContextClaudeSheet;
