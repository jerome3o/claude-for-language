/**
 * The OAuth 2.1 provider wrapped around the MCP endpoint.
 *
 * - The canonical resource is `<origin>/mcp` (what Claude connects to), so it
 *   follows `wrangler dev`'s localhost origin and production's workers.dev one;
 *   grants made before the 1.x upgrade carry no resource and bind to it.
 * - S256 PKCE only and https / loopback redirect URIs (the library's 1.2 rules),
 *   plus /register accepts only Claude's and loopback redirect URIs
 *   (redirect-policy.ts).
 * - A grant whose user no longer exists in D1 (an admin deleted the account) is
 *   refused on every MCP request and revoked; a refresh for it fails with
 *   invalid_grant, which revokes it too.
 */
import OAuthProvider, { OAuthError, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { Env, Props } from '../types.js';
import { checkClientRegistration } from './redirect-policy.js';
import { userExists } from './users.js';

type FetchHandler = { fetch: (request: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response> };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** `<origin>/mcp`, lowercase; https unless the host is a loopback one. */
export function canonicalResource(requestUrl: string): string {
  const url = new URL(requestUrl);
  const host = url.host.toLowerCase();
  const protocol = LOOPBACK.has(url.hostname.toLowerCase()) ? url.protocol : 'https:';
  return `${protocol}//${host}/mcp`;
}

async function revokeAllGrants(helpers: OAuthHelpers | undefined, userId: string): Promise<void> {
  if (!helpers) return;
  try {
    let cursor: string | undefined;
    do {
      const page = await helpers.listUserGrants(userId, { cursor });
      for (const grant of page.items) await helpers.revokeGrant(grant.id, userId);
      cursor = page.cursor;
    } while (cursor);
  } catch (err) {
    console.error('[mcp oauth] Failed to revoke grants of a deleted account:', err instanceof Error ? err.message : 'unknown');
  }
}

/** The account behind the token must still exist; otherwise 401 and its grants are revoked. */
export function requireLiveUser(handler: FetchHandler): FetchHandler {
  return {
    async fetch(request, env, ctx) {
      const props = (ctx as ExecutionContext & { props?: Partial<Props> }).props;
      const userId = props?.userId;
      if (await userExists(env.DB, userId)) return handler.fetch(request, env, ctx);
      if (userId) ctx.waitUntil(revokeAllGrants((env as Env & { OAUTH_PROVIDER?: OAuthHelpers }).OAUTH_PROVIDER, userId));
      return new Response(JSON.stringify({ error: 'invalid_token', error_description: 'This account no longer exists' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'WWW-Authenticate': 'Bearer error="invalid_token", error_description="This account no longer exists"',
        },
      });
    },
  };
}

export function createOAuthProvider(resource: string, apiHandler: FetchHandler, defaultHandler: FetchHandler): OAuthProvider<Env> {
  return new OAuthProvider<Env>({
    apiHandlers: { '/mcp': requireLiveUser(apiHandler) },
    defaultHandler,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/token',
    clientRegistrationEndpoint: '/register',
    resourceMetadata: { resource },
    clientRegistrationCallback: ({ clientMetadata }) => checkClientRegistration(clientMetadata),
    tokenExchangeCallback: async ({ userId, env }) => {
      if (!(await userExists(env.DB, userId))) {
        throw new OAuthError('invalid_grant', { description: 'This account no longer exists' });
      }
    },
    onError: ({ status, code, internal }) => {
      // The stable reason only — never the token, the request body or upstream text.
      if (status !== 401) console.warn('[mcp oauth]', status, code, internal?.category, internal?.reason);
    },
  });
}

/** One provider per origin (production has one; `wrangler dev` another). */
export function providerCache(apiHandler: FetchHandler, defaultHandler: FetchHandler) {
  const providers = new Map<string, OAuthProvider<Env>>();
  return (requestUrl: string): OAuthProvider<Env> => {
    const resource = canonicalResource(requestUrl);
    let provider = providers.get(resource);
    if (!provider) {
      if (providers.size > 16) providers.clear();
      provider = createOAuthProvider(resource, apiHandler, defaultHandler);
      providers.set(resource, provider);
    }
    return provider;
  };
}
