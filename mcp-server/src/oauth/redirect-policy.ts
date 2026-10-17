/**
 * Which redirect URIs a dynamically registered MCP client may use.
 *
 * The only clients that connect to this server are Claude's: claude.ai / Claude
 * Desktop / mobile (hosted callback `https://claude.ai/api/mcp/auth_callback`,
 * possibly moving to `https://claude.com/api/mcp/auth_callback`) and local
 * clients on a loopback port (Claude Code, `mcp-remote` for Claude Desktop:
 * `http://localhost:<port>/…` or `http://127.0.0.1:<port>/…`). Anything else —
 * an attacker's own server — is refused at /register, so a phished approval
 * can never send a code somewhere the attacker reads it.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isClaudeHost(hostname: string): boolean {
  return hostname === 'claude.ai' || hostname.endsWith('.claude.ai') || hostname === 'claude.com' || hostname.endsWith('.claude.com');
}

export function isAllowedRedirectUri(uri: unknown): boolean {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  const host = url.hostname.toLowerCase();
  if (url.protocol === 'https:') return isClaudeHost(host) || LOOPBACK_HOSTS.has(host);
  if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(host);
  return false;
}

export const REDIRECT_POLICY_MESSAGE =
  'This server only accepts Claude (claude.ai / claude.com) and apps on this computer (localhost / 127.0.0.1) as redirect URIs.';

/** The `clientRegistrationCallback`: undefined = allow; an object = refuse (RFC 7591 error). */
export function checkClientRegistration(clientMetadata: Record<string, unknown>): { code: string; description: string } | undefined {
  const uris = clientMetadata.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every(isAllowedRedirectUri)) {
    return { code: 'invalid_redirect_uri', description: REDIRECT_POLICY_MESSAGE };
  }
  return undefined;
}
