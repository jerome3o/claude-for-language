import { useState, useEffect, useCallback } from 'react';
import { API_BASE, getAuthHeaders, getFeatureRequests, getFeatureRequest, addFeatureRequestComment, getUserBio, updateUserBio } from '../api/client';
import type { FeatureRequest, FeatureRequestComment } from '../api/client';
import { getAudioCacheStats, getCachedAudioKeys } from '../services/audioCache';
import { fetchAudioManifest, prefetchAllAudio, useAudioPrefetchProgress } from '../services/audioPrefetch';
import { useNetwork } from '../contexts/NetworkContext';
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

function OfflineAudioSection() {
  const { isOnline } = useNetwork();
  const progress = useAudioPrefetchProgress();
  const [cachedCount, setCachedCount] = useState<number | null>(null);
  const [cachedBytes, setCachedBytes] = useState(0);
  const [manifestTotal, setManifestTotal] = useState<number | null>(null);
  const [missingCount, setMissingCount] = useState<number | null>(null);

  const isDownloading = progress.status === 'running';

  const loadStats = useCallback(async () => {
    const stats = await getAudioCacheStats();
    setCachedCount(stats.count);
    setCachedBytes(stats.totalSize);

    // Manifest requires network — fail gracefully offline
    try {
      const [manifest, cachedKeys] = await Promise.all([
        fetchAudioManifest(),
        getCachedAudioKeys(),
      ]);
      setManifestTotal(manifest.length);
      setMissingCount(manifest.filter((url) => !cachedKeys.has(url)).length);
    } catch {
      setManifestTotal(null);
      setMissingCount(null);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  // Refresh stats when a download run finishes
  useEffect(() => {
    if (progress.status === 'done' || progress.status === 'error') {
      loadStats();
    }
  }, [progress.status, loadStats]);

  const handleDownloadAll = async () => {
    await prefetchAllAudio({ force: true });
  };

  const summary = (() => {
    if (cachedCount === null) return 'Loading…';
    const size = formatBytes(cachedBytes);
    if (manifestTotal !== null && missingCount !== null) {
      const cachedOfManifest = manifestTotal - missingCount;
      return `${cachedOfManifest} of ${manifestTotal} clips stored on this device (${size})`;
    }
    return `${cachedCount} clips stored on this device (${size})`;
  })();

  return (
    <div className="settings-section">
      <h2>Offline Audio</h2>
      <p className="settings-section-desc">
        Card audio is downloaded to this device so study works without a
        connection (use the ✈ toggle in the study screen on the train).
        Audio also downloads automatically in the background after each sync.
      </p>

      <p style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>{summary}</p>

      {isDownloading && (
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{
            height: '8px',
            background: 'var(--color-background, #f3f4f6)',
            border: '1px solid var(--color-border, #e5e7eb)',
            borderRadius: '4px',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: progress.total > 0 ? `${Math.round((progress.done / progress.total) * 100)}%` : '100%',
              background: '#3b82f6',
              transition: 'width 0.3s',
            }} />
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-light)', marginTop: '0.25rem' }}>
            Downloading {progress.done} / {progress.total}
            {progress.failed > 0 ? ` (${progress.failed} failed)` : ''}
          </div>
        </div>
      )}

      <button
        className="btn btn-primary"
        onClick={handleDownloadAll}
        disabled={isDownloading || !isOnline}
        title={!isOnline ? 'Requires internet connection' : ''}
      >
        {isDownloading
          ? 'Downloading…'
          : missingCount !== null && missingCount > 0
            ? `Download ${missingCount} Missing Clips`
            : 'Download All Audio'}
      </button>

      {progress.status === 'done' && progress.failed > 0 && (
        <div style={{ fontSize: '0.8rem', color: '#b45309', marginTop: '0.5rem' }}>
          {progress.failed} clips failed to download — try again later.
        </div>
      )}
    </div>
  );
}

export function SettingsPage() {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [bioSaved, setBioSaved] = useState('');
  const [isSavingBio, setIsSavingBio] = useState(false);
  const [bioLoaded, setBioLoaded] = useState(false);

  const lastExport = localStorage.getItem('lastExportDate');
  const lastExportSize = localStorage.getItem('lastExportSize');

  const loadRequests = useCallback(async () => {
    try {
      const data = await getFeatureRequests();
      setRequests(data);
    } catch (err) {
      console.error('Failed to load feature requests:', err);
    }
  }, []);

  useEffect(() => { loadRequests(); }, [loadRequests]);

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

      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const today = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `chinese-learning-backup-${today}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
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

        <div className="settings-section">
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
        </div>

        <OfflineAudioSection />

        <div className="settings-section">
          <h2>Export Data</h2>
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
      </div>

      {selectedRequestId && (
        <FeatureRequestDetail
          requestId={selectedRequestId}
          onClose={() => { setSelectedRequestId(null); loadRequests(); }}
        />
      )}
    </div>
  );
}
