import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState, useRef, useEffect, useCallback } from 'react';
import { syncService } from '../services/sync';
import { isDebugConsoleEnabled, setDebugConsoleEnabled } from '../utils/debugConsole';
import { copyDebugDump } from '../utils/debugDump';
import { checkForUpdateNow, BUILD_TIME } from '../utils/appUpdates';
import { getPendingFeatureRequestCount, getUnreadNotificationCount, getNotifications, markNotificationRead, markAllNotificationsRead } from '../api/client';
import type { AppNotification } from '../types';
import './Header.css';

export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDumping, setIsDumping] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch pending feature request count for admins
  useEffect(() => {
    if (!user?.is_admin) return;
    getPendingFeatureRequestCount().then(setPendingCount).catch(() => {});
  }, [user?.is_admin]);

  // Fetch unread notification count
  useEffect(() => {
    if (!user) return;
    getUnreadNotificationCount().then(setUnreadCount).catch(() => {});
    // Poll every 60 seconds
    const interval = setInterval(() => {
      getUnreadNotificationCount().then(setUnreadCount).catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, [user]);

  const handleToggleNotifications = useCallback(async () => {
    const willShow = !showNotifications;
    setShowNotifications(willShow);
    setShowUserMenu(false);
    if (willShow && !loadingNotifications) {
      setLoadingNotifications(true);
      try {
        const notifs = await getNotifications();
        setNotifications(notifs);
      } catch {
        // ignore
      } finally {
        setLoadingNotifications(false);
      }
    }
  }, [showNotifications, loadingNotifications]);

  const handleNotificationClick = useCallback(async (notif: AppNotification) => {
    if (!notif.is_read) {
      await markNotificationRead(notif.id).catch(() => {});
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
    setShowNotifications(false);
    if (notif.type === 'new_chat_message' && notif.relationship_id && notif.conversation_id) {
      navigate(`/connections/${notif.relationship_id}/chat/${notif.conversation_id}`);
    } else if (notif.type === 'tutor_review_flagged') {
      navigate('/tutor-reviews');
    } else if (notif.homework_id) {
      navigate('/homework');
    }
  }, [navigate]);

  const handleMarkAllRead = useCallback(async () => {
    await markAllNotificationsRead().catch(() => {});
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  }, []);

  const handleLogout = async () => {
    setShowUserMenu(false);
    await logout();
  };

  const handleMenuItemClick = (path: string) => {
    setShowUserMenu(false);
    navigate(path);
  };

  // The one sync button: two-way event reconciliation, server + local card
  // state recompute, recordings upload, and a full deck/note refresh.
  const handleFullSync = useCallback(async () => {
    if (!confirm(
      'Run a full sync?\n\n' +
      'This reconciles your complete review history with the server, refreshes all decks ' +
      'and notes, and recomputes every card. It can take a minute or two — keep the app open.'
    )) {
      return;
    }
    setIsSyncing(true);
    setShowUserMenu(false);
    try {
      const result = await syncService.deepSync();
      console.log('Full sync result:', result);
      const errorNote = result.errors.length > 0 ? `\nErrors: ${result.errors.join('; ')}` : '';
      alert(
        `Full sync complete.\n` +
        `Reviews: ${result.events_local} local, ${result.events_uploaded} new on server, ` +
        `${result.events_downloaded} downloaded` +
        (result.events_orphaned > 0 ? ` (${result.events_orphaned} orphans of deleted cards stay local)` : '') + `\n` +
        `Recordings uploaded: ${result.recordings_uploaded}\n` +
        `Cards recomputed: ${result.cards_recomputed}${errorNote}`
      );
      window.location.reload();
    } catch (err) {
      console.error('Full sync failed:', err);
      alert(`Full sync failed: ${err instanceof Error ? err.message : err}`);
      setIsSyncing(false);
    }
  }, []);

  const handleUpdateApp = useCallback(async () => {
    setIsUpdating(true);
    try {
      const outcome = await checkForUpdateNow();
      if (outcome === 'updating') {
        alert('New version found — updating now...');
        // The page reloads automatically when the new service worker takes
        // over (see utils/appUpdates.ts); this is just a fallback.
        setTimeout(() => window.location.reload(), 4000);
        return;
      }
      if (outcome === 'latest') {
        alert(`You're on the latest version.\nBuilt: ${BUILD_TIME}`);
        setIsUpdating(false);
        return;
      }
      // No service worker — fall back to a hard cache clear
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
      }
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        for (const cacheName of cacheNames) {
          await caches.delete(cacheName);
        }
      }
      window.location.reload();
    } catch (err) {
      console.error('Failed to update app:', err);
      alert(`Update check failed: ${err instanceof Error ? err.message : err}`);
      setIsUpdating(false);
    }
  }, []);

  const handleToggleDebugConsole = useCallback(() => {
    setDebugConsoleEnabled(!isDebugConsoleEnabled());
    window.location.reload();
  }, []);

  const handleCopyDebugDump = useCallback(async () => {
    setIsDumping(true);
    setShowUserMenu(false);
    try {
      const message = await copyDebugDump();
      alert(message);
    } catch (err) {
      console.error('Failed to build debug dump:', err);
      alert(`Failed to build debug dump: ${err instanceof Error ? err.message : err}`);
    } finally {
      setIsDumping(false);
    }
  }, []);

  return (
    <header className="header">
      <div className="container header-content">
        <Link to="/" className="header-title">
          汉语学习
        </Link>
        <div className="header-right">
          <nav className="header-nav">
            <Link to="/">Home</Link>
            <Link to="/search">Search</Link>
            <Link to="/homework">Homework</Link>
            <Link to="/connections">Connections</Link>
          </nav>
        {user && (
          <div className="notification-area" ref={notifRef}>
            <button
              className="notification-bell"
              onClick={handleToggleNotifications}
              aria-label="Notifications"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unreadCount > 0 && (
                <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </button>
            {showNotifications && (
              <div className="notification-dropdown">
                <div className="notification-dropdown-header">
                  <span className="notification-dropdown-title">Notifications</span>
                  {unreadCount > 0 && (
                    <button className="notification-mark-all" onClick={handleMarkAllRead}>
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="notification-dropdown-list">
                  {loadingNotifications ? (
                    <div className="notification-empty">Loading...</div>
                  ) : notifications.length === 0 ? (
                    <div className="notification-empty">No notifications</div>
                  ) : (
                    notifications.map(notif => (
                      <button
                        key={notif.id}
                        className={`notification-item ${!notif.is_read ? 'notification-item-unread' : ''}`}
                        onClick={() => handleNotificationClick(notif)}
                      >
                        <div className="notification-item-title">{notif.title}</div>
                        {notif.message && <div className="notification-item-message">{notif.message}</div>}
                        <div className="notification-item-time">
                          {new Date(notif.created_at + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {user && (
          <div className="header-user" ref={menuRef}>
            <button
              className="user-button"
              onClick={() => setShowUserMenu(!showUserMenu)}
              aria-expanded={showUserMenu}
            >
              {user.picture_url ? (
                <img
                  src={user.picture_url}
                  alt=""
                  className="user-avatar"
                />
              ) : (
                <div className="user-avatar-placeholder">
                  {user.name?.[0] || user.email?.[0] || '?'}
                </div>
              )}
              {pendingCount > 0 && (
                <span className="admin-notification-badge">{pendingCount}</span>
              )}
            </button>
            {showUserMenu && (
              <div className="user-menu">
                <div className="user-menu-info">
                  <span className="user-menu-name">{user.name || 'User'}</span>
                  <span className="user-menu-email">{user.email}</span>
                </div>
                <div className="user-menu-divider" />
                <button
                  className="user-menu-item"
                  onClick={() => handleMenuItemClick('/settings')}
                >
                  ⚙️ Settings
                </button>
                <button
                  className="user-menu-item"
                  onClick={() => handleMenuItemClick('/practice')}
                >
                  🧩 Grammar Practice
                </button>
                <button
                  className="user-menu-item"
                  onClick={() => handleMenuItemClick('/lesson-notes')}
                >
                  📝 Lesson Notes
                </button>
                <button
                  className="user-menu-item"
                  onClick={() => handleMenuItemClick('/audio-lessons')}
                >
                  🎧 Audio Lessons
                </button>
                <button
                  className="user-menu-item"
                  onClick={() => handleMenuItemClick('/readers')}
                >
                  📚 Readers
                </button>
                <button
                  className="user-menu-item"
                  onClick={() => handleMenuItemClick('/homework')}
                >
                  📋 Homework
                </button>
                <button
                  className="user-menu-item"
                  onClick={() => handleMenuItemClick('/analyze')}
                >
                  🔍 Sentence Analysis
                </button>
                <button
                  className="user-menu-item"
                  onClick={() => handleMenuItemClick('/coach')}
                >
                  🧑‍🏫 Sentence Coach
                </button>
                <button
                  className="user-menu-item"
                  onClick={() => handleMenuItemClick('/duplicate-finder')}
                >
                  🪞 Duplicate Finder
                </button>
                <button
                  className="user-menu-item"
                  onClick={() => handleMenuItemClick('/progress')}
                >
                  📊 Progress
                </button>
                <button
                  className="user-menu-item"
                  onClick={() => handleMenuItemClick('/tutor-reviews')}
                >
                  ✍️ Reviews
                </button>
                <div className="user-menu-divider" />
                <button
                  className="user-menu-item"
                  onClick={handleFullSync}
                  disabled={isSyncing}
                >
                  {isSyncing ? '🔄 Syncing...' : '🔄 Full Sync'}
                </button>
                <button
                  className="user-menu-item"
                  onClick={handleUpdateApp}
                  disabled={isUpdating}
                >
                  {isUpdating ? '⬇️ Checking...' : '⬇️ Update App'}
                </button>
                <button
                  className="user-menu-item"
                  onClick={handleToggleDebugConsole}
                >
                  {isDebugConsoleEnabled() ? '🐞 Debug Console: On' : '🐞 Debug Console: Off'}
                </button>
                <button
                  className="user-menu-item"
                  onClick={handleCopyDebugDump}
                  disabled={isDumping}
                >
                  {isDumping ? '🧪 Building Dump...' : '🧪 Copy Debug Dump'}
                </button>
                {user.is_admin && (
                  <>
                    {pendingCount > 0 && (
                      <button
                        className="user-menu-item user-menu-item-review"
                        onClick={() => handleMenuItemClick('/admin')}
                      >
                        📋 Review Requests
                        <span className="menu-badge">{pendingCount}</span>
                      </button>
                    )}
                    <button
                      className="user-menu-item"
                      onClick={() => handleMenuItemClick('/admin')}
                    >
                      ⚙️ Admin
                    </button>
                  </>
                )}
                <div className="user-menu-divider" />
                <button className="user-menu-item user-menu-item-danger" onClick={handleLogout}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    </header>
  );
}
