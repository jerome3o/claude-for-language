import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { AuthUser } from '../types';
import { getCurrentUser, logout as apiLogout, getLoginUrl, authEvents, setSessionToken, clearSessionToken } from '../api/client';

const SESSION_TOKEN_KEY = 'session_token';
const CACHED_USER_KEY = 'cached_user';

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const userData = await getCurrentUser();
      setUser(userData);
      localStorage.setItem(CACHED_USER_KEY, JSON.stringify(userData));
    } catch (err) {
      // Only sign out on a real 401 — a network error must not log the user
      // out (offline-first: study on the train stays signed in)
      if (err instanceof Error && err.message === 'Unauthorized') {
        localStorage.removeItem(CACHED_USER_KEY);
        setUser(null);
      }
    }
  }, []);

  // Initial load - check for token in URL first
  useEffect(() => {
    const loadUser = async () => {
      // Check for session token in URL (from OAuth callback)
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get('session_token');

      if (urlToken) {
        // Store token and clear from URL
        localStorage.setItem(SESSION_TOKEN_KEY, urlToken);
        setSessionToken(urlToken);
        // Clean up URL
        window.history.replaceState({}, '', window.location.pathname);
      } else {
        // Check localStorage for existing token
        const storedToken = localStorage.getItem(SESSION_TOKEN_KEY);
        if (storedToken) {
          setSessionToken(storedToken);
        }
      }

      // Optimistic boot: render immediately from the cached user instead of
      // blocking first paint on /api/auth/me (which can hang ~10s on a bad
      // connection before the service worker cache kicks in). The real check
      // still runs below and corrects the cache.
      const cachedUser = localStorage.getItem(CACHED_USER_KEY);
      if (cachedUser) {
        try {
          setUser(JSON.parse(cachedUser) as AuthUser);
          setIsLoading(false);
        } catch {
          localStorage.removeItem(CACHED_USER_KEY);
        }
      }

      try {
        const userData = await getCurrentUser();
        setUser(userData);
        localStorage.setItem(CACHED_USER_KEY, JSON.stringify(userData));
      } catch (err) {
        // Only clear the session on a real 401. Network failures keep the
        // cached user — signing the user out because the train has bad
        // reception would defeat the offline-first design.
        if (err instanceof Error && err.message === 'Unauthorized') {
          localStorage.removeItem(SESSION_TOKEN_KEY);
          localStorage.removeItem(CACHED_USER_KEY);
          clearSessionToken();
          setUser(null);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadUser();
  }, []);

  // Set up unauthorized handler
  useEffect(() => {
    authEvents.onUnauthorized = () => {
      setUser(null);
    };
    return () => {
      authEvents.onUnauthorized = () => {};
    };
  }, []);

  const login = useCallback(() => {
    window.location.href = getLoginUrl();
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(CACHED_USER_KEY);
    clearSessionToken();
    setUser(null);
    window.location.href = '/';
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
