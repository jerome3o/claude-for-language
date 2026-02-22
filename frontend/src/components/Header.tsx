import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState, useRef, useEffect, useCallback } from 'react';
import { syncService } from '../services/sync';
import { recomputeCardStates, getPendingFeatureRequestCount, getUnreadNotificationCount, getNotifications, markNotificationRead, markAllNotificationsRead } from '../api/client';
import type { AppNotification } from '../types';
import './Header.css';

export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRecomputing, setIsRecomputing] = useState(false);
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

  const handleForceSync = useCallback(async () => {
    setIsSyncing(true);
    setShowUserMenu(false);
    try {
      await syncService.forceFullResync();
      window.location.reload();
    } catch (err) {
      console.error('Failed to force sync:', err);
      setIsSyncing(false);
    }
  }, []);

  const handleRecomputeStates = useCallback(async () => {
    setIsRecomputing(true);
    setShowUserMenu(false);
    try {
      const result = await recomputeCardStates();
      console.log('Recomputed card states:', result);
      alert(`Updated ${result.updated} cards (${result.errors} errors)`);
      window.location.reload();
    } catch (err) {
      console.error('Failed to recompute card states:', err);
      alert('Failed to recompute card states. Check console for details.');
      setIsRecomputing(false);
    }
  }, []);

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
                  onClick={handleForceSync}
                  disabled={isSyncing}
                >
                  {isSyncing ? '🔄 Syncing...' : '🔄 Force Full Sync'}
                </button>
                <button
                  className="user-menu-item"
                  onClick={handleRecomputeStates}
                  disabled={isRecomputing}
                >
                  {isRecomputing ? '🔧 Recomputing...' : '🔧 Fix Card States'}
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
                    <button
                      className="user-menu-item"
                      onClick={handleClearCache}
                      disabled={isClearing}
                    >
                      {isClearing ? '🔄 Clearing...' : '🗑️ Clear Cache & Refresh'}
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
