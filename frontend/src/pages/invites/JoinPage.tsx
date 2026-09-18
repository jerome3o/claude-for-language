import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getPublicInvite, getInviteLoginUrl, redeemInvite } from '../../api/invites';
import type { PublicInvite } from '../../types/invites';
import './JoinPage.css';

/**
 * /join/<token> — the very first screen an invited student sees. Public.
 * One warm sentence about who invited them and one button.
 */
export function JoinPage() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [invite, setInvite] = useState<PublicInvite | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    getPublicInvite(token)
      .then(data => { if (!cancelled) setInvite(data); })
      .catch(() => { if (!cancelled) setLoadError("Couldn't reach the server. Check your connection and try again."); });
    return () => { cancelled = true; };
  }, [token]);

  const acceptAsMe = async () => {
    setIsAccepting(true);
    setAcceptError(null);
    try {
      await redeemInvite(token);
      navigate('/connections', { replace: true });
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : 'Could not accept this invite');
    } finally {
      setIsAccepting(false);
    }
  };

  const inviterName = invite?.inviter_name || 'Your tutor';
  const pronounLine = invite?.inviter_role === 'student'
    ? `${inviterName} would like you to be their tutor.`
    : invite?.inviter_role === 'tutor'
      ? `${inviterName} invited you to learn Chinese together.`
      : `${inviterName} invited you to the app.`;

  let body;
  if (loadError) {
    body = (
      <>
        <p className="join-error">{loadError}</p>
        <button type="button" className="join-secondary" onClick={() => window.location.reload()}>Try again</button>
      </>
    );
  } else if (invite === undefined || authLoading) {
    body = <p className="join-muted">Checking your invite…</p>;
  } else if (invite === null) {
    body = (
      <>
        <h2 className="join-heading">This invite link isn't valid</h2>
        <p className="join-muted">
          Check that you copied the whole link, or ask the person who invited you for a new one.
        </p>
        <Link to="/" className="join-secondary">Go to the app</Link>
      </>
    );
  } else if (!invite.valid) {
    const why = invite.status === 'revoked'
      ? 'This invite was cancelled by the person who sent it.'
      : invite.status === 'expired'
        ? 'This invite has expired.'
        : 'This invite has already been used.';
    body = (
      <>
        {invite.inviter_picture_url ? (
          <img src={invite.inviter_picture_url} alt="" className="join-avatar" />
        ) : (
          <div className="join-avatar join-avatar-placeholder">{inviterName[0]?.toUpperCase()}</div>
        )}
        <h2 className="join-heading">{why}</h2>
        <p className="join-muted">Ask {inviterName} for a new link.</p>
        <Link to="/" className="join-secondary">Go to the app</Link>
      </>
    );
  } else {
    body = (
      <>
        {invite.inviter_picture_url ? (
          <img src={invite.inviter_picture_url} alt="" className="join-avatar" />
        ) : (
          <div className="join-avatar join-avatar-placeholder">{inviterName[0]?.toUpperCase()}</div>
        )}
        <h2 className="join-heading">{pronounLine}</h2>
        <p className="join-muted">
          {invite.shares_decks
            ? 'Your first deck of words will be waiting for you.'
            : 'Study a few words every day and hear them spoken by a native voice.'}
          {invite.email_bound && ' This invite is for a specific Google account.'}
        </p>

        {isAuthenticated && user ? (
          <>
            <button
              type="button"
              className="join-google-button"
              onClick={acceptAsMe}
              disabled={isAccepting}
            >
              {isAccepting ? 'Accepting…' : `Accept as ${user.name || user.email}`}
            </button>
            {acceptError && <p className="join-error">{acceptError}</p>}
            <p className="join-footnote">
              Not you? <a href={getInviteLoginUrl(token)}>Continue with a different Google account</a>
            </p>
          </>
        ) : (
          <>
            <a className="join-google-button" href={getInviteLoginUrl(token)}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </a>
            <p className="join-footnote">
              That's the only step — no password, no form.
            </p>
          </>
        )}
      </>
    );
  }

  return (
    <div className="join-page">
      <div className="join-card">
        <div className="join-brand">
          <span className="join-hanzi">汉语学习</span>
          <span className="join-brand-sub">Chinese Learning</span>
        </div>
        {body}
      </div>
    </div>
  );
}
