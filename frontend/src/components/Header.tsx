import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState, useRef, useEffect, useCallback } from 'react';
import { getPendingFeatureRequestCount, getUnreadNotificationCount, getNotifications, markNotificationRead, markAllNotificationsRead } from '../api/client';
import type { AppNotification } from '../types';
import { TabBar } from './nav/TabBar';
import './Header.css';

/**
 * App chrome: the title, the notification bell and the avatar (which opens
 * the More page), plus the bottom tab bar. Everything that used to live in
 * the avatar dropdown is on /more now, grouped.
 */
export function Header() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Close the notifications dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
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
    }
  }, [navigate]);

  const handleMarkAllRead = useCallback(async () => {
    await markAllNotificationsRead().catch(() => {});
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  }, []);

  return (
    <>
    <header className="header">
      <div className="container header-content">
        <Link to="/" className="header-title">
          汉语学习
        </Link>
        <div className="header-right">
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
          <div className="header-user">
            <Link
              to="/more"
              className="user-button"
              aria-label="More"
              title={user.name || user.email || 'More'}
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
            </Link>
          </div>
        )}
        </div>
      </div>
    </header>
    {user && <TabBar />}
    </>
  );
}
