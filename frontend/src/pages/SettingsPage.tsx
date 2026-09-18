import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE, getAuthHeaders, getFeatureRequests, getFeatureRequest, addFeatureRequestComment, getUserBio, updateUserBio, updateLandingPage } from '../api/client';
import type { FeatureRequest, FeatureRequestComment } from '../api/client';
import { getAudioCacheStats } from '../services/audioCache';
import { saveBlobAs } from '../utils/download';
import { prefetchAllAudio, checkAudioCoverage, useAudioPrefetchProgress } from '../services/audioPrefetch';
import { getAudioQuality, classifyAudio, regenerateFallbackAudio } from '../api/client';
import type { AudioQualityStats } from '../api/client';
import { useNetwork } from '../contexts/NetworkContext';
import { useAuth } from '../contexts/AuthContext';
import { useNavRole } from '../components/nav/useNavRole';
import { useMaintenanceActions } from '../components/nav/useMaintenanceActions';
import { NavRow } from './MorePage';
import type { LandingPage } from '../types';
import {
  getAudioRecords,
  clearAudioRecords,
  summarize,
  buildAudioDiagnosticsReport,
} from '../utils/audioDiagnostics';
import { copyTextToClipboard } from '../utils/clipboard';
import './MorePage.css';
import './SettingsPage.css';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  in_progress: 'In Progress',
  agent_working: 'Agent Working',
  done: 'Done',
  declined: 'Declined',
};

function FeatureRequestDetail({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const [request, setRequest] = useState<FeatureRequest | null>(null);
  const [comments, setComments] = useState<FeatureRequestComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadDetail = useCallback(async () => {
    try {
      const data = await getFeatureRequest(requestId);
      setRequest(data.request);
      setComments(data.comments);
    } catch (err) {
      console.error('Failed to load feature request:', err);
    }
  }, [requestId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  const handleAddComment = async () => {
    if (!newComment.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await addFeatureRequestComment(requestId, newComment.trim());
      setNewComment('');
      loadDetail();
    } catch (err) {
      console.error('Failed to add comment:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!request) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal feature-request-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Feature Request</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="feature-request-content">{request.content}</div>

        <div className="feature-request-meta">
          <span className={`feature-request-status status-${request.status}`}>
            {STATUS_LABELS[request.status] || request.status}
          </span>
          <span>{timeAgo(request.created_at)}</span>
          {request.page_context && <span>from {request.page_context}</span>}
        </div>

        {request.screenshot_url && (
          <div style={{ marginTop: '0.75rem' }}>
            <a href={`${API_BASE}${request.screenshot_url}`} target="_blank" rel="noopener noreferrer">
              <img
                src={`${API_BASE}${request.screenshot_url}`}
                alt="Screenshot"
                style={{ maxWidth: '100%', border: '1px solid var(--border-color, #ccc)', borderRadius: 4 }}
              />
            </a>
          </div>
        )}

        {comments.length > 0 && (
          <div className="feature-request-comments">
            <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>Comments</h3>
            {comments.map((c) => (
              <div key={c.id} className="feature-request-comment">
                <div className="feature-request-comment-author">
                  {c.author_name} · {timeAgo(c.created_at)}
                </div>
                <div className="feature-request-comment-content">{c.content}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: '1rem' }}>
          <textarea
            className="feedback-textarea"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment..."
            rows={2}
            disabled={isSubmitting}
          />
          <div className="feedback-actions">
            <button
              className="btn btn-primary"
              onClick={handleAddComment}
              disabled={!newComment.trim() || isSubmitting}
            >
              {isSubmitting ? 'Sending...' : 'Comment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One status line. Audio downloads itself after every sync (see
 * services/audioPrefetch.ts); this only says how far along that is and offers
 * "Download now" when something is still missing.
 */
function OfflineAudioLine() {
  const { isOnline } = useNetwork();
  const progress = useAudioPrefetchProgress();
  const [deviceCount, setDeviceCount] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    getAudioCacheStats().then((s) => setDeviceCount(s.count)).catch(() => setDeviceCount(0));
  }, [progress.status]);

  // Ask the server what we should have (needs a connection; silent otherwise)
  useEffect(() => {
    checkAudioCoverage().finally(() => setChecked(true));
  }, []);

  const isDownloading = progress.status === 'running';
  const haveManifest = progress.manifestTotal > 0;
  const missing = haveManifest ? Math.max(0, progress.manifestTotal - progress.cachedCount) : 0;

  let text: string;
  if (isDownloading) {
    text = `Audio for your words: downloading… ${progress.done}/${progress.total}`;
  } else if (haveManifest) {
    text = `Audio for your words: ${progress.cachedCount} of ${progress.manifestTotal} clips on this device${missing === 0 ? ' ✓' : ''}`;
  } else if (deviceCount !== null && checked) {
    text = `Audio for your words: ${deviceCount} clip${deviceCount === 1 ? '' : 's'} on this device`;
  } else {
    text = 'Audio for your words: checking…';
  }

  return (
    <div className="settings-section settings-audio-line" data-testid="offline-audio">
      <span>{text}</span>
      {!isDownloading && missing > 0 && (
        <button
          type="button"
          className="settings-link-btn"
          onClick={() => { prefetchAllAudio({ force: true }); }}
          disabled={!isOnline}
          title={!isOnline ? 'Requires internet connection' : ''}
        >
          Download now
        </button>
      )}
      {progress.status === 'done' && progress.failed > 0 && (
        <span className="settings-audio-warn">{progress.failed} failed — will retry on the next sync.</span>
      )}
    </div>
  );
}

/**
 * Which TTS provider made the stored clips. The Google fallback is a different
 * voice at half the bitrate with time-stretched slow speech — the "crunchy"
 * audio — so this counts those clips, classifies the ones stored before the
 * provider was recorded, and queues their replacement.
 */
function AudioQualityPanel() {
  const { isOnline } = useNetwork();
  const [stats, setStats] = useState<AudioQualityStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'classify' | 'regenerate' | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStats(await getAudioQuality());
      setLoadError(null);
    } catch (err) {
      // Say so rather than sitting on "Loading…" forever.
      setStats(null);
      setLoadError(err instanceof Error ? err.message : 'Could not load audio quality');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const total = (pick: (c: AudioQualityStats['notes']) => number) =>
    stats ? pick(stats.notes) + pick(stats.clues) + pick(stats.sentences) : 0;
  const fallback = total((c) => c.gtts);
  const unknown = total((c) => c.unknown);
  const good = total((c) => c.minimax);

  const handleClassify = async () => {
    setBusy('classify');
    setStatus('Checking clips…');
    let checked = 0;
    let found = 0;
    try {
      // Bounded per call; keep going until the server says nothing is left.
      for (let round = 0; round < 200; round++) {
        const result = await classifyAudio(300);
        checked += result.classified;
        found += result.found_fallback;
        setStatus(`Checked ${checked} clips, ${found} are fallback audio…`);
        if (!result.remaining || result.classified === 0) break;
      }
      setStatus(`Checked ${checked} clips — ${found} are low-quality fallback audio.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Check failed');
    } finally {
      setBusy(null);
      load();
    }
  };

  const handleRegenerate = async () => {
    setBusy('regenerate');
    setStatus('Queueing…');
    let queued = 0;
    try {
      for (let round = 0; round < 50; round++) {
        const result = await regenerateFallbackAudio(250);
        queued += result.queued;
        setStatus(`Queued ${queued} clips for regeneration…`);
        if (result.queued === 0 || result.remaining <= queued) break;
      }
      setStatus(
        `Queued ${queued} clips. They regenerate in the background over the next while; ` +
        'new audio arrives on the next sync and downloads automatically.'
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not queue regeneration');
    } finally {
      setBusy(null);
      load();
    }
  };

  return (
    <div className="settings-section">
      <h2>Audio Quality</h2>
      <p className="settings-section-desc" style={{ marginBottom: '0.5rem' }}>
        Clips are normally generated by MiniMax. When it was rate-limited, some
        fell back to Google — a different voice at half the quality that sounds
        crunchy. Those can be found and regenerated here.
      </p>

      {stats === null ? (
        <p style={{ fontSize: '0.85rem', color: loadError ? '#b45309' : 'var(--color-text-light)' }}>
          {!isOnline ? 'Requires internet connection.' : loadError ?? 'Loading…'}
        </p>
      ) : (
        <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          <strong>{fallback}</strong> low-quality fallback clip{fallback === 1 ? '' : 's'},{' '}
          {good} good, {unknown} not yet checked.
          {' '}<span style={{ color: 'var(--color-text-light)' }}>
            (words {stats.notes.gtts}, card sentences {stats.clues.gtts}, sentence sets {stats.sentences.gtts})
          </span>
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          className="btn btn-secondary"
          onClick={handleClassify}
          disabled={busy !== null || !isOnline || unknown === 0}
          title={unknown === 0 ? 'Every clip has been checked' : ''}
        >
          {busy === 'classify' ? 'Checking…' : `Check ${unknown} Unchecked Clips`}
        </button>
        <button
          className="btn btn-primary"
          onClick={handleRegenerate}
          disabled={busy !== null || !isOnline || fallback === 0}
          title={fallback === 0 ? 'No fallback clips to regenerate' : ''}
        >
          {busy === 'regenerate' ? 'Queueing…' : `Regenerate ${fallback} Clips`}
        </button>
      </div>

      {status && (
        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-light)', marginTop: '0.5rem' }}>
          {status}
        </div>
      )}
    </div>
  );
}

/**
 * Playback quality report. Every clip is measured as it plays (see
 * utils/audioDiagnostics.ts); this surfaces the tally and copies the detail
 * out, so "the audio sounds choppy" can be handed over as numbers.
 */
function AudioDiagnosticsPanel() {
  const [status, setStatus] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Re-read on mount and whenever the user acts; records accumulate while
  // studying, so a stale count here would be misleading.
  const records = useMemo(() => getAudioRecords(), [tick]);
  const summary = useMemo(() => summarize(records), [records]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(id);
  }, []);

  const handleCopy = async () => {
    const report = buildAudioDiagnosticsReport();
    if (await copyTextToClipboard(report)) {
      setStatus(`Copied ${records.length} clips (${(report.length / 1024).toFixed(1)} KB). Paste it into the Claude chat.`);
      return;
    }
    console.log('[audioDiagnostics]', report);
    setStatus('Could not access the clipboard — printed to the debug console instead.');
  };

  const handleClear = () => {
    clearAudioRecords();
    setTick((t) => t + 1);
    setStatus('Cleared. Play some cards, then copy the report.');
  };

  return (
    <div className="settings-section">
      <h2>Playback Quality</h2>
      <p className="settings-section-desc" style={{ marginBottom: '0.5rem' }}>
        If audio sounds choppy, clear this, play the cards that sound bad, then
        copy the report and paste it into the Claude chat.
      </p>

      {records.length === 0 ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-light)' }}>
          No clips measured yet.
        </p>
      ) : (
        <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          {summary.clips} clips measured — <strong>{summary.choppy_clips} choppy</strong>
          {summary.truncated_clips > 0 ? `, ${summary.truncated_clips} cut short` : ''}
          {summary.errored > 0 ? `, ${summary.errored} failed` : ''}.
          {' '}{summary.from_network} of {summary.clips} streamed instead of playing from the cache.
          {summary.low_bitrate_clips > 0
            ? ` ${summary.low_bitrate_clips} played low-quality fallback audio — see Audio Quality above.`
            : ''}
          {summary.worst_gap_ms > 0 ? ` Worst gap ${summary.worst_gap_ms} ms.` : ''}
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" onClick={handleCopy} disabled={records.length === 0}>
          Copy Audio Report
        </button>
        <button className="btn btn-secondary" onClick={handleClear}>
          Clear
        </button>
      </div>

      {status && (
        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-light)', marginTop: '0.5rem' }}>
          {status}
        </div>
      )}
    </div>
  );
}

function FeatureRequestsSection() {
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    try {
      const data = await getFeatureRequests();
      setRequests(data);
    } catch (err) {
      console.error('Failed to load feature requests:', err);
    }
  }, []);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  return (
    <div className="settings-section">
      <h2>Feature Requests</h2>
      <p className="settings-section-desc">
        Your submitted feedback and feature requests. Use the 💬 button to submit new ones from anywhere in the app.
      </p>

      {requests.length === 0 ? (
        <p style={{ color: 'var(--color-text-light)', fontSize: '0.9rem' }}>
          No feature requests yet. Use the 💬 button in the bottom-right corner to submit feedback.
        </p>
      ) : (
        <div className="feature-requests-list">
          {requests.map((req) => (
            <div
              key={req.id}
              className="feature-request-card"
              onClick={() => setSelectedRequestId(req.id)}
            >
              <div className="feature-request-header">
                <span className={`feature-request-status status-${req.status}`}>
                  {STATUS_LABELS[req.status] || req.status}
                </span>
              </div>
              <div className="feature-request-content">
                {req.content.length > 150 ? req.content.slice(0, 150) + '...' : req.content}
              </div>
              <div className="feature-request-meta">
                <span>{timeAgo(req.created_at)}</span>
                {req.comment_count > 0 && <span>{req.comment_count} comment{req.comment_count !== 1 ? 's' : ''}</span>}
                {req.page_context && <span>from {req.page_context}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedRequestId && (
        <FeatureRequestDetail
          requestId={selectedRequestId}
          onClose={() => { setSelectedRequestId(null); loadRequests(); }}
        />
      )}
    </div>
  );
}

const LANDING_OPTIONS: { value: LandingPage | ''; label: string; tutorOnly?: boolean }[] = [
  { value: '', label: 'Automatic' },
  { value: 'study', label: 'Study' },
  { value: 'students', label: 'Students', tutorOnly: true },
  { value: 'decks', label: 'Decks' },
];

function StartOnSection({ hasStudents }: { hasStudents: boolean }) {
  const { user, refreshUser } = useAuth();
  const [value, setValue] = useState<LandingPage | ''>(user?.landing_page ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setValue(user?.landing_page ?? ''); }, [user?.landing_page]);

  const choose = async (next: LandingPage | '') => {
    const prev = value;
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      await updateLandingPage(next === '' ? null : next);
      await refreshUser();
    } catch (err) {
      setValue(prev);
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-section" data-testid="start-on">
      <h2>Start on</h2>
      <p className="settings-section-desc">
        Automatic opens Students when you have students and nothing due today, otherwise Study.
      </p>
      <div className="settings-segmented" role="radiogroup" aria-label="Start on">
        {LANDING_OPTIONS.filter((o) => !o.tutorOnly || hasStudents || value === 'students').map((o) => (
          <button
            key={o.value || 'auto'}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={`settings-segment${value === o.value ? ' selected' : ''}`}
            onClick={() => choose(o.value)}
            disabled={saving}
          >
            {o.label}
          </button>
        ))}
      </div>
      {error && <div className="export-error">{error}</div>}
    </div>
  );
}

export function SettingsPage() {
  const { logout } = useAuth();
  const role = useNavRole();
  const maintenance = useMaintenanceActions();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [bioSaved, setBioSaved] = useState('');
  const [isSavingBio, setIsSavingBio] = useState(false);
  const [bioLoaded, setBioLoaded] = useState(false);

  const lastExport = localStorage.getItem('lastExportDate');
  const lastExportSize = localStorage.getItem('lastExportSize');

  useEffect(() => {
    getUserBio().then((b) => {
      setBio(b || '');
      setBioSaved(b || '');
      setBioLoaded(true);
    }).catch(() => setBioLoaded(true));
  }, []);

  const handleSaveBio = async () => {
    setIsSavingBio(true);
    try {
      const saved = await updateUserBio(bio.trim() || null);
      setBioSaved(saved || '');
      setBio(saved || '');
    } catch (err) {
      console.error('Failed to save bio:', err);
    } finally {
      setIsSavingBio(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/export`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Export failed (${response.status})`);
      }

      const blob = await response.blob();

      // Store export metadata
      localStorage.setItem('lastExportDate', new Date().toISOString());
      localStorage.setItem('lastExportSize', String(blob.size));

      // Native app: opens the system "Save as" dialog. Browsers: normal download.
      const today = new Date().toISOString().slice(0, 10);
      await saveBlobAs(blob, `chinese-learning-backup-${today}.json`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="page">
      <div className="container settings-page">
        <h1>Settings</h1>

        {!role.isTutorOnly && (
          <div className="settings-section" data-testid="personal-bio">
            <h2>Personal Bio</h2>
            <p className="settings-section-desc">
              Tell us a bit about yourself. This is used to personalize example sentences — e.g. if you mention you like coffee, you might get sentences about ordering coffee.
            </p>
            {bioLoaded && (
              <>
                <textarea
                  className="feedback-textarea"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="e.g. I'm a software developer living in New Zealand. I like hiking, coffee, and cooking. I'm learning Chinese to talk to my partner's family."
                  rows={3}
                  maxLength={500}
                  disabled={isSavingBio}
                />
                <div className="feedback-actions">
                  <button
                    className="btn btn-primary"
                    onClick={handleSaveBio}
                    disabled={isSavingBio || bio === bioSaved}
                  >
                    {isSavingBio ? 'Saving...' : 'Save Bio'}
                  </button>
                  <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>{bio.length}/500</span>
                </div>
              </>
            )}
          </div>
        )}

        {!role.isTutorOnly && <OfflineAudioLine />}

        <div className="settings-section">
          <h2>Backup</h2>
          <p className="settings-section-desc">
            Download a backup of all your data as a JSON file. Includes decks,
            notes, cards, and review history.
          </p>

          <button
            className="btn btn-primary export-btn"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? 'Preparing backup...' : 'Download Backup'}
          </button>

          {error && <div className="export-error">{error}</div>}

          <div className="export-meta">
            {lastExport && (
              <div className="export-meta-item">
                Last export: {new Date(lastExport).toLocaleDateString()}
              </div>
            )}
            {lastExportSize && (
              <div className="export-meta-item">
                Last file size: {formatBytes(parseInt(lastExportSize, 10))}
              </div>
            )}
          </div>
        </div>

        <StartOnSection hasStudents={role.hasStudents} />

        <div className="settings-section">
          <button className="btn btn-secondary export-btn settings-signout" onClick={() => { logout(); }}>
            Sign out
          </button>
        </div>

        <section className="nav-section">
          <button
            type="button"
            className="nav-section-toggle"
            onClick={() => setShowAdvanced(v => !v)}
            aria-expanded={showAdvanced}
            aria-controls="settings-advanced"
            data-testid="settings-advanced-toggle"
          >
            <span className="nav-section-title" style={{ margin: 0 }}>Advanced</span>
            <span className="nav-section-toggle-hint">
              {showAdvanced ? 'Hide' : 'Audio quality · Sentence coverage · Feature requests · Sync · Debug'}
            </span>
            <span className={`nav-row-chevron nav-section-toggle-chevron${showAdvanced ? ' open' : ''}`} aria-hidden="true">›</span>
          </button>

          {showAdvanced && (
            <div id="settings-advanced">
              <AudioQualityPanel />
              <AudioDiagnosticsPanel />

              <div className="settings-section">
                <h2>Example Sentences</h2>
                <p className="settings-section-desc">
                  How many of your words have example sentences, what the background
                  generation is doing, and a button to push a batch through now.
                </p>
                <Link className="btn btn-secondary export-btn" to="/settings/sentences">
                  Sentence Coverage →
                </Link>
              </div>

              <FeatureRequestsSection />

              <div className="nav-list" style={{ marginBottom: '1rem' }}>
                <NavRow icon="🪞" label="Duplicate Finder" desc="Find words that appear in more than one deck" to="/duplicate-finder" />
                <NavRow
                  icon="🔄"
                  label={maintenance.isSyncing ? 'Syncing…' : 'Full Sync'}
                  desc="Reconcile all reviews with the server and recompute every card"
                  onClick={maintenance.fullSync}
                  disabled={maintenance.isSyncing}
                />
                <NavRow
                  icon="⬇️"
                  label={maintenance.isUpdating ? 'Checking…' : 'Update App'}
                  desc="Check for a new version now"
                  onClick={maintenance.updateApp}
                  disabled={maintenance.isUpdating}
                />
                <NavRow
                  icon="🐞"
                  label={maintenance.debugConsoleOn ? 'Debug Console: On' : 'Debug Console: Off'}
                  desc="On-device devtools (reloads the app)"
                  onClick={maintenance.toggleDebugConsole}
                />
                <NavRow
                  icon="🧪"
                  label={maintenance.isDumping ? 'Building dump…' : 'Copy Debug Dump'}
                  desc="Copy logs and local state for a bug report"
                  onClick={maintenance.copyDump}
                  disabled={maintenance.isDumping}
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
