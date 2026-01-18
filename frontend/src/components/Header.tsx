import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState, useRef, useEffect } from 'react';
import './Header.css';

export function Header() {
  const { user, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
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

  return (
    <header className="header">
      <div className="container header-content">
        <Link to="/" className="header-title">
          汉语学习
        </Link>
        <div className="header-right">
          <nav className="header-nav">
            <Link to="/">Home</Link>
            <Link to="/decks">Decks</Link>
            <Link to="/progress">Progress</Link>
            <Link to="/connections">Connections</Link>
            {user?.is_admin && <Link to="/admin">Admin</Link>}
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
                <button className="user-menu-item" onClick={handleLogout}>
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
