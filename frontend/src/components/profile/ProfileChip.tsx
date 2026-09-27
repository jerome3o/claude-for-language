import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import './profile.css';

/** "Your profile" shortcut for the Students dashboard header (avatar only on phones). */
export function ProfileChip() {
  const { user } = useAuth();
  if (!user) return null;
  const initial = (user.name?.trim()?.[0] || user.email?.[0] || '?').toUpperCase();
  return (
    <Link to="/profile" className="pf-chip" aria-label="Edit your profile" data-testid="profile-chip">
      {user.picture_url ? <img src={user.picture_url} alt="" /> : <span className="pf-chip-initial" aria-hidden="true">{initial}</span>}
      <span className="pf-chip-text">Your profile</span>
    </Link>
  );
}

const NUDGE_KEY = 'profile-nudge-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(NUDGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * On the tutor's Students dashboard until they've written an About me (their
 * students see it on their page, and invite links show it), unless hidden.
 */
export function ProfileNudge() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (!user || user.about || dismissed) return null;
  return (
    <div className="pf-nudge" data-testid="profile-nudge">
      <div className="pf-nudge-text">
        <strong>Introduce yourself to your students</strong>
        Add a photo and a line about you — it shows on your page in their app and on your invite links.
      </div>
      <button
        type="button"
        className="pf-nudge-dismiss"
        aria-label="Hide"
        onClick={() => {
          try { localStorage.setItem(NUDGE_KEY, '1'); } catch { /* private mode */ }
          setDismissed(true);
        }}
      >
        ×
      </button>
      <Link to="/profile" className="btn btn-primary">Edit profile</Link>
    </div>
  );
}
