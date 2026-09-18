import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createDeck } from '../../api/client';
import type { HomeworkDeckSummary } from '../../types/tutorDashboard';
import { plural } from './format';
import './tutor-dashboard.css';

/**
 * "My homework decks": decks the tutor has shared, with how many students got
 * them, and "+ New homework deck" — write it yourself (a name, then add words
 * on the deck page) or hand a topic / pasted word list to the generator.
 */
export function HomeworkDecks({ decks }: { decks: HomeworkDeckSummary[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');

  const create = useMutation({
    mutationFn: () => createDeck(name.trim()),
    onSuccess: (deck) => {
      queryClient.invalidateQueries({ queryKey: ['decks'] });
      navigate(`/decks/${deck.id}`);
    },
  });

  return (
    <section className="td-section" aria-labelledby="td-hw-decks-title">
      <h2 className="td-section-title" id="td-hw-decks-title">My homework decks</h2>
      <div className="td-list">
        {decks.map((d) => (
          <Link key={d.deck_id} to={`/decks/${d.deck_id}`} className="td-deck-row">
            <span>
              <span className="td-deck-name" lang="zh">{d.name}</span>
              <span className="td-deck-meta"> · {plural(d.note_count, 'word')} · sent to {plural(d.student_count, 'student')}</span>
            </span>
            <span className="td-chevron">›</span>
          </Link>
        ))}
        {decks.length === 0 && <p className="td-muted" style={{ margin: 0 }}>No deck sent yet. Make one and send it from a student's card.</p>}
        <button type="button" className="td-new-deck" onClick={() => setShowNew((v) => !v)} aria-expanded={showNew}>
          + New homework deck (write, generate, or paste a list)
        </button>
        {showNew && (
          <div className="td-new-deck-menu" role="group" aria-label="New homework deck">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) create.mutate();
              }}
              style={{ display: 'flex', gap: '0.5rem' }}
            >
              <input
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Deck name, e.g. 第四周作业：交通"
                aria-label="New deck name"
                style={{ flex: 1, minWidth: 0, fontSize: '1rem' }}
              />
              <button type="submit" className="btn btn-primary" disabled={!name.trim() || create.isPending}>
                {create.isPending ? '…' : 'Write it'}
              </button>
            </form>
            {create.error && <div className="td-error">{create.error instanceof Error ? create.error.message : 'Could not create the deck'}</div>}
            <Link to="/generate" className="btn btn-secondary">✨ Generate from a topic or a pasted word list</Link>
            <p className="td-muted" style={{ margin: 0 }}>
              "Write it" opens the empty deck so you can add words one by one; the generator turns a topic or a pasted list into cards with pinyin and audio.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
