/**
 * "You're signed out" on every screen (CLAUDE.md "Sign-in & sessions", services/signedOut.ts):
 * shown while a 401 from our API says the session is gone and nobody has signed in again.
 * Not dismissable — it goes when a request works again or after Sign in. Local data and every
 * outbox are kept, so whatever was done meanwhile uploads after signing in to the same account.
 * Normal pages get the full card first in the page flow; full-screen pages (a study session…) a compact pill
 * that never covers the session's controls. Lab twin: ui/kit/SignedOutBanner.kt.
 */
import { useLocation } from 'react-router-dom';
import { signedOutBanner } from '@shared/auth/session';
import { useAuth } from '../../contexts/AuthContext';
import { useSignedOut } from '../../services/signedOut';
import { isImmersiveRoute } from '../nav/tabs';
import './SignedOutBanner.css';

export function SignedOutBannerView({ compact = false, onSignIn }: { compact?: boolean; onSignIn: () => void }) {
  if (compact) {
    return (
      <button type="button" className="signed-out-pill" onClick={onSignIn} data-testid="signed-out-banner" data-variant="compact">
        <span aria-hidden="true">⚠️</span> Signed out · <strong>Sign in</strong>
      </button>
    );
  }
  return (
    <div className="signed-out-banner" role="alert" data-testid="signed-out-banner" data-variant="full">
      <span className="signed-out-banner-icon" aria-hidden="true">🔒</span>
      <span className="signed-out-banner-text">{signedOutBanner('web')}</span>
      <button type="button" className="signed-out-banner-signin" onClick={onSignIn} data-testid="signed-out-signin">
        Sign in
      </button>
    </div>
  );
}

export function SignedOutBanner() {
  const signedOut = useSignedOut();
  const { isAuthenticated, login } = useAuth();
  const { pathname } = useLocation();
  if (!signedOut || !isAuthenticated) return null;
  return <SignedOutBannerView compact={isImmersiveRoute(pathname)} onSignIn={login} />;
}
