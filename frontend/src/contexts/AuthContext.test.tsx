/**
 * The web sign-in hand-off in AuthProvider (services/signIn.ts): `?code=` is traded at
 * /api/auth/exchange with the verifier this device kept; a bare `?session_token=` only
 * counts on the dev server; Sign out revokes the session with the Bearer token.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AuthProvider, useAuth } from './AuthContext';
import { resetSignInForTests, startSignIn } from '../services/signIn';
import { clearSessionToken } from '../api/client';
import { challengeFor } from '@shared/auth/signin';

const ME = { id: 'u1', email: 'jerome@example.com', name: 'Jerome', role: 'student' };

type Call = { url: string; init?: RequestInit };
let calls: Call[];
let exchangeAnswer: { status: number; body: unknown };

function mockFetch() {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/api/auth/exchange')) return json(exchangeAnswer.status, exchangeAnswer.body);
    if (url.endsWith('/api/auth/me')) {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return auth === 'Bearer tok-1' || auth === 'Bearer legacy' ? json(200, ME) : json(401, { error: 'Not authenticated' });
    }
    if (url.endsWith('/api/auth/logout') || url.endsWith('/api/auth/logout-all')) return json(200, { success: true, signed_out: 2 });
    return json(404, {});
  }));
}

function Probe() {
  const { user, isLoading, authError, logout, logoutAllDevices } = useAuth();
  return (
    <div>
      <span data-testid="state">{isLoading ? 'loading' : user ? `user:${user.id}` : 'signed-out'}</span>
      <span data-testid="error">{authError ?? ''}</span>
      <button onClick={() => { void logout(); }}>out</button>
      <button onClick={() => { void logoutAllDevices(); }}>out-all</button>
    </div>
  );
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;
function render(node: ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(node); });
}
const screen = {
  getByTestId: (id: string) => host!.querySelector(`[data-testid="${id}"]`)!,
  getByText: (text: string) => Array.from(host!.querySelectorAll('button')).find((b) => b.textContent === text)!,
};
async function waitFor(check: () => void, timeoutMs = 2000) {
  const start = Date.now();
  for (;;) {
    try { check(); return; } catch (err) {
      if (Date.now() - start > timeoutMs) throw err;
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    }
  }
}

function setUrl(search: string) {
  window.history.replaceState(null, '', `/decks${search}`);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetSignInForTests();
  clearSessionToken();
  exchangeAnswer = { status: 200, body: { session_token: 'tok-1', expires_at: '2026-11-16T00:00:00Z' } };
  mockFetch();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('AuthProvider sign-in', () => {
  it('starting sign-in keeps a verifier and sends only its challenge', async () => {
    const assign = vi.fn();
    const loc = window.location;
    vi.stubGlobal('location', { ...loc, origin: loc.origin, set href(v: string) { assign(v); }, get href() { return loc.href; } });
    await startSignIn('/api/auth/login?invite=abc');
    const target = new URL(assign.mock.calls[0][0] as string);
    const verifier = sessionStorage.getItem('auth_verifier')!;
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(target.pathname).toBe('/api/auth/login');
    expect(target.searchParams.get('invite')).toBe('abc');
    expect(target.searchParams.get('challenge')).toBe(await challengeFor(verifier));
    expect(target.search).not.toContain(verifier);
  });

  it('trades ?code= for the session with the kept verifier and cleans the address bar', async () => {
    sessionStorage.setItem('auth_verifier', 'V'.repeat(43));
    setUrl('?code=one-time-code&tab=2');
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('user:u1'));
    const ex = calls.find((c) => c.url.endsWith('/api/auth/exchange'))!;
    expect(JSON.parse(String(ex.init?.body))).toEqual({ code: 'one-time-code', verifier: 'V'.repeat(43) });
    expect(localStorage.getItem('session_token')).toBe('tok-1');
    expect(window.location.search).toBe('?tab=2');
    // The verifier is single use.
    expect(sessionStorage.getItem('auth_verifier')).toBeNull();
    expect(localStorage.getItem('auth_verifier')).toBeNull();
  });

  it('falls back to the localStorage copy of the verifier (a WebView that lost sessionStorage)', async () => {
    localStorage.setItem('auth_verifier', JSON.stringify({ v: 'W'.repeat(43), at: Date.now() }));
    setUrl('?code=c2');
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('user:u1'));
    const ex = calls.find((c) => c.url.endsWith('/api/auth/exchange'))!;
    expect(JSON.parse(String(ex.init?.body)).verifier).toBe('W'.repeat(43));
  });

  it('a code this device never asked for signs nobody in and says why', async () => {
    setUrl('?code=attackers-code');
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('signed-out'));
    expect(calls.some((c) => c.url.endsWith('/api/auth/exchange'))).toBe(false);
    expect(screen.getByTestId('error').textContent).toMatch(/wasn’t started on this device/);
    expect(localStorage.getItem('session_token')).toBeNull();
  });

  it('shows the server’s refusal (expired code)', async () => {
    sessionStorage.setItem('auth_verifier', 'V'.repeat(43));
    exchangeAnswer = { status: 400, body: { error: 'expired', reason: 'expired' } };
    setUrl('?code=old');
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('error').textContent).toMatch(/took too long/));
    expect(screen.getByTestId('state').textContent).toBe('signed-out');
  });

  it('ignores ?session_token= outside the dev server (login CSRF)', async () => {
    vi.stubEnv('DEV', false);
    setUrl('?session_token=legacy');
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('signed-out'));
    expect(localStorage.getItem('session_token')).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('still accepts ?session_token= on the dev server (E2E logins)', async () => {
    vi.stubEnv('DEV', true);
    setUrl('?session_token=legacy');
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('user:u1'));
    expect(localStorage.getItem('session_token')).toBe('legacy');
  });

  it('sign out sends the Bearer token so the server revokes the session', async () => {
    localStorage.setItem('session_token', 'tok-1');
    setUrl('');
    vi.stubGlobal('location', { ...window.location, href: '/decks', pathname: '/decks', search: '', hash: '' });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('user:u1'));
    await act(async () => { (screen.getByText('out') as HTMLButtonElement).click(); });
    const out = calls.find((c) => c.url.endsWith('/api/auth/logout'))!;
    expect((out.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    await waitFor(() => expect(localStorage.getItem('session_token')).toBeNull());
  });

  it('sign out of all devices calls logout-all with the token, then signs out here', async () => {
    localStorage.setItem('session_token', 'tok-1');
    setUrl('');
    vi.stubGlobal('location', { ...window.location, href: '/decks', pathname: '/decks', search: '', hash: '' });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('user:u1'));
    await act(async () => { (screen.getByText('out-all') as HTMLButtonElement).click(); });
    const all = calls.find((c) => c.url.endsWith('/api/auth/logout-all'))!;
    expect((all.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect(all.init?.method).toBe('POST');
    await waitFor(() => expect(localStorage.getItem('session_token')).toBeNull());
  });
});
