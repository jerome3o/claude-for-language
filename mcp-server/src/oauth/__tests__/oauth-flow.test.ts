/**
 * The MCP server's OAuth flow end to end, in Node, against the real
 * @cloudflare/workers-oauth-provider with an in-memory KV and a fake D1:
 * approval page before Google, browser-bound handles / state, remembered
 * approvals, S256-only PKCE, the /register redirect policy, invite-only
 * sign-in (no user is ever created), the verified-email rule, and deleted
 * accounts losing access.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOAuthApp } from '../handler.js';
import { canonicalResource, createOAuthProvider } from '../provider.js';
import { clearLiveUserCache } from '../users.js';
import type { Env } from '../../types.js';

// ---------- fakes ----------

class MemoryKV {
  store = new Map<string, { value: string; metadata?: unknown }>();
  async get(key: string, opts?: unknown) {
    const entry = this.store.get(key);
    if (!entry) return null;
    const type = typeof opts === 'string' ? opts : (opts as { type?: string } | undefined)?.type;
    return type === 'json' ? JSON.parse(entry.value) : entry.value;
  }
  async put(key: string, value: string, opts?: { metadata?: unknown }) {
    this.store.set(key, { value, metadata: opts?.metadata });
  }
  async delete(key: string) {
    this.store.delete(key);
  }
  async list(opts: { prefix?: string } = {}) {
    const keys = [...this.store.entries()]
      .filter(([k]) => !opts.prefix || k.startsWith(opts.prefix))
      .map(([name, e]) => ({ name, metadata: e.metadata }));
    return { keys, list_complete: true, cacheStatus: null };
  }
}

interface UserRow { id: string; email: string | null; name: string | null; google_id: string | null }

class FakeD1 {
  users: UserRow[] = [];
  accessRequests: Array<{ id: string; email: string; status: string; attempts: number }> = [];
  sql: string[] = [];
  prepare(sql: string) {
    const db = this;
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { args = a; return stmt; },
      async first<T>(): Promise<T | null> {
        db.sql.push(sql);
        if (/FROM users WHERE google_id = \?/.test(sql)) return (db.users.find((u) => u.google_id === args[0]) as T) ?? null;
        if (/FROM users WHERE email = \?/.test(sql)) return (db.users.find((u) => u.email === args[0]) as T) ?? null;
        if (/FROM users WHERE id = \?/.test(sql)) return (db.users.find((u) => u.id === args[0]) as T) ?? null;
        if (/FROM access_requests WHERE email = \?/.test(sql)) return (db.accessRequests.find((r) => r.email === args[0]) as T) ?? null;
        throw new Error(`unexpected first(): ${sql}`);
      },
      async run() {
        db.sql.push(sql);
        if (/^\s*INSERT INTO access_requests/.test(sql)) {
          db.accessRequests.push({ id: String(args[0]), email: String(args[1]), status: 'pending', attempts: 1 });
        } else if (/UPDATE access_requests/.test(sql)) {
          const row = db.accessRequests.find((r) => r.id === args[3]);
          if (row) { row.attempts += 1; row.status = String(args[2]); }
        } else if (/UPDATE users SET/.test(sql)) {
          const row = db.users.find((u) => u.id === args[args.length - 1]);
          if (row) row.google_id = String(args[0]);
        } else {
          throw new Error(`unexpected run(): ${sql}`);
        }
        return { success: true };
      },
    };
    return stmt;
  }
}

// ---------- helpers ----------

const ORIGIN = 'http://localhost:8788';
const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function s256(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** Node's Headers has getSetCookie(); the workers types don't declare it. */
function setCookies(headers: Headers): string[] {
  return (headers as unknown as { getSetCookie(): string[] }).getSetCookie();
}

/** Cookie jar: name=value from Set-Cookie headers (Max-Age=0 removes). */
class Jar {
  cookies = new Map<string, string>();
  take(res: Response) {
    for (const line of setCookies(res.headers)) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (/Max-Age=0\b/i.test(line) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

let kv: MemoryKV;
let db: FakeD1;
let env: Env;
let mcpCalls: number;
let googleUser: Record<string, unknown>;

const ctx = () => ({ waitUntil: () => {}, passThroughOnException: () => {}, props: undefined }) as unknown as ExecutionContext;

function provider() {
  return createOAuthProvider(
    canonicalResource(`${ORIGIN}/mcp`),
    { fetch: async () => { mcpCalls += 1; return new Response('mcp ok'); } },
    createOAuthApp() as unknown as { fetch: (r: Request, e: Env, c: ExecutionContext) => Promise<Response> },
  );
}

async function call(path: string, init: RequestInit & { jar?: Jar } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.jar && init.jar.cookies.size) headers.set('Cookie', init.jar.header());
  const res = await provider().fetch(new Request(new URL(path, ORIGIN), { ...init, headers, redirect: 'manual' }), env, ctx());
  init.jar?.take(res);
  return res;
}

async function register(redirectUris: string[], name = 'Claude') {
  return call('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: name, redirect_uris: redirectUris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  });
}

async function authorizeUrl(clientId: string, verifier: string, method = 'S256', redirectUri = CLAUDE_CALLBACK) {
  const challenge = method === 'S256' ? await s256(verifier) : verifier;
  const q = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state: 'client-state-1',
    code_challenge: challenge, code_challenge_method: method, scope: '', resource: `${ORIGIN}/mcp`,
  });
  return `/authorize?${q}`;
}

function handleFrom(html: string): string {
  const m = /name="handle" value="([^"]+)"/.exec(html);
  if (!m) throw new Error('no handle in page');
  return m[1];
}

function form(fields: Record<string, string>): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() };
}

/** Register Claude, open /authorize, approve → returns the Google redirect + state. */
async function approveFlow(jar: Jar) {
  const reg = await register([CLAUDE_CALLBACK]);
  const client = (await reg.json()) as { client_id: string };
  const verifier = 'v'.repeat(50);
  const page = await call(await authorizeUrl(client.client_id, verifier), { jar });
  const approve = await call('/authorize', { ...form({ handle: handleFrom(await page.text()), decision: 'approve' }), jar });
  const google = new URL(approve.headers.get('Location')!);
  return { client, verifier, approve, google, state: google.searchParams.get('state')! };
}

beforeEach(() => {
  kv = new MemoryKV();
  db = new FakeD1();
  db.users.push({ id: 'user-1', email: 'jerome@example.com', name: 'Jerome', google_id: 'g-jerome' });
  mcpCalls = 0;
  env = {
    DB: db as unknown as D1Database,
    OAUTH_KV: kv as unknown as KVNamespace,
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    COOKIE_ENCRYPTION_KEY: 'k'.repeat(64),
    ENVIRONMENT: 'test',
  };
  googleUser = { id: 'g-jerome', email: 'jerome@example.com', verified_email: true, name: 'Jerome', picture: null };
  clearLiveUserCache();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'google-at' });
    if (url.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) return Response.json(googleUser);
    throw new Error(`unexpected fetch ${url}`);
  }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------- tests ----------

describe('metadata and registration', () => {
  it('advertises S256 only and the /mcp resource', async () => {
    const meta = (await (await call('/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>;
    expect(meta.code_challenge_methods_supported).toEqual(['S256']);
    const prm = (await (await call('/.well-known/oauth-protected-resource/mcp')).json()) as Record<string, unknown>;
    expect(prm.resource).toBe(`${ORIGIN}/mcp`);
  });

  it('accepts Claude and loopback redirect URIs, refuses anything else', async () => {
    expect((await register([CLAUDE_CALLBACK])).status).toBe(201);
    expect((await register(['https://claude.com/api/mcp/auth_callback'])).status).toBe(201);
    expect((await register(['http://localhost:3334/oauth/callback'])).status).toBe(201);
    expect((await register(['http://127.0.0.1:51234/callback'])).status).toBe(201);
    const evil = await register(['https://evil.example/callback']);
    expect(evil.status).toBe(400);
    expect(((await evil.json()) as { error: string }).error).toBe('invalid_redirect_uri');
    expect((await register([CLAUDE_CALLBACK, 'https://evil.example/cb'])).status).toBe(400);
    expect((await register(['https://claude.ai.evil.example/cb'])).status).toBe(400);
  });
});

describe('approval page', () => {
  it('shows the client and where access goes before anything else, with a browser-bound handle', async () => {
    const client = (await (await register([CLAUDE_CALLBACK], '<script>alert(1)</script>Claude')).json()) as { client_id: string };
    const jar = new Jar();
    const res = await call(await authorizeUrl(client.client_id, 'v'.repeat(50)), { jar });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('wants to access your Chinese Learning account');
    expect(html).toContain('claude.ai');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&#60;script&#62;');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    const cookie = setCookies(res.headers).find((c: string) => c.startsWith('__Host-oauth-consent'));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses plain PKCE', async () => {
    const client = (await (await register([CLAUDE_CALLBACK])).json()) as { client_id: string };
    const res = await call(await authorizeUrl(client.client_id, 'v'.repeat(50), 'plain'));
    expect(res.status).toBe(302);
    const back = new URL(res.headers.get('Location')!);
    expect(`${back.origin}${back.pathname}`).toBe(CLAUDE_CALLBACK);
    expect(back.searchParams.get('error')).toBe('invalid_request');
  });

  it('refuses an approval posted without the consent cookie (CSRF)', async () => {
    const client = (await (await register([CLAUDE_CALLBACK])).json()) as { client_id: string };
    const page = await call(await authorizeUrl(client.client_id, 'v'.repeat(50)), { jar: new Jar() });
    const res = await call('/authorize', form({ handle: handleFrom(await page.text()), decision: 'approve' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
  });

  it('Cancel goes back to the client with access_denied', async () => {
    const client = (await (await register([CLAUDE_CALLBACK])).json()) as { client_id: string };
    const jar = new Jar();
    const page = await call(await authorizeUrl(client.client_id, 'v'.repeat(50)), { jar });
    const res = await call('/authorize', { ...form({ handle: handleFrom(await page.text()), decision: 'deny' }), jar });
    expect(res.status).toBe(302);
    const back = new URL(res.headers.get('Location')!);
    expect(`${back.origin}${back.pathname}`).toBe(CLAUDE_CALLBACK);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('state')).toBe('client-state-1');
  });

  it('Approve goes to Google with a state, and the approval is remembered (one click next time)', async () => {
    const jar = new Jar();
    const { approve, google, state, client } = await approveFlow(jar);
    expect(approve.status).toBe(302);
    expect(google.origin).toBe('https://accounts.google.com');
    expect(state).toBeTruthy();
    expect(jar.cookies.has('__Host-oauth-approvals')).toBe(true);

    const again = await call(await authorizeUrl(client.client_id, 'w'.repeat(50)), { jar });
    expect(again.status).toBe(302);
    expect(new URL(again.headers.get('Location')!).origin).toBe('https://accounts.google.com');

    // Another client is asked again even in the same browser.
    const other = (await (await register([CLAUDE_CALLBACK], 'Other')).json()) as { client_id: string };
    expect((await call(await authorizeUrl(other.client_id, 'x'.repeat(50)), { jar })).status).toBe(200);
  });

  it('a forged approvals cookie is ignored', async () => {
    const client = (await (await register([CLAUDE_CALLBACK])).json()) as { client_id: string };
    const jar = new Jar();
    jar.cookies.set('__Host-oauth-approvals', 'W10.forged');
    expect((await call(await authorizeUrl(client.client_id, 'v'.repeat(50)), { jar })).status).toBe(200);
  });
});

describe('callback', () => {
  it('refuses a state without the browser cookie (login CSRF / replay)', async () => {
    const { state } = await approveFlow(new Jar());
    const res = await call(`/callback?state=${encodeURIComponent(state)}&code=abc`);
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('an existing user gets a code for the client, exchangeable with the S256 verifier', async () => {
    const jar = new Jar();
    const { state, verifier, client } = await approveFlow(jar);
    const res = await call(`/callback?state=${encodeURIComponent(state)}&code=google-code`, { jar });
    expect(res.status).toBe(302);
    const back = new URL(res.headers.get('Location')!);
    expect(`${back.origin}${back.pathname}`).toBe(CLAUDE_CALLBACK);
    expect(back.searchParams.get('state')).toBe('client-state-1');
    const code = back.searchParams.get('code')!;

    const token = await call('/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: CLAUDE_CALLBACK, code_verifier: verifier, resource: `${ORIGIN}/mcp` }).toString(),
    });
    expect(token.status).toBe(200);
    const tokens = (await token.json()) as { access_token: string; refresh_token: string };

    const mcp = await call('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}` }, body: '{}' });
    expect(mcp.status).toBe(200);
    expect(mcpCalls).toBe(1);

    // The admin deletes the account: the token stops working and refresh is refused.
    db.users = [];
    clearLiveUserCache();
    const gone = await call('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}` }, body: '{}' });
    expect(gone.status).toBe(401);
    expect(mcpCalls).toBe(1);
    const refresh = await call('/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id, resource: `${ORIGIN}/mcp` }).toString(),
    });
    expect(refresh.status).toBe(400);
    expect(((await refresh.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('a Google account with no app account is refused, recorded as an access request, never inserted', async () => {
    googleUser = { id: 'g-stranger', email: 'Stranger@Example.com', verified_email: true, name: 'Stranger' };
    const jar = new Jar();
    const { state } = await approveFlow(jar);
    const res = await call(`/callback?state=${encodeURIComponent(state)}&code=google-code`, { jar });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Sign up in the app first');
    expect(db.accessRequests).toEqual([expect.objectContaining({ email: 'stranger@example.com', status: 'pending' })]);
    expect(db.sql.some((s) => /INSERT INTO users/i.test(s))).toBe(false);
    expect(db.users).toHaveLength(1);
  });

  it('matches an existing account by email only when Google says the email is verified', async () => {
    googleUser = { id: 'g-new-id', email: 'jerome@example.com', verified_email: false, name: 'Jerome' };
    let jar = new Jar();
    let flow = await approveFlow(jar);
    expect((await call(`/callback?state=${encodeURIComponent(flow.state)}&code=c`, { jar })).status).toBe(403);
    expect(db.users[0].google_id).toBe('g-jerome');

    googleUser = { ...googleUser, verified_email: true };
    jar = new Jar();
    flow = await approveFlow(jar);
    expect((await call(`/callback?state=${encodeURIComponent(flow.state)}&code=c`, { jar })).status).toBe(302);
    expect(db.users[0].google_id).toBe('g-new-id');
  });

  it("doesn't echo Google's error body", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('secret upstream detail', { status: 400 })));
    const jar = new Jar();
    const { state } = await approveFlow(jar);
    const res = await call(`/callback?state=${encodeURIComponent(state)}&code=c`, { jar });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('secret upstream detail');
  });

  it('Google sign-in declined → back to the client with access_denied', async () => {
    const jar = new Jar();
    const { state } = await approveFlow(jar);
    const res = await call(`/callback?state=${encodeURIComponent(state)}&error=access_denied`, { jar });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('Location')!).searchParams.get('error')).toBe('access_denied');
  });
});

describe('canonicalResource', () => {
  it('is <origin>/mcp, https except on loopback', () => {
    expect(canonicalResource('https://chinese-learning-mcp.jeromeswannack.workers.dev/authorize?x=1')).toBe('https://chinese-learning-mcp.jeromeswannack.workers.dev/mcp');
    expect(canonicalResource('http://localhost:8788/mcp')).toBe('http://localhost:8788/mcp');
    expect(canonicalResource('http://Example.workers.dev/mcp')).toBe('https://example.workers.dev/mcp');
  });
});
