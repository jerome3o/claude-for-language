/**
 * The signed-out state (services/signedOut.ts): a 401 from our API — at start-up on /auth/me or on
 * any later request — keeps the cached user and the session (nothing local is thrown away) and
 * shows "You're signed out" with Sign in on every screen; a request that works again clears it.
 * The read card's transcription row says "Signed out — sign in again" instead of "Couldn't transcribe".
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { SignedOutBanner } from './SignedOutBanner';
import { YouSaidFailed } from '../study/YouSaid';
import { clearSignedOut, isSignedOut, markSignedOut, resetSignedOutForTests } from '../../services/signedOut';
import { getDecks } from '../../api/client';
import { resetSignInForTests } from '../../services/signIn';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
async function render(node: React.ReactNode, path = '/decks'): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return host;
}

const USER = { id: 'u1', email: 'jerome@example.com', name: 'Jerome' };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetSignedOutForTests();
  resetSignInForTests();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
  clearSignedOut();
});

function stubFetch(status: (url: string) => number) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const s = status(url);
    return new Response(s === 200 ? JSON.stringify(url.includes('/auth/me') ? USER : []) : JSON.stringify({ error: 'Unauthorized' }), { status: s, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('signed-out banner', () => {
  it('a 401 on /auth/me at start keeps the cached user and the session, and shows the banner', async () => {
    localStorage.setItem('session_token', 'tok-old');
    localStorage.setItem('cached_user', JSON.stringify(USER));
    stubFetch(() => 401);
    const el = await render(<AuthProvider><SignedOutBanner /></AuthProvider>);
    const banner = el.querySelector('[data-testid="signed-out-banner"]');
    expect(banner?.textContent).toContain("You're signed out — sign in again to sync, transcribe and use Claude.");
    expect(el.querySelector('[data-testid="signed-out-signin"]')?.textContent).toBe('Sign in');
    // Nothing thrown away: the app keeps running on the cached user and its local data.
    expect(localStorage.getItem('cached_user')).not.toBeNull();
    expect(localStorage.getItem('session_token')).toBe('tok-old');
    expect(isSignedOut()).toBe(true);
    // Persisted: a reload still knows.
    expect(JSON.parse(localStorage.getItem('signed-out-v1')!).where).toBe('profile');
  });

  it('a 401 on any later request turns it on; a request that works clears it', async () => {
    localStorage.setItem('session_token', 'tok');
    localStorage.setItem('cached_user', JSON.stringify(USER));
    let code = 200;
    stubFetch(() => code);
    const el = await render(<AuthProvider><SignedOutBanner /></AuthProvider>);
    expect(el.querySelector('[data-testid="signed-out-banner"]')).toBeNull();
    code = 401;
    await act(async () => { await getDecks().catch(() => {}); });
    expect(el.querySelector('[data-testid="signed-out-banner"]')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('signed-out-v1')!).where).toBe('sync');
    code = 200;
    await act(async () => { await getDecks(); });
    expect(el.querySelector('[data-testid="signed-out-banner"]')).toBeNull();
  });

  it('a study session gets the compact pill', async () => {
    localStorage.setItem('session_token', 'tok');
    localStorage.setItem('cached_user', JSON.stringify(USER));
    stubFetch(() => 200);
    const el = await render(<AuthProvider><SignedOutBanner /></AuthProvider>, '/study');
    act(() => { markSignedOut('/api/transcribe'); });
    expect(el.querySelector('[data-testid="signed-out-banner"]')?.getAttribute('data-variant')).toBe('compact');
  });

  it('signing out never counts as signed out', () => {
    expect(markSignedOut('/api/auth/logout')).toBe(false);
    expect(isSignedOut()).toBe(false);
  });
});

describe('transcription row', () => {
  it('says "Signed out — sign in again" for a 401', async () => {
    const el = await render(<YouSaidFailed onRetry={() => {}} signedOut />);
    expect(el.textContent).toContain('Signed out — sign in again');
    expect(el.textContent).not.toContain('Couldn’t transcribe');
  });
});
