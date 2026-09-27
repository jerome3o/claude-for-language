import { useEffect, useState, useCallback } from 'react';
import { AdminUser } from '../types';
import { getAdminUsers, getStorageStats, getOrphanStats, cleanupOrphans, StorageStats, StorageCleanupReport, getFeatureRequests, approveFeatureRequest, FeatureRequest, API_BASE } from '../api/client';
import { syncService } from '../services/sync';
import { getSyncLogs, SyncLogEntry } from '../db/database';
import { listAccessRequests, approveAccessRequest, dismissAccessRequest, setUserCanInvite, listInvites, revokeInvite } from '../api/invites';
import type { AccessRequest, Invite } from '../types/invites';
import { InviteList } from '../components/invites/InviteList';
import { AdminUserSheet } from '../components/admin/AdminUserSheet';
import { NavRow } from './MorePage';
import './MorePage.css';
import './AdminPage.css';

/** Per-user "may invite new people" switch. Admins always may, so theirs is fixed on. */
function CanInviteToggle({ user, busy, onToggle }: { user: AdminUser; busy: boolean; onToggle: (u: AdminUser) => void }) {
  const on = user.is_admin || !!user.can_invite;
  return (
    <label className={`can-invite-toggle${user.is_admin ? ' always' : ''}`} title={user.is_admin ? 'Admins can always invite' : undefined}>
      <input
        type="checkbox"
        checked={on}
        disabled={user.is_admin || busy}
        onChange={() => onToggle(user)}
        aria-label={`Can invite: ${user.name || user.email || user.id}`}
      />
      <span>{user.is_admin ? 'Always' : on ? 'Yes' : 'No'}</span>
    </label>
  );
}

const formatMb = (bytes: number) => Math.round(bytes / 1024 / 1024 * 100) / 100;

/** Dry-run result of the storage clean-up: what would go, per prefix, and what is protected. */
function StorageDryRun({ report }: { report: StorageCleanupReport }) {
  const rows = report.prefixes.filter((p) => p.objects > 0);
  return (
    <div className="orphan-stats">
      <p className={report.deletable.count ? 'orphan-warning' : 'no-orphans'}>
        {report.deletable.count
          ? `Dry run: ${report.deletable.count} unused files (${formatMb(report.deletable.bytes)} MB) could be deleted.`
          : 'Dry run: nothing to delete.'}
        {' '}Only files older than {report.min_age_days} days; nothing has been deleted yet.
      </p>
      {report.warnings.map((w) => <p key={w} className="orphan-warning">⚠ {w}</p>)}
      <ul className="storage-prefixes">
        {rows.map((p) => (
          <li key={p.prefix}>
            <div className="storage-prefix-head">
              <code>{p.prefix}</code>
              <span>{p.objects} files · {formatMb(p.bytes)} MB</span>
              <span className={p.collectable ? 'storage-tag collectable' : 'storage-tag'}>{p.collectable ? 'collectable' : 'protected'}</span>
            </div>
            <div className="storage-prefix-counts">
              {p.referenced} in use · {p.too_recent} too recent · {p.unreferenced} unreferenced
              {!p.collectable && p.unreferenced > 0 ? ' (kept)' : ''}
            </div>
            {p.collectable && p.sample_keys.length > 0 && (
              <details>
                <summary>Sample keys</summary>
                <ul className="storage-samples">{p.sample_keys.map((k) => <li key={k}><code>{k}</code></li>)}</ul>
              </details>
            )}
          </li>
        ))}
        {report.unknown.objects > 0 && (
          <li>
            <div className="storage-prefix-head">
              <code>unknown</code>
              <span>{report.unknown.objects} files · {formatMb(report.unknown.bytes)} MB</span>
              <span className="storage-tag">never deleted</span>
            </div>
            <div className="storage-prefix-counts">
              {Object.entries(report.unknown.top_level).map(([k, n]) => `${k} ${n}`).join(' · ')}
            </div>
          </li>
        )}
      </ul>
    </div>
  );
}

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Storage state
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [orphanStats, setOrphanStats] = useState<StorageCleanupReport | null>(null);
  const [isLoadingStorage, setIsLoadingStorage] = useState(false);
  const [isCheckingOrphans, setIsCheckingOrphans] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);

  // Cache state
  const [isClearing, setIsClearing] = useState(false);

  // Card fix state
  const [isFixingCards, setIsFixingCards] = useState(false);
  const [cardFixResult, setCardFixResult] = useState<string | null>(null);

  // Sync debug state
  const [syncLogs, setSyncLogs] = useState<SyncLogEntry[]>([]);
  const [isLoadingSyncLogs, setIsLoadingSyncLogs] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Feature requests state
  const [pendingRequests, setPendingRequests] = useState<FeatureRequest[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);

  // Invite-only sign-up state
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
  const [accessBusyId, setAccessBusyId] = useState<string | null>(null);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const [allInvites, setAllInvites] = useState<Invite[]>([]);
  const [canInviteBusyId, setCanInviteBusyId] = useState<string | null>(null);
  // Account sheet (inspect, role, delete)
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState('');

  const loadAccessRequests = useCallback(async () => {
    try {
      setAccessRequests(await listAccessRequests('pending'));
    } catch (err) {
      console.error('Failed to load access requests:', err);
    }
  }, []);

  const loadAllInvites = useCallback(async () => {
    try {
      setAllInvites(await listInvites(true));
    } catch (err) {
      console.error('Failed to load invites:', err);
    }
  }, []);

  const handleAccessRequest = useCallback(async (req: AccessRequest, action: 'approve' | 'dismiss') => {
    setAccessBusyId(req.id);
    setAccessMessage(null);
    try {
      if (action === 'approve') {
        await approveAccessRequest(req.id);
        setAccessMessage(`${req.name || req.email} can now sign in with ${req.email} — tell them to try again.`);
        loadAllInvites();
      } else {
        await dismissAccessRequest(req.id);
      }
      setAccessRequests(prev => prev.filter(r => r.id !== req.id));
    } catch (err) {
      setAccessMessage('Failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setAccessBusyId(null);
    }
  }, [loadAllInvites]);

  const handleToggleCanInvite = useCallback(async (user: AdminUser) => {
    const next = !user.can_invite;
    setCanInviteBusyId(user.id);
    try {
      await setUserCanInvite(user.id, next);
      setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, can_invite: next } : u)));
    } catch (err) {
      console.error('Failed to update can_invite:', err);
    } finally {
      setCanInviteBusyId(null);
    }
  }, []);

  const handleRevokeInvite = useCallback(async (id: string) => {
    await revokeInvite(id);
    loadAllInvites();
  }, [loadAllInvites]);

  const loadSyncLogs = useCallback(async () => {
    setIsLoadingSyncLogs(true);
    try {
      const logs = await getSyncLogs();
      setSyncLogs(logs);
    } catch (err) {
      console.error('Failed to load sync logs:', err);
    } finally {
      setIsLoadingSyncLogs(false);
    }
  }, []);

  const loadPendingRequests = useCallback(async () => {
    setIsLoadingRequests(true);
    try {
      const all = await getFeatureRequests({ all: true });
      setPendingRequests(all.filter(r => r.approval_status === 'pending'));
    } catch (err) {
      console.error('Failed to load feature requests:', err);
    } finally {
      setIsLoadingRequests(false);
    }
  }, []);

  const handleApproval = useCallback(async (id: string, status: 'approved' | 'declined') => {
    try {
      await approveFeatureRequest(id, status);
      setPendingRequests(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      console.error('Failed to update approval:', err);
    }
  }, []);

  useEffect(() => {
    const loadUsers = async () => {
      try {
        const data = await getAdminUsers();
        setUsers(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load users');
      } finally {
        setIsLoading(false);
      }
    };

    loadUsers();
    loadPendingRequests();
    loadSyncLogs();
    loadAccessRequests();
    loadAllInvites();
  }, [loadPendingRequests, loadSyncLogs, loadAccessRequests, loadAllInvites]);

  const loadStorageStats = async () => {
    setIsLoadingStorage(true);
    try {
      const stats = await getStorageStats();
      setStorageStats(stats);
    } catch (err) {
      console.error('Failed to load storage stats:', err);
    } finally {
      setIsLoadingStorage(false);
    }
  };

  const checkOrphans = async () => {
    setIsCheckingOrphans(true);
    setOrphanStats(null);
    try {
      const stats = await getOrphanStats();
      setOrphanStats(stats);
    } catch (err) {
      console.error('Failed to check orphans:', err);
    } finally {
      setIsCheckingOrphans(false);
    }
  };

  const handleCleanup = async () => {
    // Only offered after a dry run: the confirm repeats exactly what it found.
    if (!orphanStats || orphanStats.deletable.count === 0) return;
    const byPrefix = orphanStats.prefixes
      .filter((p) => p.collectable && p.unreferenced > 0)
      .map((p) => `  ${p.prefix} ${p.unreferenced} files (${formatMb(p.unreferenced_bytes)} MB)`)
      .join('\n');
    const ok = confirm(
      `Delete ${orphanStats.deletable.count} unused files (${formatMb(orphanStats.deletable.bytes)} MB)?\n\n${byPrefix}\n\n` +
      `Only generated audio and pictures nothing refers to, older than ${orphanStats.min_age_days} days. ` +
      'Recordings, photos, calls and unknown files are never touched. This cannot be undone.'
    );
    if (!ok) return;
    setIsCleaning(true);
    setCleanupResult(null);
    try {
      const result = await cleanupOrphans();
      setCleanupResult(
        `Deleted ${result.deleted.count} files (${formatMb(result.deleted.bytes)} MB)` +
        (result.deleted.failed ? ` · ${result.deleted.failed} failed` : '')
      );
      setOrphanStats(null);
      // Refresh storage stats
      loadStorageStats();
    } catch (err) {
      setCleanupResult('Cleanup failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsCleaning(false);
    }
  };

  const handleClearCache = useCallback(async () => {
    setIsClearing(true);
    try {
      // Unregister service workers
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
      }

      // Clear all caches
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        for (const cacheName of cacheNames) {
          await caches.delete(cacheName);
        }
      }

      // Reload the page
      window.location.reload();
    } catch (err) {
      console.error('Failed to clear cache:', err);
      setIsClearing(false);
    }
  }, []);

  const handleFixCardStates = useCallback(async () => {
    setIsFixingCards(true);
    setCardFixResult(null);
    try {
      const result = await syncService.fixAllCardStates();
      setCardFixResult(`Fixed ${result.fixed} of ${result.total} cards${result.errors.length > 0 ? ` (${result.errors.length} errors)` : ''}`);
    } catch (err) {
      console.error('Failed to fix card states:', err);
      setCardFixResult('Failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsFixingCards(false);
    }
  }, []);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const filterText = userFilter.trim().toLowerCase();
  const shownUsers = filterText
    ? users.filter(u => `${u.email ?? ''} ${u.name ?? ''}`.toLowerCase().includes(filterText))
    : users;

  if (isLoading) {
    return (
      <div className="container">
        <div className="admin-page">
          <h1>Admin Dashboard</h1>
          <p>Loading users...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="admin-page">
          <h1>Admin Dashboard</h1>
          <div className="admin-error">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="admin-page">
        <h1>Admin Dashboard</h1>

        <div className="nav-list admin-shortcuts">
          <NavRow icon="🧭" label="Exercise catalogue" desc="All exercise types · try a sample (nothing recorded)" to="/library/catalogue" />
          <NavRow icon="🗂️" label="Lesson Library" desc="Mini lessons to assign — tap one to try it" to="/library" />
        </div>

        {(accessRequests.length > 0 || accessMessage) && (
          <div className={`pending-requests-wrapper${accessRequests.length > 0 ? ' has-pending' : ''}`}>
            <h2 className="pending-requests-heading">
              🔑 Access requests
              {accessRequests.length > 0 && (
                <span className="pending-count-badge">{accessRequests.length}</span>
              )}
            </h2>
            <p className="pending-empty">
              People who tried to sign in without an invite. Approve lets that Google email in the next time they sign in.
            </p>
            {accessMessage && <p className="access-request-message">{accessMessage}</p>}
            <div className="pending-requests-section">
              {accessRequests.map(req => (
                <div key={req.id} className="pending-request-card">
                  <div className="pending-request-content access-request-content">
                    {req.picture_url && <img src={req.picture_url} alt="" className="user-avatar" />}
                    <div>
                      <p className="pending-request-text">{req.name || 'No name'}</p>
                      <div className="pending-request-meta">
                        <span>{req.email}</span>
                        <span>{req.attempts} attempt{req.attempts === 1 ? '' : 's'}</span>
                        <span>last {formatDate(req.last_seen_at)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="pending-request-actions">
                    <button
                      className="btn btn-approve btn-sm"
                      onClick={() => handleAccessRequest(req, 'approve')}
                      disabled={accessBusyId === req.id}
                    >
                      Approve
                    </button>
                    <button
                      className="btn btn-decline btn-sm"
                      onClick={() => handleAccessRequest(req, 'dismiss')}
                      disabled={accessBusyId === req.id}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="admin-stats">
          <div className="admin-stat-card">
            <span className="stat-number">{users.length}</span>
            <span className="stat-label">Total Users</span>
          </div>
          <div className="admin-stat-card">
            <span className="stat-number">{users.reduce((sum, u) => sum + u.deck_count, 0)}</span>
            <span className="stat-label">Total Decks</span>
          </div>
          <div className="admin-stat-card">
            <span className="stat-number">{users.reduce((sum, u) => sum + u.note_count, 0)}</span>
            <span className="stat-label">Total Notes</span>
          </div>
          <div className="admin-stat-card">
            <span className="stat-number">{users.reduce((sum, u) => sum + u.review_count, 0)}</span>
            <span className="stat-label">Total Reviews</span>
          </div>
        </div>

        <div className={`pending-requests-wrapper${pendingRequests.length > 0 ? ' has-pending' : ''}`}>
          <h2 className="pending-requests-heading">
            📋 Pending Feature Requests
            {pendingRequests.length > 0 && (
              <span className="pending-count-badge">{pendingRequests.length}</span>
            )}
          </h2>
          {isLoadingRequests ? (
            <p className="pending-empty">Loading requests...</p>
          ) : pendingRequests.length === 0 ? (
            <p className="pending-empty">No pending requests — all caught up!</p>
          ) : (
            <div className="pending-requests-section">
              {pendingRequests.map(req => (
                <div key={req.id} className="pending-request-card">
                  <div className="pending-request-content">
                    <p className="pending-request-text">{req.content}</p>
                    {req.screenshot_url && (
                      <a href={`${API_BASE}${req.screenshot_url}`} target="_blank" rel="noopener noreferrer">
                        <img
                          src={`${API_BASE}${req.screenshot_url}`}
                          alt="Screenshot"
                          style={{ maxWidth: 200, border: '1px solid var(--border-color, #ccc)', borderRadius: 4, marginTop: 8 }}
                        />
                      </a>
                    )}
                    <div className="pending-request-meta">
                      <span>{req.user_name || req.user_email || 'Unknown user'}</span>
                      <span>from {req.page_context || '/'}</span>
                      <span>{formatDate(req.created_at)}</span>
                    </div>
                  </div>
                  <div className="pending-request-actions">
                    <button
                      className="btn btn-approve btn-sm"
                      onClick={() => handleApproval(req.id, 'approved')}
                    >
                      Approve
                    </button>
                    <button
                      className="btn btn-decline btn-sm"
                      onClick={() => handleApproval(req.id, 'declined')}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <h2>Storage</h2>
        <div className="storage-section">
          <div className="storage-actions">
            <button
              className="btn btn-secondary"
              onClick={loadStorageStats}
              disabled={isLoadingStorage}
            >
              {isLoadingStorage ? 'Loading...' : 'Check Storage'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={checkOrphans}
              disabled={isCheckingOrphans}
            >
              {isCheckingOrphans ? 'Checking...' : 'Find Orphans'}
            </button>
            {orphanStats && orphanStats.deletable.count > 0 && (
              <button
                className="btn btn-primary"
                onClick={handleCleanup}
                disabled={isCleaning}
              >
                {isCleaning ? 'Cleaning...' : `Delete ${orphanStats.deletable.count} unused files…`}
              </button>
            )}
          </div>

          {storageStats && (
            <div className="storage-stats">
              <span>{storageStats.total_files} files</span>
              <span>{storageStats.total_size_mb} MB total</span>
            </div>
          )}

          {orphanStats && <StorageDryRun report={orphanStats} />}

          {cleanupResult && (
            <div className="cleanup-result">{cleanupResult}</div>
          )}
        </div>

        <h2>All Users</h2>
        <input
          type="search"
          className="admin-user-filter"
          placeholder="Find by email or name"
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          aria-label="Find a user"
        />
        <div className="users-table-container">
          {/* Mobile: Card layout */}
          {shownUsers.map(user => (
            <div key={user.id} className="user-card">
              <div className="user-card-header">
                {user.picture_url && (
                  <img
                    src={user.picture_url}
                    alt=""
                    className="user-avatar"
                  />
                )}
                <div className="user-info">
                  <div className="user-name">
                    {user.name || 'No name'}
                    {user.is_admin && <span className="admin-badge">Admin</span>}
                  </div>
                  <div className="user-email">{user.email || '-'}</div>
                </div>
              </div>
              <div className="user-card-stats">
                <div className="user-stat">
                  <span className="user-stat-number">{user.deck_count}</span>
                  <span className="user-stat-label">Decks</span>
                </div>
                <div className="user-stat">
                  <span className="user-stat-number">{user.note_count}</span>
                  <span className="user-stat-label">Notes</span>
                </div>
                <div className="user-stat">
                  <span className="user-stat-number">{user.review_count}</span>
                  <span className="user-stat-label">Reviews</span>
                </div>
              </div>
              <div className="user-card-details">
                <div className="user-detail">
                  <span className="user-detail-label">Role</span>
                  <span className="user-detail-value"><span className={`admin-role-badge ${user.role}`}>{user.role}</span></span>
                </div>
                <div className="user-detail">
                  <span className="user-detail-label">Last Login</span>
                  <span className="user-detail-value">{formatDate(user.last_login_at)}</span>
                </div>
                <div className="user-detail">
                  <span className="user-detail-label">Can invite</span>
                  <span className="user-detail-value">
                    <CanInviteToggle user={user} busy={canInviteBusyId === user.id} onToggle={handleToggleCanInvite} />
                  </span>
                </div>
              </div>
              <button type="button" className="btn btn-secondary admin-manage-btn" onClick={() => setOpenUserId(user.id)}>
                Manage · inspect
              </button>
            </div>
          ))}

          {/* Desktop: Table layout */}
          <table className="users-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Decks</th>
                <th>Notes</th>
                <th>Reviews</th>
                <th>Last Login</th>
                <th>Role</th>
                <th>Can invite</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shownUsers.map(user => (
                <tr key={user.id}>
                  <td className="user-cell">
                    {user.picture_url && (
                      <img
                        src={user.picture_url}
                        alt=""
                        className="user-avatar"
                      />
                    )}
                    <span className="user-name">{user.name || 'No name'}</span>
                    {user.is_admin && <span className="admin-badge">Admin</span>}
                  </td>
                  <td>{user.email || '-'}</td>
                  <td className="stat-cell">{user.deck_count}</td>
                  <td className="stat-cell">{user.note_count}</td>
                  <td className="stat-cell">{user.review_count}</td>
                  <td>{formatDate(user.last_login_at)}</td>
                  <td><span className={`admin-role-badge ${user.role}`}>{user.role}</span></td>
                  <td className="stat-cell">
                    <CanInviteToggle user={user} busy={canInviteBusyId === user.id} onToggle={handleToggleCanInvite} />
                  </td>
                  <td>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpenUserId(user.id)}>Manage</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {openUserId && (
          <AdminUserSheet
            userId={openUserId}
            onClose={() => setOpenUserId(null)}
            onRoleChanged={(id, role) => setUsers(prev => prev.map(u => (u.id === id ? { ...u, role } : u)))}
            onDeleted={(id) => {
              setUsers(prev => prev.filter(u => u.id !== id));
              setOpenUserId(null);
            }}
          />
        )}

        <h2>All invites</h2>
        <div className="all-invites-section">
          <InviteList
            invites={allInvites}
            onRevoke={handleRevokeInvite}
            showCreator
            emptyText="No invite links have been created yet."
          />
        </div>

        <h2>Sync Debug</h2>
        <div className="sync-debug-section">
          <div className="sync-debug-header">
            <button
              className="btn btn-secondary"
              onClick={loadSyncLogs}
              disabled={isLoadingSyncLogs}
            >
              {isLoadingSyncLogs ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {syncLogs.length > 0 && (
            <div className="sync-debug-summary">
              <div className="sync-debug-stat">
                <span className="sync-debug-stat-number">{syncLogs.length}</span>
                <span className="sync-debug-stat-label">Total</span>
              </div>
              <div className="sync-debug-stat">
                <span className="sync-debug-stat-number sync-debug-success">
                  {Math.round((syncLogs.filter(l => l.outcome === 'success').length / syncLogs.length) * 100)}%
                </span>
                <span className="sync-debug-stat-label">Success</span>
              </div>
              <div className="sync-debug-stat">
                <span className="sync-debug-stat-number">
                  {syncLogs.length > 0
                    ? `${Math.round(syncLogs.reduce((sum, l) => sum + l.duration_ms, 0) / syncLogs.length)}ms`
                    : '-'}
                </span>
                <span className="sync-debug-stat-label">Avg Duration</span>
              </div>
              <div className="sync-debug-stat">
                <span className="sync-debug-stat-number sync-debug-error">
                  {syncLogs.filter(l => l.outcome === 'error').length}
                </span>
                <span className="sync-debug-stat-label">Errors</span>
              </div>
            </div>
          )}

          {syncLogs.length === 0 ? (
            <p className="sync-debug-empty">No sync logs yet. Logs will appear after sync operations run.</p>
          ) : (
            <div className="sync-log-list">
              {syncLogs.map(log => (
                <div
                  key={log.id}
                  className={`sync-log-entry ${log.outcome}`}
                  onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                >
                  <div className="sync-log-row">
                    <span className={`sync-log-badge ${log.outcome}`}>
                      {log.outcome === 'success' ? 'OK' : 'ERR'}
                    </span>
                    <span className="sync-log-type">{log.type}</span>
                    <span className="sync-log-duration">{log.duration_ms}ms</span>
                    <span className="sync-log-time">
                      {new Date(log.timestamp).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                  {expandedLogId === log.id && (
                    <div className="sync-log-details">
                      {log.error_message && (
                        <div className="sync-log-error-msg">{log.error_message}</div>
                      )}
                      <div className="sync-log-detail-grid">
                        {log.details.decks_synced != null && (
                          <span>Decks: {log.details.decks_synced}</span>
                        )}
                        {log.details.notes_synced != null && (
                          <span>Notes: {log.details.notes_synced}</span>
                        )}
                        {log.details.cards_synced != null && (
                          <span>Cards: {log.details.cards_synced}</span>
                        )}
                        {log.details.events_uploaded != null && (
                          <span>Events up: {log.details.events_uploaded}</span>
                        )}
                        {log.details.events_downloaded != null && (
                          <span>Events down: {log.details.events_downloaded}</span>
                        )}
                        {log.details.recordings_uploaded != null && (
                          <span>Recordings: {log.details.recordings_uploaded}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <h2>Debug</h2>
        <div className="debug-section">
          <div className="debug-info">
            <span className="debug-label">Build Time:</span>
            <span className="debug-value">
              {formatDate(import.meta.env.VITE_BUILD_TIME || new Date().toISOString())}
            </span>
          </div>
          <div className="debug-actions">
            <button
              className="btn btn-secondary"
              onClick={handleClearCache}
              disabled={isClearing}
            >
              {isClearing ? 'Clearing...' : 'Clear Cache & Reload'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleFixCardStates}
              disabled={isFixingCards}
              title="Recompute all card scheduling states from review events. Use this to fix cards that were corrupted by sync issues."
            >
              {isFixingCards ? 'Fixing...' : 'Fix Card States'}
            </button>
          </div>
          {cardFixResult && (
            <div className="card-fix-result">{cardFixResult}</div>
          )}
        </div>
      </div>
    </div>
  );
}
