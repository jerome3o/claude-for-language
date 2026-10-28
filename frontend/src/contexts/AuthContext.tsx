import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { STUDY_BUDGET_CHANGED, writeStudyBudget } from '../services/studyBudget';
import { writeNewCardOrder } from '../services/newCardOrder';
import { writeBurySiblings } from '../services/burySiblings';
import { writeSkipHandwriting } from '../services/skipHandwriting';
import type { StudyBudgetInfo } from '@shared/decks';
import { writeConversationVoices } from '../services/conversationVoices';
import { writeConversationAudio } from '../services/conversationAudio';
import { AuthUser } from '../types';
import { setSharingUsage } from '../services/analytics';
import { API_PATH, getCurrentUser, logout as apiLogout, logoutAllDevices as apiLogoutAllDevices, getLoginUrl, authEvents, setSessionToken, clearSessionToken, refreshMediaTokenIfDue } from '../api/client';
import { completeSignInFromUrl, startSignIn } from '../services/signIn';
import { clearSignedOut, markSignedOut } from '../services/signedOut';
import { countUnsynced } from '../services/unsyncedData';
import { clearAccountData } from '../db/database';
import { accountSwitchFor, unsyncedTotal, type AccountRef, type UnsyncedCounts } from '@shared/auth/session';

const SESSION_TOKEN_KEY = 'session_token';
const CACHED_USER_KEY = 'cached_user';
/** Whose data this browser's IndexedDB holds ({ id, email }): decides same account vs a different one at sign-in. */
const ACCOUNT_OWNER_KEY = 'account-owner-v1';
const SWITCH_PENDING_KEY = 'account-switch-pending';

function readOwner(): AccountRef | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_OWNER_KEY) ?? localStorage.getItem(CACHED_USER_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { id?: unknown; email?: unknown };
    return { id: typeof v.id === 'string' ? v.id : null, email: typeof v.email === 'string' ? v.email : null };
  } catch {
    return null;
  }
}

function writeOwner(user: { id: string; email?: string | null }) {
  try { localStorage.setItem(ACCOUNT_OWNER_KEY, JSON.stringify({ id: user.id, email: user.email ?? null })); } catch { /* storage unavailable */ }
}

/** A different account signed in while the previous one's data hasn't uploaded (AccountGuards asks). */
export interface AccountSwitchPrompt {
  counts: UnsyncedCounts;
  previousEmail: string | null;
  nextEmail: string | null;
}

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
  /** Settings → Sign out found data that hasn't uploaded: AccountGuards asks Sync first / Sign out anyway. */
  signOutPrompt: UnsyncedCounts | null;
  /** Sign out now (nothing local is deleted either way). */
  confirmSignOut: () => Promise<void>;
  cancelSignOut: () => void;
  /** Set while a different account's sign-in waits for "Sign back in" / "Discard". */
  accountSwitch: AccountSwitchPrompt | null;
  resolveAccountSwitch: (choice: 'sign_back_in' | 'discard') => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signOutPrompt, setSignOutPrompt] = useState<UnsyncedCounts | null>(null);
  const [accountSwitch, setAccountSwitch] = useState<AccountSwitchPrompt | null>(null);
  const pendingSwitchUser = useRef<AuthUser | null>(null);
  /** The new account's session while the question is open: NOT in use, so nothing of the previous account uploads into it. */
  const pendingSwitchToken = useRef<string | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      const userData = await getCurrentUser();
      setUser(userData);
      writeStudyBudget(userData);
      writeNewCardOrder(userData as { new_card_order?: unknown });
      writeBurySiblings(userData as { bury_siblings?: unknown });
      writeSkipHandwriting(userData as { skip_handwriting?: unknown });
      writeConversationVoices(userData.conversation_voices);
      writeConversationAudio(userData.conversation_audio);
      if (typeof userData.share_usage === 'boolean') setSharingUsage(userData.share_usage);
      localStorage.setItem(CACHED_USER_KEY, JSON.stringify(userData));
      writeOwner(userData);
      clearSignedOut();
    } catch (err) {
      // A 401 is the signed-out state (banner + Sign in), never the sign-in page: the app keeps
      // working on its local data. A network error changes nothing (offline-first).
      if (err instanceof Error && err.message === 'Unauthorized') markSignedOut('/api/auth/me');
    }
  }, []);

  // Initial load - check for token in URL first
  useEffect(() => {
    const loadUser = async () => {
      // Back from Google: `?code=` traded for the session at /api/auth/exchange with the
      // verifier this device kept (services/signIn.ts). A bare `?session_token=` is only
      // honoured on the dev server / inside an older desktop build (login CSRF).
      const signIn = await completeSignInFromUrl();

      const previousOwner = readOwner();
      // A different account's sign-in still waiting for "Sign back in" / "Discard" (a reload
      // must not slip past the question).
      let freshSignIn = sessionStorage.getItem(SWITCH_PENDING_KEY) === '1';
      if (signIn && 'token' in signIn) {
        // A dev-server / E2E `?session_token=` switches accounts freely, as before.
        if (!signIn.legacy) freshSignIn = true;
        localStorage.setItem(SESSION_TOKEN_KEY, signIn.token);
        // A fresh sign-in may be another account than the one cached.
        localStorage.removeItem(CACHED_USER_KEY);
        setSessionToken(signIn.token);
        clearSignedOut();
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
        if (freshSignIn) {
          // Signing in again never wipes anything; only a DIFFERENT account replaces the local
          // data, and never while something hasn't uploaded without asking (shared/auth/session.ts).
          const counts = await countUnsynced();
          const decision = accountSwitchFor(previousOwner, userData, counts);
          if (decision === 'switch_blocked') {
            pendingSwitchUser.current = userData;
            // Park the new session: no outbox / sync / analytics may send the previous account's
            // work with it while the question is open.
            pendingSwitchToken.current = localStorage.getItem(SESSION_TOKEN_KEY);
            localStorage.removeItem(SESSION_TOKEN_KEY);
            clearSessionToken();
            try { sessionStorage.setItem(SWITCH_PENDING_KEY, '1'); } catch { /* storage unavailable */ }
            setAccountSwitch({ counts, previousEmail: previousOwner?.email ?? null, nextEmail: userData.email ?? null });
            setIsLoading(false);
            return;
          }
          if (decision === 'switch') await clearAccountData().catch((e) => console.warn('[auth] clearing the previous account failed', e));
        }
        writeOwner(userData);
        try { sessionStorage.removeItem(SWITCH_PENDING_KEY); } catch { /* storage unavailable */ }
        clearSignedOut();
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
        // A real 401: with a cached user this is the signed-out state — the app keeps running on
        // its local data with the banner and Sign in (nothing is thrown away, the outboxes upload
        // after signing in again). Never signed in on this browser → the sign-in page.
        // Network failures keep the cached user (offline-first).
        if (err instanceof Error && err.message === 'Unauthorized') {
          if (localStorage.getItem(CACHED_USER_KEY)) {
            markSignedOut('/api/auth/me');
          } else {
            localStorage.removeItem(SESSION_TOKEN_KEY);
            clearSessionToken();
            setUser(null);
          }
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
    // Any 401 from our API: the signed-out state (banner), the user and local data stay.
    authEvents.onUnauthorized = (path) => {
      markSignedOut(path ?? '');
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

  const doLogout = useCallback(async () => {
    // Revokes this device's session on the server (Bearer token) before forgetting it.
    // IndexedDB and the outboxes are never touched: the same account signing in again resumes.
    await apiLogout();
    clearSignedOut();
    signOutLocally();
  }, [signOutLocally]);

  /** Settings / More → Sign out: asks first when something hasn't uploaded (AccountGuards). */
  const logout = useCallback(async () => {
    const counts = await countUnsynced().catch(() => ({ reviews: 0, recordings: 0, other: 0 }));
    if (unsyncedTotal(counts) > 0) {
      setSignOutPrompt(counts);
      return;
    }
    await doLogout();
  }, [doLogout]);

  const confirmSignOut = useCallback(async () => {
    setSignOutPrompt(null);
    await doLogout();
  }, [doLogout]);

  const cancelSignOut = useCallback(() => setSignOutPrompt(null), []);

  const resolveAccountSwitch = useCallback(async (choice: 'sign_back_in' | 'discard') => {
    const next = pendingSwitchUser.current;
    const parked = pendingSwitchToken.current;
    pendingSwitchToken.current = null;
    if (choice === 'sign_back_in') {
      // Give the new account's session back and sign in again as the previous one.
      if (parked) await fetch(`${API_PATH}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${parked}` } }).catch(() => {});
      pendingSwitchUser.current = null;
      try { sessionStorage.removeItem(SWITCH_PENDING_KEY); } catch { /* storage unavailable */ }
      setAccountSwitch(null);
      void startSignIn(getLoginUrl());
      return;
    }
    if (!next) return;
    if (parked) {
      localStorage.setItem(SESSION_TOKEN_KEY, parked);
      setSessionToken(parked);
    }
    await clearAccountData().catch((e) => console.warn('[auth] clearing the previous account failed', e));
    writeOwner(next);
    try { sessionStorage.removeItem(SWITCH_PENDING_KEY); } catch { /* storage unavailable */ }
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(next));
    pendingSwitchUser.current = null;
    setAccountSwitch(null);
    setUser(next);
  }, []);

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
        signOutPrompt,
        confirmSignOut,
        cancelSignOut,
        accountSwitch,
        resolveAccountSwitch,
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
