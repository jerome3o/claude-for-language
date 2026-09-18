import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getConversations } from '../../api/client';
import type { HomeworkView } from './useHomework';
import { describeDeckProgress } from './homework';

function truncate(text: string, max = 24): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * "From <tutor>": the newest deck or lesson a tutor sent, progress in words,
 * Reply (opens the latest conversation) and Open. Self-explaining, because
 * "homework" is not a word the app used before.
 */
export function HomeworkCard({ view }: { view: HomeworkView }) {
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);
  const { pick, progress, wordCount } = view;
  if (!pick) return null;

  const reply = async () => {
    if (pick.unreadMessage) {
      navigate(`/connections/${pick.relationshipId}/chat/${pick.unreadMessage.conversationId}`);
      return;
    }
    setOpening(true);
    try {
      const conversations = await getConversations(pick.relationshipId);
      const latest = conversations.find(c => !c.is_ai_conversation) ?? conversations[0];
      navigate(latest
        ? `/connections/${pick.relationshipId}/chat/${latest.id}`
        : `/connections/${pick.relationshipId}`);
    } catch {
      navigate(`/connections/${pick.relationshipId}`);
    } finally {
      setOpening(false);
    }
  };

  const item = pick.item;
  const pct = progress && progress.total > 0 ? Math.round((progress.started / progress.total) * 100) : 0;

  return (
    <section className="card home-homework" aria-label={`Homework from ${pick.tutorName}`}>
      <div className="home-homework-head">
        <h2 className="home-homework-title">From {pick.tutorName}</h2>
        <span className="home-homework-badge">Homework</span>
      </div>

      {item ? (
        <>
          <div className="home-homework-item">
            <span className="home-homework-name">{item.kind === 'deck' ? item.name : item.title}</span>
            {item.kind === 'deck' && wordCount !== null && (
              <span className="text-light"> · {wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
            )}
            {item.kind === 'lesson' && <span className="text-light"> · mini lesson</span>}
          </div>
          {item.kind === 'deck' && progress && (
            <>
              <div className="home-bar" aria-hidden="true">
                <div className="home-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <p className="home-homework-progress">{describeDeckProgress(progress)}</p>
            </>
          )}
          {item.kind === 'lesson' && (
            <p className="home-homework-progress">Comes up in your next study session.</p>
          )}
        </>
      ) : (
        <p className="home-homework-progress">No deck or lesson from {pick.tutorName} yet.</p>
      )}

      {pick.unreadMessage?.text && (
        <p className="home-homework-message">
          <span aria-hidden="true">💬</span> “{truncate(pick.unreadMessage.text, 60)}”
        </p>
      )}

      <div className="home-homework-actions">
        <button type="button" className="btn btn-secondary" onClick={reply} disabled={opening}>
          {pick.unreadMessage ? 'Reply' : 'Message'}
        </button>
        {item?.kind === 'deck' && (
          <button type="button" className="btn btn-secondary" onClick={() => navigate(`/decks/${item.deckId}`)}>
            Open deck
          </button>
        )}
        {item?.kind === 'lesson' && (
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/lessons')}>
            Open lesson
          </button>
        )}
      </div>
      <p className="home-homework-caption">Decks and lessons your tutor sends you show up here.</p>
    </section>
  );
}
