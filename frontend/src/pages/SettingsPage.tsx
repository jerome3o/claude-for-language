import { useState, useEffect, useCallback } from 'react';
import { API_BASE, getAuthHeaders, getFeatureRequests, getFeatureRequest, addFeatureRequestComment } from '../api/client';
import type { FeatureRequest, FeatureRequestComment } from '../api/client';
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

export function SettingsPage() {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

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
