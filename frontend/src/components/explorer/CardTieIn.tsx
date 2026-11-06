import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { CharWordStatus } from '@shared/chars';
import { track } from '../../services/analytics';
import { invalidateKnownHanzi } from '../../services/readerWords';
import { AddChunkModal, type AddedCard } from '../AddChunkModal';
import { BumpButton } from '../bumps/BumpButton';

type Chunk = Parameters<typeof AddChunkModal>[0]['chunk'];

/** What the learner has of this word / character: null = still reading this device's cards. */
export interface CardTieInHave {
  /** Their notes with this spelling (empty = none). */
  noteIds: string[];
  /** "📚 You have this card in HSK 2" / "✓ Known — you have 性 as a card in HSK 5". */
  line: string;
  status?: CharWordStatus;
}

/**
 * The explorer's card tie-in (docs/LANGUAGE_EXPLORER.md): "📚 You have …" → Open card → /
 * ⚡ Study it today, or "+ Add as card" (the add-card sheet over the explorer). The Word view's
 * pinned footer and the Character view's status block under the glyph are both this.
 */
export function CardTieIn({
  kind,
  have,
  addLabel,
  chunk,
  onClose,
  testIds,
  className = 'xp-footer',
}: {
  kind: 'word' | 'char';
  have: CardTieInHave | null;
  addLabel: string;
  /** What "+ Add" pre-fills (built when tapped, so it has the latest pinyin / meaning). */
  chunk: () => Chunk;
  /** Close the explorer (Open card navigates away). */
  onClose: () => void;
  testIds: { root: string; checking: string; add: string };
  className?: string;
}) {
  const navigate = useNavigate();
  const [adding, setAdding] = useState<Chunk | null>(null);
  // What "+ Add" just made: the note isn't in this device's store until the sync it starts
  // finishes, so the footer offers ⚡ Study it today / Open card for it straight away (before,
  // "✓ Added" was all — Jerome closed and reopened the explorer until the card showed up).
  const [added, setAdded] = useState<AddedCard | null>(null);
  const [bumpMsg, setBumpMsg] = useState<string | null>(null);

  return (
    <div className={className} data-testid={testIds.root} data-status={have ? (have.noteIds.length ? have.status ?? 'in_decks' : 'none') : 'checking'}>
      {have === null ? (
        // Still reading this device's cards: a quiet placeholder — never nothing, never a
        // "+ Add" for something they already have.
        <div className="xp-have-line xp-checking" role="status" data-testid={testIds.checking}>📚 Checking your cards…</div>
      ) : have.noteIds.length > 0 ? (
        <div className={`xp-have${have.status === 'known' ? ' xp-have--known' : ''}`}>
          <div className="xp-have-line">{have.line}</div>
          {bumpMsg && <div className="bump-hint" role="status">{bumpMsg}</div>}
          <div className="xp-footer-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                onClose();
                navigate(`/cards/${have.noteIds[0]}`);
              }}
            >
              Open card →
            </button>
            <BumpButton
              noteIds={have.noteIds}
              source="explorer"
              label="⚡ Study it today"
              onBumped={(m) => {
                track('explorer.bump', { kind });
                setBumpMsg(m);
              }}
            />
          </div>
        </div>
      ) : added ? (
        <div className="xp-have" data-testid="xp-added">
          <div className="xp-have-line" role="status">✓ Added to {added.deckName}</div>
          {bumpMsg && <div className="bump-hint" role="status">{bumpMsg}</div>}
          <div className="xp-footer-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                onClose();
                navigate(`/cards/${added.noteId}`);
              }}
            >
              Open card →
            </button>
            <BumpButton
              noteIds={[added.noteId]}
              source="explorer"
              label="⚡ Study it today"
              hanziById={new Map([[added.noteId, added.hanzi]])}
              onBumped={(m) => {
                track('explorer.bump', { kind, just_added: true });
                setBumpMsg(m);
              }}
            />
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-primary xp-add" onClick={() => setAdding(chunk())} data-testid={testIds.add}>
          {addLabel}
        </button>
      )}

      {adding &&
        createPortal(
          // Its own layer above the explorer sheet (the add sheet's backdrop has a low z-index).
          <div className="xp-modal-layer" onClick={(e) => e.stopPropagation()}>
            <AddChunkModal
              source="explorer"
              chunk={adding}
              onAdded={(card) => {
                track('explorer.add_card', { kind });
                invalidateKnownHanzi();
                setAdded(card);
              }}
              onClose={() => setAdding(null)}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
