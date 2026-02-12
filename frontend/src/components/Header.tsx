import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState, useRef, useEffect, useCallback } from 'react';
import { syncService } from '../services/sync';
import { recomputeCardStates } from '../api/client';
import './Header.css';

export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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
            <Link to="/connections">Connections</Link>
          </nav>
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
