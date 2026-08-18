import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  getSentenceCoverageStats,
  prefetchSentenceSets,
  type SentenceCoverageStats,
} from '../api/client';
import { getLocalSentenceSetStats, syncSentenceSets } from '../services/sentence-sets';
import { useNetwork } from '../contexts/NetworkContext';
import './SettingsPage.css';
import './SentenceCoveragePage.css';

/**
 * Where the example sentences are up to.
 *
 * Sets are generated in the background (queue on the server, topped up on
 * sync), which is invisible by design — this page is the window into it: how
 * many words have sentences, how many are still waiting, what failed, and a
 * button to push a batch through now.
 */

const POLL_INTERVAL_MS = 5000;
// ~10 minutes of polling. A job wedged in 'queued' would otherwise keep this
// page refetching forever in a background tab.
const MAX_POLLS = 120;

function pct(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(diff)) return iso;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function CoverageBar({
  label,
  value,
  total,
  hint,
  tone = 'primary',
}: {
  label: string;
  value: number;
  total: number;
  hint?: string;
  tone?: 'primary' | 'secondary';
}) {
  const percent = pct(value, total);
  return (
    <div className="coverage-bar">
      <div className="coverage-bar-head">
        <span className="coverage-bar-label">{label}</span>
        <span className="coverage-bar-value">
          <strong>{percent}%</strong> · {value.toLocaleString()} / {total.toLocaleString()}
        </span>
      </div>
      <div className="coverage-track">
        <div className={`coverage-fill coverage-fill-${tone}`} style={{ width: `${percent}%` }} />
      </div>
      {hint && <div className="coverage-bar-hint">{hint}</div>}
    </div>
  );
}

function JobsPanel({ jobs }: { jobs: SentenceCoverageStats['jobs'] }) {
  return (
    <div className="coverage-chips">
      <span className="coverage-chip coverage-chip-queued">
        <strong>{jobs.queued}</strong> in the queue
      </span>
      <span className="coverage-chip">
        <strong>{jobs.done}</strong> generated
      </span>
      {jobs.error > 0 && (
        <span className="coverage-chip coverage-chip-error">
          <strong>{jobs.error}</strong> failed
        </span>
      )}
      {jobs.stale_queued > 0 && (
        <span className="coverage-chip coverage-chip-warn">
          <strong>{jobs.stale_queued}</strong> stuck (will retry)
        </span>
      )}
      {jobs.exhausted > 0 && (
        <span className="coverage-chip coverage-chip-error">
          <strong>{jobs.exhausted}</strong> given up on
        </span>
      )}
    </div>
  );
}

export function SentenceCoveragePage() {
  const { isOnline } = useNetwork();
  const [status, setStatus] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const pollsRef = useRef(0);

  const statsQuery = useQuery({
    queryKey: ['sentence-coverage'],
    queryFn: getSentenceCoverageStats,
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs;
      const active = (jobs?.queued ?? 0) - (jobs?.stale_queued ?? 0);
      if (active <= 0) {
        pollsRef.current = 0;
        return false;
      }
      pollsRef.current += 1;
      return pollsRef.current > MAX_POLLS ? false : POLL_INTERVAL_MS;
    },
  });

  const localQuery = useQuery({
    queryKey: ['sentence-coverage-local'],
    queryFn: getLocalSentenceSetStats,
  });

  const stats = statsQuery.data;

  const handleGenerate = async (limit: number) => {
    setIsBusy(true);
    setStatus(`Queueing ${limit} words…`);
    try {
      const result = await prefetchSentenceSets([], limit);
      setStatus(
        result.queued === 0
          ? 'Nothing to queue — every word either has a set already or is waiting in the queue.'
          : `Queued ${result.queued} words. ${result.remaining.toLocaleString()} still without a set. ` +
            'Generating in the background — this page updates as they land.'
      );
      pollsRef.current = 0;
      await statsQuery.refetch();
    } catch (err) {
      setStatus(err instanceof Error ? `Failed: ${err.message}` : 'Failed to queue generation.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSync = async () => {
    setIsBusy(true);
    setStatus('Pulling new sentences down…');
    try {
      const { synced } = await syncSentenceSets();
      setStatus(
        synced === 0
          ? 'Already up to date on this device.'
          : `Pulled ${synced.toLocaleString()} sentences down to this device.`
      );
      await Promise.all([localQuery.refetch(), statsQuery.refetch()]);
    } catch (err) {
      setStatus(err instanceof Error ? `Sync failed: ${err.message}` : 'Sync failed.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="container coverage-page">
        <div className="coverage-header">
          <Link to="/settings" className="coverage-back">
            ← Settings
          </Link>
          <h1>Example Sentences</h1>
        </div>

        {statsQuery.isLoading && <p className="coverage-muted">Loading…</p>}

        {statsQuery.isError && (
          <div className="coverage-error">
            Couldn't load the overview{!isOnline ? " — you're offline." : '.'}
          </div>
        )}

        {stats && (
          <>
            <div className="settings-section">
              <h2>Coverage</h2>
              <p className="settings-section-desc">
                {stats.notes.total.toLocaleString()} words · {stats.cards.total.toLocaleString()}{' '}
                cards ({stats.cards.new.toLocaleString()} new, {stats.cards.learning.toLocaleString()}{' '}
                learning, {stats.cards.review.toLocaleString()} review,{' '}
                {stats.cards.relearning.toLocaleString()} relearning).
              </p>

              <CoverageBar
                label="Sentence on the card"
                value={stats.notes.with_clue}
                total={stats.notes.total}
                hint={`${stats.notes.with_clue_audio.toLocaleString()} of those have audio`}
              />
              <CoverageBar
                label="Full sentence set"
                value={stats.notes.with_set}
                total={stats.notes.total}
                tone="secondary"
                hint={
                  stats.notes.with_set > stats.notes.with_full_set
                    ? `${(stats.notes.with_set - stats.notes.with_full_set).toLocaleString()} of those came back short (fewer than 5 sentences)`
                    : undefined
                }
              />
              <CoverageBar
                label="Word audio"
                value={stats.notes.with_note_audio}
                total={stats.notes.total}
                hint="TTS for the word itself"
              />

              <div className="coverage-facts">
                <div>
                  <span className="coverage-fact-value">
                    {(stats.notes.total - stats.notes.with_set).toLocaleString()}
                  </span>
                  <span className="coverage-fact-label">words with no set</span>
                </div>
                <div>
                  <span className="coverage-fact-value">
                    {stats.sentences.total.toLocaleString()}
                  </span>
                  <span className="coverage-fact-label">sentences generated</span>
                </div>
                <div>
                  <span className="coverage-fact-value">
                    {(stats.sentences.total - stats.sentences.with_audio).toLocaleString()}
                  </span>
                  <span className="coverage-fact-label">missing audio</span>
                </div>
                <div>
                  <span className="coverage-fact-value">
                    {stats.sentences.with_explanation.toLocaleString()}
                  </span>
                  <span className="coverage-fact-label">breakdowns cached</span>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h2>Background generation</h2>
              <p className="settings-section-desc">
                Sets are written by a queue on the server — the app tops it up once an hour while
                syncing, and failing a card starts that word's set immediately. Use these to push a
                batch through now.
              </p>

              <JobsPanel jobs={stats.jobs} />

              <div className="coverage-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => handleGenerate(20)}
                  disabled={isBusy || !isOnline}
                  title={!isOnline ? 'Requires internet connection' : ''}
                >
                  Generate 20 now
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => handleGenerate(100)}
                  disabled={isBusy || !isOnline}
                  title={!isOnline ? 'Requires internet connection' : ''}
                >
                  Generate 100
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleSync}
                  disabled={isBusy || !isOnline}
                  title={!isOnline ? 'Requires internet connection' : ''}
                >
                  Sync to this device
                </button>
              </div>

              {status && <div className="coverage-status">{status}</div>}

              {localQuery.data && (
                <div className="coverage-local">
                  On this device: {localQuery.data.notes.toLocaleString()} words ·{' '}
                  {localQuery.data.sentences.toLocaleString()} sentences cached for offline study
                  {localQuery.data.last_sync
                    ? ` · last synced ${timeAgo(localQuery.data.last_sync)}`
                    : ' · never synced'}
                  .
                </div>
              )}
            </div>

            {stats.recent_errors.length > 0 && (
              <div className="settings-section">
                <h2>Failures</h2>
                <p className="settings-section-desc">
                  Words whose generation errored. Three attempts and a word is left alone; the rest
                  get picked up by a later sweep.
                </p>
                <div className="coverage-errors">
                  {stats.recent_errors.map((row) => (
                    <div key={row.note_id} className="coverage-error-row">
                      <div className="coverage-error-head">
                        <span className="coverage-error-hanzi">{row.hanzi}</span>
                        <span className="coverage-error-meta">
                          attempt {row.attempts} · {timeAgo(row.updated_at)}
                        </span>
                      </div>
                      {row.error && (
                        <div className="coverage-error-text" title={row.error}>
                          {row.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {stats.decks.length > 0 && (
              <div className="settings-section">
                <h2>By deck</h2>
                <p className="settings-section-desc">
                  Which decks are still waiting on sentences.
                </p>
                <div className="coverage-decks">
                  <div className="coverage-deck-row coverage-deck-head">
                    <span>Deck</span>
                    <span>Words</span>
                    <span>Card</span>
                    <span>Set</span>
                  </div>
                  {stats.decks.map((deck) => (
                    <Link
                      key={deck.id}
                      to={`/decks/${deck.id}`}
                      className="coverage-deck-row"
                    >
                      <span className="coverage-deck-name">{deck.name}</span>
                      <span>{deck.notes.toLocaleString()}</span>
                      <span>{pct(deck.with_clue, deck.notes)}%</span>
                      <span
                        className={
                          pct(deck.with_set, deck.notes) === 100 ? 'coverage-deck-done' : undefined
                        }
                      >
                        {pct(deck.with_set, deck.notes)}%
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
