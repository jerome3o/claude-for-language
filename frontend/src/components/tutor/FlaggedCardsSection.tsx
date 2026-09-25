import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listCardFlags } from '../../api/cardFlags';
import { CardFlagsList } from '../cardFlags/CardFlagsList';

/**
 * "Flagged cards" on the tutor's student page and "Cards you flagged" on the
 * student's tutor page: open flags first; resolved ones behind a toggle.
 */
export function FlaggedCardsSection({ relId, role }: { relId: string; role: 'tutor' | 'student' }) {
  const [showResolved, setShowResolved] = useState(false);
  const flagsQuery = useQuery({
    queryKey: ['card-flags', relId],
    queryFn: () => listCardFlags(relId, 'all'),
    staleTime: 30_000,
  });
  const flags = flagsQuery.data?.flags ?? [];
  const open = flags.filter((f) => f.status === 'open');
  const resolved = flags.filter((f) => f.status !== 'open');

  return (
    <section className="detail-section" id="flags" data-testid="flagged-cards-section">
      <h2>🚩 {role === 'tutor' ? 'Flagged cards' : 'Cards you flagged'}{open.length > 0 ? ` (${open.length})` : ''}</h2>
      {flagsQuery.isLoading && <div className="cf-empty">Loading…</div>}
      {flagsQuery.isError && <div className="td-error">Could not load the flagged cards</div>}
      {flagsQuery.data && (
        <>
          <CardFlagsList
            flags={open}
            role={role}
            relId={role === 'tutor' ? relId : null}
            emptyText={
              role === 'tutor'
                ? 'Nothing flagged right now. When the student flags a card during study (⋯ → Flag for tutor) it shows up here.'
                : 'Nothing waiting. On the back of a card during study, ⋯ → Flag for tutor sends a note with a link to that card.'
            }
          />
          {resolved.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <button type="button" className="btn-link" onClick={() => setShowResolved((v) => !v)}>
                {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved
              </button>
              {showResolved && (
                <div style={{ marginTop: '0.5rem' }}>
                  <CardFlagsList flags={resolved} role={role} relId={role === 'tutor' ? relId : null} />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
