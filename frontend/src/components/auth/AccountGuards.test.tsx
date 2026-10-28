/**
 * Signing in again never wipes data; Sign out asks first when something hasn't uploaded; a
 * DIFFERENT account signing in clears the previous one's data only when everything uploaded, and
 * otherwise asks (Sign back in / Discard) before anything goes (CLAUDE.md "Sign-in & sessions").
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../../contexts/AuthContext';
import { AccountGuards } from './AccountGuards';
import { db } from '../../db/database';
import { resetSignInForTests } from '../../services/signIn';

vi.mock('../../contexts/NetworkContext', () => ({ useNetwork: () => ({ triggerSync: async () => {}, isOnline: true }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
let auth: ReturnType<typeof useAuth> | null = null;
function Probe() {
  auth = useAuth();
  return <span data-testid="who">{auth.user?.email ?? 'none'}</span>;
}
async function render(): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<MemoryRouter><AuthProvider><Probe /><AccountGuards /></AuthProvider></MemoryRouter>);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  return host;
}

const JEROME = { id: 'u1', email: 'jerome@example.com', name: 'Jerome' };
const MINGHUI = { id: 'u2', email: 'minghui@example.com', name: 'Minghui' };

function stubApi(me: () => object) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/auth/exchange')) return new Response(JSON.stringify({ session_token: 'tok-new' }), { status: 200 });
    if (url.includes('/auth/me')) return new Response(JSON.stringify(me()), { status: 200 });
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
}

async function addUnsyncedReview(id = 'ev1') {
  await db.reviewEvents.put({ id, card_id: 'c1', rating: 2, time_spent_ms: 1000, user_answer: null, reviewed_at: new Date().toISOString(), _synced: 0, _created_at: new Date().toISOString() });
}

function returnFromGoogle() {
  sessionStorage.setItem('auth_verifier', 'v'.repeat(43));
  window.history.replaceState(null, '', '/?code=' + 'c'.repeat(40));
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  resetSignInForTests();
  window.history.replaceState(null, '', '/');
  await db.reviewEvents.clear();
  await db.decks.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  auth = null;
  vi.unstubAllGlobals();
});

describe('Sign out', () => {
  it('with an unsynced review: asks first, deletes nothing', async () => {
    localStorage.setItem('session_token', 'tok');
    localStorage.setItem('cached_user', JSON.stringify(JEROME));
    stubApi(() => JEROME);
    await addUnsyncedReview();
    const el = await render();
    await act(async () => { await auth!.logout(); });
    expect(el.querySelector('[data-testid="signout-unsynced"]')?.textContent).toContain("1 review hasn't uploaded yet");
    expect(localStorage.getItem('session_token')).toBe('tok');
    expect(await db.reviewEvents.count()).toBe(1);
  });
});

describe('signing in again', () => {
  it('the same account resumes: the unsynced review and the decks stay', async () => {
    localStorage.setItem('account-owner-v1', JSON.stringify({ id: 'u1', email: JEROME.email }));
    await addUnsyncedReview();
    await db.decks.put({ id: 'd1', name: 'HSK 1' } as never);
    stubApi(() => JEROME);
    returnFromGoogle();
    const el = await render();
    expect(el.querySelector('[data-testid="who"]')?.textContent).toBe(JEROME.email);
    expect(el.querySelector('[data-testid="account-switch"]')).toBeNull();
    expect(await db.reviewEvents.count()).toBe(1);
    expect(await db.decks.count()).toBe(1);
  });

  it('a different account with unsent work: asks, and nothing is cleared until Discard', async () => {
    localStorage.setItem('account-owner-v1', JSON.stringify({ id: 'u1', email: JEROME.email }));
    await addUnsyncedReview();
    stubApi(() => MINGHUI);
    returnFromGoogle();
    const el = await render();
    const prompt = el.querySelector('[data-testid="account-switch"]');
    expect(prompt?.textContent).toContain("1 review hasn't uploaded yet — sign back in as jerome@example.com to upload them first, or discard them.");
    expect(el.querySelector('[data-testid="who"]')?.textContent).toBe('none');
    expect(await db.reviewEvents.count()).toBe(1);
    // The new session is parked: nothing of Jerome's can upload into Minghui's account meanwhile.
    expect(localStorage.getItem('session_token')).toBeNull();
    await act(async () => { await auth!.resolveAccountSwitch('discard'); });
    expect(await db.reviewEvents.count()).toBe(0);
    expect(el.querySelector('[data-testid="who"]')?.textContent).toBe(MINGHUI.email);
    expect(JSON.parse(localStorage.getItem('account-owner-v1')!).id).toBe('u2');
    expect(localStorage.getItem('session_token')).toBe('tok-new');
  });

  it('a different account with everything uploaded: the previous account’s data is cleared at once', async () => {
    localStorage.setItem('account-owner-v1', JSON.stringify({ id: 'u1', email: JEROME.email }));
    await db.decks.put({ id: 'd1', name: 'HSK 1' } as never);
    stubApi(() => MINGHUI);
    returnFromGoogle();
    const el = await render();
    expect(el.querySelector('[data-testid="account-switch"]')).toBeNull();
    expect(el.querySelector('[data-testid="who"]')?.textContent).toBe(MINGHUI.email);
    expect(await db.decks.count()).toBe(0);
  });
});
