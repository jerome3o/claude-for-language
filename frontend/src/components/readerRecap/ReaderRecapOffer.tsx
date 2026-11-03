import { useNavigate } from 'react-router-dom';
import { recapPromptLabel } from '@shared/study/wordRecap';
import { offerRecap, useRecapOffer } from '../../services/wordRecap';
import { track } from '../../services/analytics';
import './ReaderRecap.css';

/**
 * "Story finished ✓ — 📝 Recap N words · Done": offered once a story is finished (any reading view)
 * when the reading collected words (taps, read-aloud mistakes). It sits over whatever comes next —
 * the session's next card, the homework pass's end, the Readers list — and is never forced: Done (or
 * ✕) closes it, and the recap stays on the Readers list ("📝 Recap words from last read").
 */
export function ReaderRecapOffer() {
  const offer = useRecapOffer();
  const navigate = useNavigate();
  if (!offer) return null;
  const start = () => {
    offerRecap(null);
    track('reader.word_recap_start', { from: 'finish', words: offer.words });
    navigate(`/readers/${encodeURIComponent(offer.readerId)}/recap`);
  };
  return (
    <div className="recap-offer" role="dialog" aria-label="Recap the words from this story" data-testid="recap-offer">
      <div className="recap-offer-card">
        <div className="recap-offer-head">
          <span className="recap-offer-title">Story finished ✓</span>
          <button type="button" className="recap-offer-close" onClick={() => offerRecap(null)} aria-label="Close">✕</button>
        </div>
        {offer.line && <p className="recap-offer-line">{offer.line}</p>}
        <div className="recap-offer-actions">
          <button type="button" className="btn btn-secondary" onClick={() => offerRecap(null)} data-testid="recap-offer-done">Done</button>
          <button type="button" className="btn btn-primary" onClick={start} data-testid="recap-offer-start">{recapPromptLabel(offer.words)}</button>
        </div>
      </div>
    </div>
  );
}
