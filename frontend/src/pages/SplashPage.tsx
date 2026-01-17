import { useAuth } from '../contexts/AuthContext';
import { useSearchParams } from 'react-router-dom';
import './SplashPage.css';

export function SplashPage() {
  const { login } = useAuth();
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

  return (
    <div className="splash-page">
      <div className="splash-content">
        <h1 className="splash-title">
          <span className="splash-hanzi">汉语学习</span>
          <span className="splash-subtitle">Chinese Learning</span>
        </h1>

        <p className="splash-description">
          Master Chinese vocabulary with spaced repetition. Practice reading, writing, and listening with intelligent flashcards.
        </p>

        <div className="splash-features">
          <div className="splash-feature">
            <span className="feature-icon">🎯</span>
            <span>Spaced Repetition</span>
          </div>
          <div className="splash-feature">
            <span className="feature-icon">🎧</span>
            <span>Native Audio</span>
          </div>
          <div className="splash-feature">
            <span className="feature-icon">🤖</span>
            <span>AI-Powered</span>
          </div>
        </div>

        {error && (
          <div className="splash-error">
            {error === 'oauth_error' && 'Google sign in was cancelled or failed. Please try again.'}
            {error === 'auth_failed' && 'Authentication failed. Please try again.'}
            {error === 'invalid_state' && 'Security check failed. Please try again.'}
            {error === 'missing_params' && 'Something went wrong. Please try again.'}
          </div>
        )}

        <button className="splash-login-button" onClick={login}>
          <svg viewBox="0 0 24 24" width="20" height="20" className="google-icon">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </button>

        <p className="splash-footer">
          Your vocabulary decks and study progress are saved to your account.
        </p>
      </div>
    </div>
  );
}
