import { useEffect, useState } from 'react';
import { addToTodayLabel, SENTENCE_BUMP_SHEET_TITLE, type BumpSource } from '@shared/decks';
import type { LocalNote } from '../../db/database';
import { bumpNotes, useBumps } from '../../services/studyBumps';
import './bumps.css';

/**
 * "⚡ Study words from this today…" (shared/decks/sentence-bumps.ts): the words of a
 * sentence the learner already has, one row each, NOTHING ticked — he picks which go
 * first in today's study. Rows already in today's pocket show ⚡ and can't be ticked.
 * The action row is the shared pinned `.sheet-footer`.
 */
export function SentenceBumpSheet({
  notes,
  source,
  onClose,
  onBumped,
}: {
  notes: LocalNote[];
  source: BumpSource;
  onClose: () => void;
  onBumped: (message: string) => void;
}) {
  const bumps = useBumps();
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const chosen = [...picked].filter((id) => !bumps.has(id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function add() {
    if (busy || chosen.length === 0) return;
    setBusy(true);
    try {
      const out = await bumpNotes(chosen, source);
      onBumped(out.message);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div
        className="modal sentence-bump-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={SENTENCE_BUMP_SHEET_TITLE}
        data-testid="sentence-bump-sheet"
      >
        <div className="modal-header">
          <h2 className="modal-title">{SENTENCE_BUMP_SHEET_TITLE}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <p className="sentence-bump-help">Tick the ones to put first in today’s study.</p>
        <ul className="sentence-bump-list">
          {notes.map((n) => {
            const on = bumps.has(n.id);
            return (
              <li key={n.id}>
                <label className={`sentence-bump-row${on ? ' is-bumped' : ''}`} data-testid="sentence-bump-row">
                  <input
                    type="checkbox"
                    checked={on || picked.has(n.id)}
                    disabled={on || busy}
                    onChange={() => toggle(n.id)}
                    aria-label={n.hanzi}
                  />
                  <span className="sentence-bump-text">
                    <span className="sentence-bump-hanzi">{n.hanzi}</span>
                    {n.pinyin && <span className="sentence-bump-pinyin">{n.pinyin}</span>}
                    {n.english && <span className="sentence-bump-english">{n.english}</span>}
                  </span>
                  {on && <span className="sentence-bump-on" title="Already in today’s study">⚡</span>}
                </label>
              </li>
            );
          })}
        </ul>
        <div className="modal-actions sheet-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary sentence-bump-add"
            onClick={add}
            disabled={busy || chosen.length === 0}
            data-testid="sentence-bump-add"
          >
            {addToTodayLabel(chosen.length)}
          </button>
        </div>
      </div>
    </div>
  );
}
