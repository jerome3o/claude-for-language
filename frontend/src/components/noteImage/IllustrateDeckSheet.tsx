import { useEffect, useRef, useState } from 'react';
import { illustrateProgressLabel } from '@shared/cards/note-image';
import { track } from '../../services/analytics';
import { getDeckIllustrate, setIllustrateNew, startIllustrateDeck, type DeckIllustrateStatus } from '../../services/noteImages';
import './noteImage.css';

const POLL_MS = 3000;

/**
 * "🖼 Illustrate this deck": the cost first ("24 pictures · about $1.68"), then one picture per card
 * without one, drawn in the background (progress while the sheet is open — closing it never stops
 * them), and the deck's "Illustrate new cards" switch (off by default: each picture costs money).
 */
export function IllustrateDeckSheet({
  deckId,
  title,
  onClose,
  onProgress,
}: {
  deckId: string;
  title: string;
  onClose: () => void;
  /** Called when more pictures are ready (refresh the deck / sync). */
  onProgress?: () => void;
}) {
  const [status, setStatus] = useState<DeckIllustrateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastReady = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    getDeckIllustrate(deckId)
      .then((s) => { if (live) { setStatus(s); lastReady.current = s.with_image; } })
      .catch((e) => live && setError(navigator.onLine ? (e instanceof Error ? e.message : 'Could not load the deck') : 'You are offline — pictures need a connection'));
    return () => { live = false; };
  }, [deckId]);

  // Poll while pictures are being drawn.
  const drawing = (status?.pending ?? 0) > 0;
  useEffect(() => {
    if (!drawing) return;
    const t = window.setTimeout(() => {
      getDeckIllustrate(deckId).then((s) => {
        setStatus(s);
        if (lastReady.current !== null && s.with_image > lastReady.current) onProgress?.();
        lastReady.current = s.with_image;
      }).catch(() => {});
    }, POLL_MS);
    return () => window.clearTimeout(t);
  }, [drawing, status, deckId, onProgress]);

  const start = async () => {
    if (!status) return;
    setBusy(true);
    setError(null);
    try {
      const res = await startIllustrateDeck(deckId);
      track('deck.illustrate', { pictures: res.pending + res.ready });
      setStatus(res.status);
      // More pictures than before: refresh the deck. `ready` counts only pictures that already
      // existed; one drawn during this request (a fast generator, E2E's inline fake) shows up as
      // with_image going up with nothing left pending — no poll would ever report it.
      const before = lastReady.current;
      lastReady.current = res.status.with_image;
      if (res.ready > 0 || (before !== null && res.status.with_image > before)) onProgress?.();
    } catch (e) {
      setError(navigator.onLine ? (e instanceof Error ? e.message : 'Could not start') : 'You are offline — pictures need a connection');
    } finally {
      setBusy(false);
    }
  };

  const toggleNew = async (on: boolean) => {
    if (!status) return;
    setStatus({ ...status, illustrate_new: on });
    try {
      await setIllustrateNew(deckId, on);
      track('deck.illustrate_new', { on });
    } catch (e) {
      setStatus({ ...status, illustrate_new: !on });
      setError(e instanceof Error ? e.message : 'Could not change it');
    }
  };

  const pct = status && status.total > 0 ? Math.round((status.with_image / status.total) * 100) : 0;

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal deck-check-sheet illustrate-sheet" role="dialog" aria-modal="true" aria-label="Illustrate this deck" onClick={(e) => e.stopPropagation()} data-testid="illustrate-sheet">
        <div className="modal-header">
          <h2 className="modal-title">🖼 Illustrate this deck</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="text-light" style={{ marginBottom: '0.5rem' }}>{status?.deck_name ?? title}</p>

        {!status && !error && <p className="text-light">Loading…</p>}

        {status && (
          <>
            <p className="deck-check-intro">
              A friendly picture of each card’s meaning — never any writing. It shows with the English when you write the Chinese, and on the answer side of the other cards. You can also put your own photo on any card (Edit card → Picture).
            </p>
            <p className="deck-check-summary" data-testid="illustrate-progress-label">{illustrateProgressLabel(status)}</p>
            <div className="illustrate-progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
            {drawing && <p className="text-light" role="status" style={{ fontSize: '0.85rem' }}>Drawing… you can close this — they keep coming in the background.</p>}
            {status.available ? (
              <p className="illustrate-estimate" data-testid="illustrate-estimate">{status.estimate.label}</p>
            ) : (
              <p className="text-light" data-testid="illustrate-unavailable">Pictures can’t be generated right now — you can still add your own photo to a card.</p>
            )}
            <label className="illustrate-toggle">
              <input type="checkbox" checked={status.illustrate_new} onChange={(e) => void toggleNew(e.target.checked)} disabled={!status.available} data-testid="illustrate-new-toggle" />
              <span>
                Illustrate new cards automatically
                <span className="text-light" style={{ display: 'block', fontSize: '0.8rem' }}>Each new card in this deck gets a picture (about the same price each).</span>
              </span>
            </label>
          </>
        )}

        {error && <div className="inline-error" role="alert"><span className="inline-error-text">{error}</span></div>}

        <div className="sheet-footer" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>{drawing ? 'Close' : 'Cancel'}</button>
          {status && status.available && status.estimate.pictures > 0 && (
            <button className="btn btn-primary" onClick={start} disabled={busy || !navigator.onLine} data-testid="illustrate-start">
              {busy ? 'Starting…' : `🖼 Draw ${status.estimate.pictures} picture${status.estimate.pictures === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
