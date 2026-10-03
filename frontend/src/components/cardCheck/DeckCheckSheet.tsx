import { useEffect, useMemo, useState } from 'react';
import { deckCheckSummary, type DeckCheckJob } from '@shared/cards/check';
import {
  applyDeckCheck,
  getDeckCheck,
  getDeckCheckInfo,
  startDeckCheck,
  type DeckCheckInfo,
  type DeckCheckTarget,
} from '../../api/cardChecks';
import { track } from '../../services/analytics';
import './cardCheck.css';

const POLL_MS = 2000;

/**
 * "Check for errors" on one deck: the cost estimate first, then Claude checks
 * every word in batches (progress), then the review list — current → proposed,
 * why, a checkbox each — and "Apply selected" (through the content service).
 * Nothing changes until then. For a tutor checking the student's copy of a
 * homework deck she sent, "Also fix my source deck" applies the same fixes to
 * her own deck.
 */
export function DeckCheckSheet({
  target,
  title,
  onClose,
  onApplied,
}: {
  target: DeckCheckTarget;
  /** "Lesson 8" / "Jerome's copy of Lesson 8" */
  title: string;
  onClose: () => void;
  /** After fixes were applied (refresh the deck). */
  onApplied?: (count: number) => void;
}) {
  const [info, setInfo] = useState<DeckCheckInfo | null>(null);
  const [job, setJob] = useState<DeckCheckJob | null>(null);
  const [fresh, setFresh] = useState(false); // show the intro even though an old job exists
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [alsoSource, setAlsoSource] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [failed, setFailed] = useState<Array<{ hanzi: string; error: string }>>([]);
  const scope = target.kind === 'own' ? 'own' : 'student';

  useEffect(() => {
    let live = true;
    getDeckCheckInfo(target)
      .then(i => {
        if (!live) return;
        setInfo(i);
        const j = i.job;
        // Reopen a check still running, or finished with fixes left to review.
        if (j && (j.status === 'queued' || j.status === 'running' || (j.status === 'done' && j.proposals.some(p => !p.applied)))) setJob(j);
      })
      .catch(e => live && setError(e instanceof Error ? e.message : 'Could not load the deck'));
    return () => {
      live = false;
    };
  }, [target]);

  // Poll while the check runs.
  const running = job?.status === 'queued' || job?.status === 'running';
  useEffect(() => {
    if (!job || !running) return;
    const t = window.setTimeout(() => {
      getDeckCheck(job.id).then(setJob).catch(() => {});
    }, POLL_MS);
    return () => window.clearTimeout(t);
  }, [job, running]);

  // Select every open proposal when results arrive.
  const openIds = useMemo(() => (job?.status === 'done' ? job.proposals.filter(p => !p.applied).map(p => p.id) : []), [job]);
  useEffect(() => {
    setSelected(new Set(openIds));
  }, [openIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const j = await startDeckCheck(target);
      track('deck.check_started', { words: j.total, scope });
      setJob(j);
      setFresh(false);
    } catch (e) {
      setError(navigator.onLine ? (e instanceof Error ? e.message : 'Could not start the check') : 'You are offline — the check needs a connection');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!job || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await applyDeckCheck(job.id, [...selected], !!info?.can_fix_source && alsoSource);
      setJob(res.job);
      const n = res.applied.length;
      track('deck.check_applied', { count: n, source: res.source_applied.length > 0, scope });
      setFailed(res.failed.map(f => ({ hanzi: res.job.proposals.find(p => p.id === f.id)?.hanzi ?? '', error: f.error })));
      setDone(n ? `Fixed ${n} word${n === 1 ? '' : 's'}${res.source_applied.length ? ` (and ${res.source_applied.length} in your deck)` : ''}` : null);
      if (n) onApplied?.(n);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply the fixes');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setSelected(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const showIntro = !job || fresh;
  const pct = job && job.total ? Math.round((job.checked / job.total) * 100) : 0;

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose} role="presentation">
      <div className="modal deck-check-sheet" role="dialog" aria-modal="true" aria-label="Check for errors" onClick={e => e.stopPropagation()} data-testid="deck-check-sheet">
        <div className="modal-header">
          <h2 className="modal-title">🔎 Check for errors</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close" disabled={busy}>
            ×
          </button>
        </div>
        <p className="text-light" style={{ marginBottom: '0.5rem' }}>{info?.deck_name ?? title}</p>

        {!info && !error && <p className="text-light">Loading…</p>}

        {info && showIntro && (
          <>
            <p className="deck-check-intro">
              Claude reads every word’s pinyin and English and lists likely mistakes — wrong tones, a missing 一/不 tone change, the wrong reading of a character, a misleading meaning. Nothing changes until you apply it.
            </p>
            <p className="deck-check-estimate" data-testid="deck-check-estimate">{info.estimate.label}</p>
          </>
        )}

        {job && !showIntro && (
          <>
            <p className="deck-check-summary" data-testid="deck-check-summary">{deckCheckSummary(job)}</p>
            {running && (
              <div className="deck-check-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${Math.max(4, pct)}%` }} />
              </div>
            )}
            {job.status === 'failed' && <p className="check-issue-error">{job.error ?? 'The check stopped'} — try again.</p>}
            {job.status === 'done' && job.proposals.length > 0 && (
              <ul className="deck-check-list" data-testid="deck-check-list">
                {job.proposals.map(p => (
                  <li key={p.id} className={`deck-check-row${p.applied ? ' applied' : ''}`} data-testid="deck-check-row">
                    {p.applied ? (
                      <span className="deck-check-applied" aria-label="Applied">✓</span>
                    ) : (
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Fix ${p.hanzi}`} disabled={busy} />
                    )}
                    <div className="deck-check-row-main">
                      <div>
                        <span className="deck-check-row-hanzi">{p.hanzi}</span>
                        <span className="deck-check-row-field">{p.field === 'pinyin' ? 'Pinyin' : 'Meaning'}</span>
                      </div>
                      <div className="check-issue-change">
                        <span className="check-issue-current">{p.current}</span>
                        <span aria-hidden="true">→</span>
                        <span className="check-issue-proposed">{p.proposed}</span>
                      </div>
                      <div className="check-issue-reason">{p.reason}</div>
                      {p.applied && <div className="deck-check-applied">Applied{p.source_applied ? ' · also in your deck' : ''}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {job.status === 'done' && (
              <button type="button" className="deck-check-link" onClick={() => setFresh(true)} disabled={busy}>
                Check again
              </button>
            )}
          </>
        )}

        {done && <p className="deck-check-summary" role="status" data-testid="deck-check-done">✓ {done}</p>}
        {failed.length > 0 && (
          <ul className="check-issue-error">
            {failed.map((f, i) => (
              <li key={i}>
                {f.hanzi}: {f.error}
              </li>
            ))}
          </ul>
        )}
        {error && <p className="check-issue-error" role="alert">{error}</p>}

        <div className="sheet-footer deck-check-footer-wrap">
          {job?.status === 'done' && !showIntro && info?.can_fix_source && openIds.length > 0 && (
            <label className="deck-check-source">
              <input type="checkbox" checked={alsoSource} onChange={e => setAlsoSource(e.target.checked)} disabled={busy} />
              <span>Also fix my source deck</span>
            </label>
          )}
          <div className="deck-check-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              {job?.status === 'done' && openIds.length === 0 ? 'Done' : 'Close'}
            </button>
            {info && showIntro && (
              <button type="button" className="btn btn-primary" onClick={() => void start()} disabled={busy || info.estimate.words === 0} data-testid="deck-check-start">
                {busy ? 'Starting…' : `Check ${info.estimate.words} word${info.estimate.words === 1 ? '' : 's'}`}
              </button>
            )}
            {job?.status === 'failed' && !showIntro && (
              <button type="button" className="btn btn-primary" onClick={() => void start()} disabled={busy}>
                Try again
              </button>
            )}
            {job?.status === 'done' && !showIntro && openIds.length > 0 && (
              <button type="button" className="btn btn-primary" onClick={() => void apply()} disabled={busy || selected.size === 0} data-testid="deck-check-apply">
                {busy ? 'Applying…' : `Apply selected (${selected.size})`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
