/**
 * Discuss with Claude on a chat message = the message's Claude THREAD in a sheet over the chat
 * (docs/CHAT.md "Discuss with Claude"; the unified-Claude-chats plan §6.5). The same screen as every
 * Claude chat (`ClaudeThreadView variant="sheet"`, context `chat_message`): the message quoted on top,
 * the chips (什么意思 / 自然吗 / 怎么回复 / 做卡片), Ask only, the reply streamed, word chips, 🎧, the menu.
 *
 * - Which thread: the message's own (`resumeThreadFor` — one per message, whenever), else a new one made
 *   by the first question. It shows in the Chats tab with "💬 About a message · …".
 * - Cards Claude proposes (create_flashcards → `propose_flashcards` on the reply) are never saved by the
 *   server: they come back here for review — tick, then "Add N cards" saves them straight into "From
 *   chats" (no deck to pick; docs/STUDY_SESSION.md "Source decks") with "✓ Added to … · Change".
 * - Replaces the old discussion sheet (MessageDiscussionModal, `PUT /api/messages/:id/discussion`, kept
 *   on the server for older apps).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { resumeThreadFor } from '@shared/claude/contexts';
import type { ClaudeContextSnapshot, ClaudeThreadContext } from '@shared/claude/context';
import { previewOf } from '@shared/claude/context';
import { ClaudeThreadView } from './ClaudeThreadView';
import { parseToolResults, ToolResultChips } from '../coach/CoachResults';
import { sourceDeckName } from '@shared/decks/source-decks';
import { addCardsToSourceDeck, type AddedToDeck } from '../../services/sourceDecks';
import { AddedToDeckLine } from '../sourceDecks/AddedToDeckLine';
import { refreshMessageThreads, useMessageThreads } from '../../services/messageClaudeThreads';
import type { LocalClaudeMessage } from '../../services/claudeThreads';
import { useNetwork } from '../../contexts/NetworkContext';
import { track, trackError } from '../../services/analytics';
import type { GeneratedNote, MessageWithSender } from '../../types';
import '../askClaude/ask-claude.css';
import './discuss-sheet.css';

export interface DiscussClaudeSheetProps {
  message: Pick<MessageWithSender, 'id' | 'content'>;
  conversationId: string;
  onClose: () => void;
}

/** The cards of a reply's `propose_flashcards` result (Discuss with Claude), or null. */
export function proposedCardsOf(toolResults: string | null): GeneratedNote[] | null {
  for (const r of parseToolResults(toolResults)) {
    if (r.tool !== 'propose_flashcards' || !r.success) continue;
    const list = (r.data as { flashcards?: unknown } | undefined)?.flashcards;
    if (Array.isArray(list)) return list.filter((c): c is GeneratedNote => !!c && typeof c === 'object' && typeof (c as GeneratedNote).hanzi === 'string');
  }
  return null;
}

/** Claude's proposed cards: ticked by default; "Add N cards" saves the ticked ones into "From chats". */
function ProposedCards({ cards, context, replyId }: { cards: GeneratedNote[]; context: string; replyId: string }) {
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(cards.map((_, i) => i)));
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState<AddedToDeck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toggle = (i: number) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const save = async () => {
    const picked = cards.filter((_, i) => chosen.has(i));
    if (picked.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const out = await addCardsToSourceDeck(
        'chats',
        picked.map((c) => ({ hanzi: c.hanzi, pinyin: c.pinyin, english: c.english, context, ...(c.fun_facts ? { fun_facts: c.fun_facts } : {}) })),
        'chat_discuss',
      );
      if (out.result.failed.length && !out.noteIds.length) throw new Error(out.result.failed[0].error);
      setAdded(out);
      track('coach.ask_flashcards', { count: out.noteIds.length, focus: false });
    } catch (err) {
      trackError('discuss_save_cards', err);
      setError("Couldn't save the cards — try again.");
    } finally {
      setSaving(false);
    }
  };
  if (added) {
    return (
      <div data-testid="discuss-cards-done">
        <AddedToDeckLine added={added} surface="chat_discuss" onMoved={setAdded} />
      </div>
    );
  }
  return (
    <div className="discuss-cards" data-testid="discuss-cards" data-reply={replyId}>
      <div className="discuss-cards-head">✨ Claude suggests {cards.length} card{cards.length === 1 ? '' : 's'} — tick the ones you want</div>
      {cards.map((c, i) => (
        <button key={i} type="button" className={`discuss-card${chosen.has(i) ? ' on' : ''}`} aria-pressed={chosen.has(i)} onClick={() => toggle(i)}>
          <span className="discuss-card-tick" aria-hidden="true">{chosen.has(i) ? '✓' : ''}</span>
          <span className="discuss-card-text">
            <strong lang="zh">{c.hanzi}</strong> <span>{c.pinyin}</span>
            <span className="discuss-card-en">{c.english}</span>
          </span>
        </button>
      ))}
      {chosen.size > 0 && (
        <button type="button" className="btn btn-primary discuss-cards-add" onClick={() => void save()} disabled={saving} data-testid="discuss-cards-add">
          {saving ? 'Adding…' : `Add ${chosen.size} card${chosen.size === 1 ? '' : 's'} to ${sourceDeckName('chats')}`}
        </button>
      )}
      {error && <p className="discuss-cards-error" role="alert">{error}</p>}
    </div>
  );
}

export function DiscussClaudeSheet({ message, conversationId, onClose }: DiscussClaudeSheetProps) {
  const { isOnline } = useNetwork();
  const threads = useMessageThreads(message.id);
  const openedAt = useRef(Date.now());
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    if (isOnline) void refreshMessageThreads().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);

  const context = useMemo<ClaudeThreadContext>(() => ({ kind: 'chat_message', message_id: message.id, conversation_id: conversationId }), [message.id, conversationId]);
  const resumed = useMemo(() => (threads ? resumeThreadFor(threads, context, openedAt.current) : null), [threads, context]);
  const threadId = chosen ?? resumed ?? 'new';

  // Once the device knows its threads: opened (resumed = the message's earlier thread).
  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current || threads === undefined) return;
    tracked.current = true;
    track('claude.discuss_open', { resumed: !!resumed });
  }, [threads, resumed]);

  const label = previewOf(message.content || '').slice(0, 40);
  const newContext = useMemo<ClaudeThreadContext & ClaudeContextSnapshot>(() => ({ ...context, ...(label ? { label } : {}) }) as ClaudeThreadContext & ClaudeContextSnapshot, [context, label]);

  const renderToolResults = (reply: LocalClaudeMessage) => {
    const cards = proposedCardsOf(reply.tool_results);
    const others = parseToolResults(reply.tool_results).filter((r) => r.tool !== 'propose_flashcards');
    if (!cards?.length && others.length === 0) return null;
    return (
      <>
        {others.length > 0 && <ToolResultChips results={others} />}
        {cards && cards.length > 0 && <ProposedCards cards={cards} context={message.content} replyId={reply.id} />}
      </>
    );
  };

  return (
    <div className="modal-overlay claude-modal-overlay discuss-claude-overlay" onClick={onClose}>
      <div className="modal claude-modal ask-claude-modal card-claude-sheet discuss-claude-sheet" role="dialog" aria-label="Discuss with Claude" onClick={(e) => e.stopPropagation()} data-testid="discuss-claude-sheet">
        <ClaudeThreadView
          threadId={threadId}
          newContext={newContext}
          variant="sheet"
          source="chat_message"
          onClose={onClose}
          onThreadCreated={(id) => setChosen(id)}
          renderToolResults={renderToolResults}
          headerExtra={
            <blockquote className="discuss-claude-quote" lang="zh" data-testid="discuss-claude-quote">
              {message.content}
            </blockquote>
          }
        />
      </div>
    </div>
  );
}

export default DiscussClaudeSheet;
