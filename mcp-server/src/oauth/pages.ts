/**
 * The HTML pages of the MCP server's sign-in flow: the approval page shown
 * before anyone is sent to Google, and the plain message pages (invite-only,
 * expired link, sign-in failed). Pure functions so they are unit-tested.
 *
 * Everything that came from the OAuth client (its name, its redirect URI) is
 * attacker-chosen under dynamic client registration: it is always escaped.
 */
import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/**
 * Response headers every page of the flow carries (no framing, no caching, no scripts).
 * No `form-action`: browsers apply it to the redirect after the form posts
 * (to Google, or back to the client on Cancel), which it would block.
 */
export const PAGE_SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'",
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

const STYLE = `
:root { color-scheme: light dark; --bg: #f6f5f2; --card: #ffffff; --text: #1d1d1f; --muted: #5f6368; --line: #e3e1dc; --accent: #c0392b; --accent-text: #ffffff; --warn-bg: #fff4e5; --warn-text: #7a4b00; }
@media (prefers-color-scheme: dark) { :root { --bg: #151515; --card: #202020; --text: #f2f2f2; --muted: #a8a8a8; --line: #333333; --accent: #e0574a; --accent-text: #ffffff; --warn-bg: #3a2a10; --warn-text: #ffd08a; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 1rem/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Noto Sans SC", sans-serif; }
main { max-width: 30rem; margin: 0 auto; padding: 2rem 1rem; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 1rem; padding: 1.5rem 1.25rem; }
.brand { font-size: 0.875rem; color: var(--muted); margin: 0 0 0.75rem; }
h1 { font-size: 1.375rem; line-height: 1.3; margin: 0 0 1rem; overflow-wrap: anywhere; }
p { margin: 0 0 0.875rem; overflow-wrap: anywhere; }
.muted { color: var(--muted); font-size: 0.9375rem; }
.host { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; }
.warn { background: var(--warn-bg); color: var(--warn-text); border-radius: 0.75rem; padding: 0.75rem 0.875rem; font-size: 0.9375rem; }
ul { margin: 0 0 1rem; padding-left: 1.25rem; }
li { margin: 0.25rem 0; }
.actions { display: flex; gap: 0.75rem; margin-top: 1.25rem; flex-wrap: wrap; }
button { flex: 1 1 8rem; min-height: 48px; border-radius: 0.75rem; font: inherit; font-weight: 600; cursor: pointer; border: 1px solid var(--line); background: transparent; color: var(--text); }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
`;

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><main><div class="card">
<p class="brand">汉语学习 · Chinese Learning</p>
${body}
</div></main></body>
</html>`;
}

/**
 * "<client> wants to access your Chinese Learning account" — Approve / Cancel.
 * `handle` is the library's browser-bound consent handle (its cookie is set
 * by the headers `beginConsent()` returned); the form carries nothing else
 * that is trusted.
 */
export function renderConsentPage(details: ConsentDescription, handle: string, action = '/authorize'): string {
  const name = escapeHtml(details.clientName || 'An app');
  const host = escapeHtml(details.redirectHost);
  const origin = details.clientDomain
    ? `<p class="muted">Published by <span class="host">${escapeHtml(details.clientDomain)}</span>.</p>`
    : `<p class="muted">The app named itself — the name is not verified. Check where access goes below.</p>`;
  const loopback = details.redirectIsLoopback
    ? `<p class="warn"><strong>This sends access to an app on your own computer.</strong> Continue only if you just started connecting from it (for example Claude Code or Claude Desktop with mcp-remote).</p>`
    : '';
  return shell(`Allow ${details.clientName || 'this app'}?`, `
<h1>${name} wants to access your Chinese Learning account</h1>
${origin}
<p>Access will be sent to <span class="host">${host}</span>.</p>
${loopback}
<p class="muted">If you allow it, it can act as you: read and change your decks, cards, lessons and readers, and — if you teach — your students' homework and chats.</p>
<form method="post" action="${escapeHtml(action)}">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
<div class="actions">
<button type="submit" name="decision" value="deny">Cancel</button>
<button type="submit" name="decision" value="approve" class="primary">Approve</button>
</div>
</form>
<p class="muted" style="margin-top:1rem">Next you'll sign in with Google. If you didn't ask to connect anything, press Cancel.</p>`);
}

/** A plain page with a heading and a paragraph (both escaped). */
export function renderMessagePage(title: string, message: string): string {
  return shell(title, `<h1>${escapeHtml(title)}</h1>\n<p>${escapeHtml(message)}</p>`);
}

/** The Google account has no account in the app: sign-up is invite-only and happens there. */
export function renderInviteOnlyPage(email: string | null | undefined): string {
  const who = email ? `${email} doesn't have a Chinese Learning account yet.` : `This Google account doesn't have a Chinese Learning account yet.`;
  return shell('Sign up in the app first', `
<h1>Sign up in the app first</h1>
<p>${escapeHtml(who)}</p>
<p>Chinese Learning is invite-only: open the invite link your tutor sent you and sign in there. Once your account exists, connect again from Claude.</p>
<p class="muted">We've let the admin know you tried.</p>`);
}
