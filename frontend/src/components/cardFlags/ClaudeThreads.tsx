import { useState } from 'react';
import { Link } from 'react-router-dom';
import { groupQuestionThreads, type QuestionThread } from '@shared/chats';
import type { ClaudeChatQuestion } from '../../types/cardFlags';
import { relativeDay, shortDateTime, plural } from '../tutor/format';
import { cardHubPath } from './paths';
import './cardFlags.css';

export type ClaudeThread = QuestionThread<ClaudeChatQuestion>;

/** Group raw Q&A rows into conversations, newest first. */
export function toThreads(questions: ClaudeChatQuestion[]): ClaudeThread[] {
  return groupQuestionThreads(questions);
}

/**
 * Ask-Claude conversations as a list: one row per thread (card · when · how
 * many questions · the first question), tap to open the full Q&A. Used on
 * the Claude conversations pages, the card hub and the tutor's student page.
 */
export function ClaudeThreadList({
  threads,
  relId,
  showCard = true,
  emptyText = 'No conversations with Claude yet.',
  initiallyOpen = false,
}: {
  threads: ClaudeThread[];
  /** Set for the tutor's view: card links go through the relationship. */
  relId?: string | null;
  showCard?: boolean;
  emptyText?: string;
  /** Start with every thread expanded (the card hub). */
  initiallyOpen?: boolean;
}) {
  if (threads.length === 0) return <div className="cf-empty">{emptyText}</div>;
  return (
    <ul className="ct-list" data-testid="claude-threads">
      {threads.map((thread) => (
        <ClaudeThreadRow key={thread.id} thread={thread} relId={relId} showCard={showCard} initiallyOpen={initiallyOpen} />
      ))}
    </ul>
  );
}

function ClaudeThreadRow({ thread, relId, showCard, initiallyOpen }: { thread: ClaudeThread; relId?: string | null; showCard: boolean; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const first = thread.questions[0];
  return (
    <li className={`ct-thread${open ? ' ct-thread-open' : ''}`} data-testid="claude-thread">
      <button type="button" className="ct-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {showCard && <span className="ct-hanzi" lang="zh">{first.hanzi}</span>}
        <span className="ct-head-text">
          {showCard && <span className="ct-card-line">{first.pinyin} · {first.english}</span>}
          <span className="ct-summary">
            {relativeDay(thread.last_at)} · {plural(thread.questions.length, 'question')}
          </span>
          {!open && <span className="ct-preview">{first.question}</span>}
        </span>
        <span className="ct-toggle" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="ct-body">
          {thread.questions.map((q) => (
            <div key={q.id} className="ct-qa">
              <div className="ct-q"><span className="ct-label">Asked</span>{q.question}</div>
              <div className="ct-a"><span className="ct-label">Claude</span>{q.answer}</div>
              <div className="ct-time">{shortDateTime(q.asked_at)}</div>
            </div>
          ))}
          {showCard && (
            <Link to={cardHubPath(thread.note_id, relId)} className="ct-open-card">Open this card ›</Link>
          )}
        </div>
      )}
    </li>
  );
}
