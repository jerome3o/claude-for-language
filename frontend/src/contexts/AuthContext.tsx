import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { STUDY_BUDGET_CHANGED, writeStudyBudget } from '../services/studyBudget';
import { writeNewCardOrder } from '../services/newCardOrder';
import type { StudyBudgetInfo } from '@shared/decks';
import { writeConversationVoices } from '../services/conversationVoices';
import { writeConversationAudio } from '../services/conversationAudio';
import { AuthUser } from '../types';
import { setSharingUsage } from '../services/analytics';
import { getCurrentUser, logout as apiLogout, logoutAllDevices as apiLogoutAllDevices, getLoginUrl, authEvents, setSessionToken, clearSessionToken, refreshMediaTokenIfDue } from '../api/client';
import { completeSignInFromUrl, startSignIn } from '../services/signIn';

const SESSION_TOKEN_KEY = 'session_token';
const CACHED_USER_KEY = 'cached_user';

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Why the last sign-in didn't finish (the code exchange refused / failed), for the sign-in screen. */
  authError: string | null;
  login: () => void;
  logout: () => Promise<void>;
  /** Settings → "Sign out of all devices": revokes every session of the account, then signs out here. */
  logoutAllDevices: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      const userData = await getCurrentUser();
      setUser(userData);
      writeStudyBudget(userData);
      writeNewCardOrder(userData as { new_card_order?: unknown });
      writeConversationVoices(userData.conversation_voices);
      writeConversationAudio(userData.conversation_audio);
      if (typeof userData.share_usage === 'boolean') setSharingUsage(userData.share_usage);
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
      // Back from Google: `?code=` traded for the session at /api/auth/exchange with the
      // verifier this device kept (services/signIn.ts). A bare `?session_token=` is only
      // honoured on the dev server / inside an older desktop build (login CSRF).
      const signIn = await completeSignInFromUrl();

      if (signIn && 'token' in signIn) {
        localStorage.setItem(SESSION_TOKEN_KEY, signIn.token);
        // A fresh sign-in may be another account than the one cached.
        localStorage.removeItem(CACHED_USER_KEY);
        setSessionToken(signIn.token);
      } else {
        if (signIn && 'error' in signIn) setAuthError(signIn.error);
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
        // Private recordings / photos play with a media token (api/mediaToken.ts).
        void refreshMediaTokenIfDue();
        writeStudyBudget(userData);
        writeNewCardOrder(userData as { new_card_order?: unknown });
        writeConversationVoices(userData.conversation_voices);
        writeConversationAudio(userData.conversation_audio);
        if (typeof userData.share_usage === 'boolean') setSharingUsage(userData.share_usage);
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

  // A sync brought a new daily budget (e.g. the tutor changed it): keep the user in step.
  useEffect(() => {
    const onBudget = (e: Event) => {
      const info = (e as CustomEvent<Partial<StudyBudgetInfo>>).detail;
      if (!info || !('is_default' in info)) return;
      setUser((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          new_cards_per_day: info.new_cards_per_day,
          secondary_cards_per_day: info.secondary_cards_per_day,
          study_budget: info as StudyBudgetInfo,
        };
        try { localStorage.setItem(CACHED_USER_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
        return next;
      });
    };
    window.addEventListener(STUDY_BUDGET_CHANGED, onBudget);
    return () => window.removeEventListener(STUDY_BUDGET_CHANGED, onBudget);
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
    void startSignIn(getLoginUrl());
  }, []);

  const signOutLocally = useCallback(() => {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(CACHED_USER_KEY);
    clearSessionToken();
    setUser(null);
    window.location.href = '/';
  }, []);

  const logout = useCallback(async () => {
    // Revokes this device's session on the server (Bearer token) before forgetting it.
    await apiLogout();
    signOutLocally();
  }, [signOutLocally]);

  const logoutAllDevices = useCallback(async () => {
    // Throws when the server didn't do it (offline): the caller shows why, nothing is cleared.
    await apiLogoutAllDevices();
    signOutLocally();
  }, [signOutLocally]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        authError,
        login,
        logout,
        logoutAllDevices,
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
