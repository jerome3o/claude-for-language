import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CharWordStatus } from '@shared/chars';
import { sourceDeckForExplorer } from '@shared/decks/source-decks';
import { track, trackError } from '../../services/analytics';
import { invalidateKnownHanzi } from '../../services/readerWords';
import { addCardToSourceDeck, type AddedToDeck } from '../../services/sourceDecks';
import type { Chunk } from '../AddChunkModal';
import { BumpButton } from '../bumps/BumpButton';
import { AddedToDeckLine } from '../sourceDecks/AddedToDeckLine';
import { useExplorer } from './ExplorerContext';

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
 * ⚡ Study it today, or "+ Add as card" — ONE tap, no deck picker: the card goes straight into the
 * source deck of where the explorer was opened (a reader → "From readers", a chat → "From chats",
 * else "From the explorer"; shared/decks/source-decks.ts) and the footer says "✓ Added to … ·
 * Change". The Word view's pinned footer and the Character view's status block are both this.
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
  const explorer = useExplorer();
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // What "+ Add" just made: the note isn't in this device's store until the sync it starts
  // finishes, so the footer offers ⚡ Study it today / Open card for it straight away (before,
  // "✓ Added" was all — Jerome closed and reopened the explorer until the card showed up).
  const [added, setAdded] = useState<(AddedToDeck & { noteId: string; hanzi: string }) | null>(null);
  const [bumpMsg, setBumpMsg] = useState<string | null>(null);

  async function add() {
    const c: Chunk = chunk();
    const key = sourceDeckForExplorer(explorer.source);
    setAdding(true);
    setAddError(null);
    try {
      const out = await addCardToSourceDeck(key, c, 'explorer');
      track('explorer.add_card', { kind, source_deck: true, deck_key: key });
      invalidateKnownHanzi();
      setAdded({ ...out, hanzi: c.hanzi });
    } catch (e) {
      trackError('add_card', e);
      setAddError(e instanceof Error ? e.message : "Couldn't add it — try again.");
    } finally {
      setAdding(false);
    }
  }

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
          <AddedToDeckLine added={added} surface="explorer" onMoved={(now) => setAdded({ ...added, ...now })} className="xp-added-line" />
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
        <>
          {addError && <div className="xp-have-line xp-add-error" role="alert">{addError}</div>}
          <button type="button" className="btn btn-primary xp-add" onClick={() => void add()} disabled={adding} data-testid={testIds.add}>
            {adding ? 'Adding…' : addError ? 'Try again' : addLabel}
          </button>
        </>
      )}
    </div>
  );
}
