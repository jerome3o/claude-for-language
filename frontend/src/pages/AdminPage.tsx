import { useEffect, useState, useCallback } from 'react';
import { AdminUser } from '../types';
import { getAdminUsers, getStorageStats, getOrphanStats, cleanupOrphans, StorageStats, OrphanStats } from '../api/client';
import './AdminPage.css';

const BUILD_TIME = __BUILD_TIME__;

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Storage state
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [orphanStats, setOrphanStats] = useState<OrphanStats | null>(null);
  const [isLoadingStorage, setIsLoadingStorage] = useState(false);
  const [isCheckingOrphans, setIsCheckingOrphans] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);

  // Cache state
  const [isClearing, setIsClearing] = useState(false);

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
  }, []);

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
    if (!confirm('Delete all orphaned audio files? This cannot be undone.')) return;
    setIsCleaning(true);
    setCleanupResult(null);
    try {
      const result = await cleanupOrphans();
      setCleanupResult(`Deleted ${result.deleted_count} files (${result.deleted_size_mb} MB)`);
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
            {orphanStats && orphanStats.orphan_count > 0 && (
              <button
                className="btn btn-primary"
                onClick={handleCleanup}
                disabled={isCleaning}
              >
                {isCleaning ? 'Cleaning...' : `Delete ${orphanStats.orphan_count} Orphans`}
              </button>
            )}
          </div>

          {storageStats && (
            <div className="storage-stats">
              <span>{storageStats.total_files} files</span>
              <span>{storageStats.total_size_mb} MB total</span>
            </div>
          )}

          {orphanStats && (
            <div className="orphan-stats">
              {orphanStats.orphan_count === 0 ? (
                <span className="no-orphans">No orphaned files found</span>
              ) : (
                <span className="orphan-warning">
                  {orphanStats.orphan_count} orphaned files ({orphanStats.orphan_size_mb} MB)
                </span>
              )}
            </div>
          )}

          {cleanupResult && (
            <div className="cleanup-result">{cleanupResult}</div>
          )}
        </div>

        <h2>All Users</h2>
        <div className="users-table-container">
          {/* Mobile: Card layout */}
          {users.map(user => (
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
                  <span className="user-detail-value">{user.role}</span>
                </div>
                <div className="user-detail">
                  <span className="user-detail-label">Last Login</span>
                  <span className="user-detail-value">{formatDate(user.last_login_at)}</span>
                </div>
              </div>
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
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>Debug</h2>
        <div className="debug-section">
          <div className="debug-info">
            <span className="debug-label">Build Time:</span>
            <span className="debug-value">{formatDate(BUILD_TIME)}</span>
          </div>
          <button
            className="btn btn-secondary"
            onClick={handleClearCache}
            disabled={isClearing}
          >
            {isClearing ? 'Clearing...' : 'Clear Cache & Reload'}
          </button>
        </div>
      </div>
    </div>
  );
}
