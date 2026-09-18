/**
 * Claude side-chat for an editor. Claude is a co-editor of the thing being
 * edited: it answers in prose and/or proposes a full revised spec, which is
 * shown as a diff card with Accept / Reject. Accepting replaces the editor's
 * working copy (unsaved until Save). The current spec always rides along
 * with each message, and a subtle system line shows what the author changed
 * since the previous message.
 *
 * Spec-agnostic: the lesson editor uses the defaults (lesson diff + DiffCard);
 * the reader editor passes its own `pendingChanges` and `renderDiff`.
 */

import { ReactNode, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CustomLessonSpec, LessonDiff, diffLessonSpecs, formatLessonDiff } from '@shared/lesson';
import { getEditorChat, sendEditorMessage, setProposalStatus, LessonApiError } from '../../api/lessonEditor';
import { EditorChatMessage, EditorTargetType } from '../../types/lessonEditor';
import { DiffCard } from './DiffCard';

const QUICK_PROMPTS = [
  'Add a listening exercise for the key word',
  'Make it easier',
  'Make it harder',
  'Add pinyin everywhere',
  'Check the Chinese for mistakes',
];

export interface EditorChatProps<TSpec, TDiff> {
  target: EditorTargetType;
  targetId: string;
  currentSpec: TSpec;
  onAcceptProposal: (spec: TSpec) => void;
  /** Extra quick prompts for this editor kind. */
  quickPrompts?: string[];
  /** Lines describing what the author changed between two specs (client-side preview). */
  pendingChanges?: (baseline: TSpec, current: TSpec) => string[];
  /** How to render a proposal's diff. */
  renderDiff?: (diff: TDiff) => ReactNode;
  /** "co-editor for this lesson" */
  subject?: string;
  /** Empty-state hint with example requests. */
  emptyHint?: string;
}

const lessonPending = (a: unknown, b: unknown) => formatLessonDiff(diffLessonSpecs(a as CustomLessonSpec, b as CustomLessonSpec));
const lessonDiff = (d: unknown) => <DiffCard diff={d as LessonDiff} />;

export function EditorChat<TSpec = CustomLessonSpec, TDiff = LessonDiff>(props: EditorChatProps<TSpec, TDiff>) {
  const {
    target,
    targetId,
    currentSpec,
    onAcceptProposal,
    quickPrompts = QUICK_PROMPTS,
    pendingChanges: computePending = lessonPending,
    renderDiff = lessonDiff,
    subject = 'co-editor for this lesson',
    emptyHint = 'Ask for changes in plain words — “add a listening exercise for 又”, “make section 2 easier”. Claude answers with a proposal you can accept or reject.',
  } = props;
  type Msg = EditorChatMessage<TSpec, TDiff>;
  const queryClient = useQueryClient();
  const queryKey = ['editor-chat', target, targetId];
  const chatQuery = useQuery({
    queryKey,
    queryFn: () => getEditorChat<TSpec, TDiff>(target, targetId),
    retry: false,
  });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState<Msg[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const messages: Msg[] = localMessages ?? chatQuery.data?.messages ?? [];

  // Keep the local copy in step with the server once it loads/refreshes.
  useEffect(() => {
    if (chatQuery.data) setLocalMessages(chatQuery.data.messages);
  }, [chatQuery.data]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, sending]);

  // What the author changed since the last message, shown live above the
  // input so they know what Claude will be told.
  const lastMessage = messages[messages.length - 1];
  let pendingChanges: string[] = [];
  if (lastMessage) {
    const baseline = lastMessage.role === 'assistant' && lastMessage.proposal_status === 'accepted' && lastMessage.proposed_spec
      ? lastMessage.proposed_spec
      : null;
    // Without the snapshot we can't diff client-side except against an
    // accepted proposal; the server computes the authoritative line.
    if (baseline) {
      try {
        pendingChanges = computePending(baseline, currentSpec);
      } catch {
        pendingChanges = [];
      }
    }
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    setDraft('');
    const optimistic: Msg = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: message,
      created_at: new Date().toISOString(),
      proposal_status: null,
      proposed_spec: null,
      proposal_diff: null,
      author_changes: pendingChanges,
    };
    setLocalMessages(prev => [...(prev ?? []), optimistic]);
    try {
      const result = await sendEditorMessage<TSpec, TDiff>(target, targetId, message, currentSpec);
      setLocalMessages(prev => [
        ...(prev ?? []).filter(m => m.id !== optimistic.id),
        result.user_message,
        result.message,
      ]);
      queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      const msg = err instanceof LessonApiError && err.status === 503
        ? 'Claude is not configured on this server.'
        : err instanceof Error ? err.message : 'Could not reach Claude';
      setError(msg);
      setLocalMessages(prev => (prev ?? []).filter(m => m.id !== optimistic.id));
      setDraft(message);
    } finally {
      setSending(false);
    }
  }

  async function decide(message: Msg, status: 'accept' | 'reject') {
    if (status === 'accept' && message.proposed_spec) {
      onAcceptProposal(JSON.parse(JSON.stringify(message.proposed_spec)) as TSpec);
    }
    setLocalMessages(prev => (prev ?? []).map(m => (
      m.id === message.id ? { ...m, proposal_status: status === 'accept' ? 'accepted' : 'rejected' } : m
    )));
    try {
      await setProposalStatus(target, targetId, message.id, status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your decision');
    }
  }

  const aiAvailable = chatQuery.data?.ai_available ?? true;

  return (
    <div className="editor-chat">
      <div className="editor-chat-header">
        <span>✨ Claude</span>
        <span className="editor-chat-hint">{subject}</span>
      </div>

      <div className="editor-chat-list" ref={listRef}>
        {chatQuery.isLoading && <div className="editor-chat-system">Loading conversation…</div>}
        {chatQuery.isError && <div className="editor-chat-system">Couldn't load the conversation.</div>}
        {!chatQuery.isLoading && !aiAvailable && (
          <div className="editor-chat-system">Claude isn't configured on this server. The editor still works.</div>
        )}
        {messages.length === 0 && !chatQuery.isLoading && aiAvailable && (
          <div className="editor-chat-system">{emptyHint}</div>
        )}
        {messages.map(m => (
          <div key={m.id} className={`editor-chat-message ${m.role}`}>
            {m.role === 'user' && m.author_changes.length > 0 && (
              <div className="editor-chat-system changes">
                Since your last message you changed: {m.author_changes.join('; ')}
              </div>
            )}
            <div className="editor-chat-bubble">{m.content}</div>
            {m.role === 'assistant' && m.proposed_spec && (
              <div className={`editor-chat-proposal ${m.proposal_status ?? ''}`}>
                <div className="editor-chat-proposal-title">
                  Proposed changes
                  {m.proposal_status === 'accepted' && <span className="proposal-status accepted">Accepted</span>}
                  {m.proposal_status === 'rejected' && <span className="proposal-status rejected">Rejected</span>}
                </div>
                {m.proposal_diff && renderDiff(m.proposal_diff)}
                {m.proposal_status === 'pending' && (
                  <div className="editor-chat-proposal-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => decide(m, 'reject')}>Reject</button>
                    <button className="btn btn-primary btn-sm" onClick={() => decide(m, 'accept')}>Accept</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {sending && <div className="editor-chat-message assistant"><div className="editor-chat-bubble thinking">Thinking…</div></div>}
        {error && <div className="editor-chat-error">{error}</div>}
      </div>

      {pendingChanges.length > 0 && (
        <div className="editor-chat-system changes">You've changed: {pendingChanges.join('; ')}</div>
      )}

      <div className="editor-chat-quick">
        {quickPrompts.map(p => (
          <button key={p} className="editor-chip" onClick={() => send(p)} disabled={sending || !aiAvailable}>
            {p}
          </button>
        ))}
      </div>

      <form
        className="editor-chat-input"
        onSubmit={e => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={aiAvailable ? 'Ask Claude to change something…' : 'Claude is unavailable'}
          rows={2}
          disabled={sending || !aiAvailable}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim() || !aiAvailable}>
          Send
        </button>
      </form>
    </div>
  );
}
