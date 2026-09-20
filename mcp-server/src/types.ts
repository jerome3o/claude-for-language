/**
 * Shared types for the MCP server. `Env` is the Worker's bindings; `Props`
 * is what the OAuth layer hands the McpAgent after Google sign-in.
 */

export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  ENVIRONMENT: string;
  OAUTH_KV: KVNamespace;
}

/** Props passed to the MCP server after authentication */
export type Props = {
  userId: string;
  userEmail: string | null;
  userName: string | null;
};

/** Base URL of the main API worker (same D1, all the business logic). */
export function apiBaseUrl(env: Env): string {
  return env.ENVIRONMENT === 'production'
    ? 'https://chinese-learning-api.jeromeswannack.workers.dev'
    : 'http://localhost:8787';
}
