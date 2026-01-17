import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { AuthUser } from '../types';
import { getCurrentUser, logout as apiLogout, getLoginUrl, authEvents, setSessionToken, clearSessionToken } from '../api/client';

const SESSION_TOKEN_KEY = 'session_token';

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
    } catch {
      setUser(null);
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

      try {
        const userData = await getCurrentUser();
        setUser(userData);
      } catch {
        // Clear invalid token
        localStorage.removeItem(SESSION_TOKEN_KEY);
        clearSessionToken();
        setUser(null);
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
