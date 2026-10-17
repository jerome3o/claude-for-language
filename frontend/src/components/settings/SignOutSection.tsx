/**
 * Settings → Sign out · Sign out of all devices. "All devices" revokes every session of the
 * account on the server (POST /api/auth/logout-all) — phones, tablets, the desktop app, this
 * browser — after an in-page confirm; offline it says so and changes nothing.
 */
import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNetwork } from '../../contexts/NetworkContext';
import { track } from '../../services/analytics';

export function SignOutSection() {
  const { logout, logoutAllDevices } = useAuth();
  const { isOnline } = useNetwork();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOutEverywhere = async () => {
    setBusy(true);
    setError(null);
    try {
      track('settings.sign_out_all', {});
      await logoutAllDevices();
    } catch {
      setError('Couldn’t reach the server, so nothing was signed out. Try again when you’re online.');
      setBusy(false);
    }
  };

  return (
    <div className="settings-section" data-testid="settings-signout">
      <button className="btn btn-secondary export-btn settings-signout" onClick={() => { void logout(); }}>
        Sign out
      </button>

      {!confirming ? (
        <button
          type="button"
          className="btn btn-secondary export-btn settings-signout settings-signout-all"
          onClick={() => { setConfirming(true); setError(null); }}
          data-testid="signout-all"
        >
          Sign out of all devices…
        </button>
      ) : (
        <div className="settings-signout-confirm" role="group" aria-label="Sign out of all devices" data-testid="signout-all-confirm">
          <strong>Sign out everywhere?</strong>
          <p>
            Every phone, tablet and computer signed in to this account — this one too — will have to
            sign in with Google again. Use this if you lost a device or signed in somewhere you shouldn’t have.
          </p>
          <div className="settings-signout-confirm-actions">
            <button
              type="button"
              className="btn settings-signout-danger"
              onClick={() => { void signOutEverywhere(); }}
              disabled={busy || !isOnline}
              data-testid="signout-all-go"
            >
              {busy ? 'Signing out…' : 'Sign out everywhere'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
          </div>
          {!isOnline && <div className="export-error">You’re offline — this needs a connection.</div>}
        </div>
      )}
      {error && <div className="export-error" role="alert">{error}</div>}
    </div>
  );
}
