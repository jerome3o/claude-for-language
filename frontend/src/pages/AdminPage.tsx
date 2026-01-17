import { useEffect, useState } from 'react';
import { AdminUser } from '../types';
import { getAdminUsers } from '../api/client';
import './AdminPage.css';

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
            <span className="stat-number">{users.filter(u => u.is_admin).length}</span>
            <span className="stat-label">Admins</span>
          </div>
        </div>

        <h2>All Users</h2>
        <div className="users-table-container">
          <table className="users-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Created</th>
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
                  <td>{user.role}</td>
                  <td>{formatDate(user.created_at)}</td>
                  <td>{formatDate(user.last_login_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
