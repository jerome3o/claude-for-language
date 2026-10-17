/**
 * The MCP server's OAuth pages: approval → Google sign-in → back to the client.
 *
 *   GET  /authorize  validate the client's request; show "<client> wants to access
 *                    your Chinese Learning account" (Approve / Cancel) unless this
 *                    browser already approved this exact client + redirect URI
 *   POST /authorize  Approve → Google (state bound to this browser); Cancel →
 *                    back to the client with access_denied
 *   GET  /callback   Google's answer: only an EXISTING app account is let through
 *                    (sign-up is invite-only and happens in the app); the grant is
 *                    issued to the client the user approved
 *
 * The CSRF / browser binding is the oauth provider's consent + upstream helpers
 * (`beginConsent` / `approveConsent` / `beginUpstream` / `finishUpstream`): each
 * step's handle works once, for ten minutes, only in the browser holding its
 * `__Host-` HttpOnly Secure SameSite=Lax cookie, and the authorization request
 * itself is kept server-side (never trusted from the form). Remembered approvals
 * live in the provider's HMAC-signed `__Host-oauth-approvals` cookie, keyed with
 * a secret derived from COOKIE_ENCRYPTION_KEY, so claude.ai reconnects stay
 * one click.
 */
import { Hono } from 'hono';
import {
  AuthorizationError,
  authorizationErrorRedirect,
  type AuthRequest,
  type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import type { Env, Props } from '../types.js';
import {
  PAGE_SECURITY_HEADERS,
  renderConsentPage,
  renderInviteOnlyPage,
  renderMessagePage,
} from './pages.js';
import { findMcpUser, recordAccessRequest, touchMcpUser, type GoogleUserInfo } from './users.js';

type Bindings = Env & { OAUTH_PROVIDER: OAuthHelpers };

/** How long an approval is remembered in this browser. */
export const REMEMBER_CONSENT_SECONDS = 90 * 24 * 60 * 60;

/**
 * The HMAC key for the remembered-approvals cookie: derived from
 * COOKIE_ENCRYPTION_KEY (domain-separated, always 64 hex characters, so the
 * provider's 32-character minimum holds whatever the secret's length).
 */
export async function consentSecret(env: Pick<Env, 'COOKIE_ENCRYPTION_KEY'>): Promise<string> {
  const key = env.COOKIE_ENCRYPTION_KEY;
  if (!key || key.length < 16) throw new Error('COOKIE_ENCRYPTION_KEY is not configured');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mcp-consent-approvals-v1:${key}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function page(html: string, status: number, extra?: Headers): Response {
  const headers = new Headers(extra);
  for (const [k, v] of Object.entries(PAGE_SECURITY_HEADERS)) headers.set(k, v);
  return new Response(html, { status, headers });
}

function redirect(location: string, headers: Headers): Response {
  headers.set('Location', location);
  headers.set('Cache-Control', 'no-store');
  return new Response(null, { status: 302, headers });
}

const START_AGAIN = 'This sign-in link expired, was already used, or was opened in a different browser. Go back to Claude and connect again.';

/** An AuthorizationError from the provider: redirect only when it says that's safe, else render. */
function authorizationFailure(error: unknown): Response {
  if (error instanceof AuthorizationError) {
    if (error.redirectTo) return redirect(error.redirectTo, new Headers());
    return page(renderMessagePage("Can't connect", error.description || START_AGAIN), 400);
  }
  throw error;
}

function googleCallbackUrl(requestUrl: string): string {
  return new URL('/callback', requestUrl).href;
}

/** After consent (fresh or remembered): bind a state to this browser and go to Google. */
async function startGoogleSignIn(oauth: OAuthHelpers, env: Env, requestUrl: string, authRequest: AuthRequest, headers: Headers): Promise<Response> {
  const { state, headers: out } = await oauth.beginUpstream(authRequest, { headers });
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: googleCallbackUrl(requestUrl),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, out);
}

async function fetchGoogleUser(env: Env, code: string, requestUrl: string): Promise<GoogleUserInfo | null> {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: googleCallbackUrl(requestUrl),
    }),
  });
  if (!tokenResponse.ok) {
    // Status only: Google's body is never echoed to the browser or logged.
    console.error('[mcp oauth] Google token exchange failed:', tokenResponse.status);
    return null;
  }
  const tokens = (await tokenResponse.json()) as { access_token?: string };
  if (!tokens.access_token) return null;
  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userInfoResponse.ok) {
    console.error('[mcp oauth] Google userinfo failed:', userInfoResponse.status);
    return null;
  }
  const info = (await userInfoResponse.json()) as GoogleUserInfo;
  return info && typeof info.id === 'string' && info.id ? info : null;
}

export function createOAuthApp() {
  const app = new Hono<{ Bindings: Bindings }>();

  app.get('/', (c) => c.json({
    status: 'ok',
    name: 'Chinese Learning MCP Server',
    version: '1.0.0',
    transport: 'Streamable HTTP with OAuth 2.1',
    endpoint: '/mcp',
  }));

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/authorize', async (c) => {
    const oauth = c.env.OAUTH_PROVIDER;
    let authRequest: AuthRequest;
    try {
      authRequest = await oauth.parseAuthRequest(c.req.raw);
    } catch (error) {
      return authorizationFailure(error);
    }
    const secret = await consentSecret(c.env);
    if (await oauth.isConsentRemembered(c.req.raw, authRequest, { secret })) {
      return startGoogleSignIn(oauth, c.env, c.req.url, authRequest, new Headers());
    }
    const details = await oauth.describeConsent(authRequest);
    const consent = await oauth.beginConsent(authRequest);
    return page(renderConsentPage(details, consent.handle), 200, consent.headers);
  });

  app.post('/authorize', async (c) => {
    const oauth = c.env.OAUTH_PROVIDER;
    const form = await c.req.parseBody();
    const handle = typeof form.handle === 'string' ? form.handle : '';
    try {
      if (form.decision !== 'approve') {
        const denied = await oauth.denyConsent(c.req.raw, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(c.req.raw, handle, {
        remember: { secret: await consentSecret(c.env), maxAgeSeconds: REMEMBER_CONSENT_SECONDS },
      });
      return await startGoogleSignIn(oauth, c.env, c.req.url, approved.request, approved.headers);
    } catch (error) {
      return authorizationFailure(error);
    }
  });

  app.get('/callback', async (c) => {
    const oauth = c.env.OAUTH_PROVIDER;
    let resumed: { request: AuthRequest; headers: Headers };
    try {
      // Refused unless this browser holds the state's binding cookie (set at Approve).
      resumed = await oauth.finishUpstream(c.req.raw);
    } catch (error) {
      if (error instanceof AuthorizationError) return page(renderMessagePage("Can't connect", START_AGAIN), 400);
      throw error;
    }
    const { request: original, headers } = resumed;

    const code = c.req.query('code');
    if (c.req.query('error') || !code) {
      return redirect(authorizationErrorRedirect(original, 'access_denied'), headers);
    }

    const google = await fetchGoogleUser(c.env, code, c.req.url);
    if (!google) {
      return page(renderMessagePage('Google sign-in failed', 'Something went wrong signing in with Google. Go back to Claude and try connecting again.'), 502, headers);
    }

    const user = await findMcpUser(c.env.DB, google);
    if (!user) {
      // Never create an account here: sign-up is invite-only, in the app.
      if (google.email) {
        await recordAccessRequest(c.env.DB, { email: google.email, name: google.name, picture_url: google.picture })
          .catch((err) => console.error('[mcp oauth] Failed to record access request:', err instanceof Error ? err.message : 'unknown'));
      }
      return page(renderInviteOnlyPage(google.email), 403, headers);
    }
    await touchMcpUser(c.env.DB, user, google);

    const { redirectTo } = await oauth.completeAuthorization({
      request: original,
      userId: user.id,
      metadata: { label: user.name || user.email || 'User' },
      scope: original.scope,
      props: { userId: user.id, userEmail: user.email, userName: user.name } satisfies Props,
    });
    return redirect(redirectTo, headers);
  });

  return app;
}
