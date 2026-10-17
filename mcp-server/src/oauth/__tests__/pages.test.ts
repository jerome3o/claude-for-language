import { describe, expect, it } from 'vitest';
import { escapeHtml, renderConsentPage, renderInviteOnlyPage } from '../pages.js';
import { checkClientRegistration, isAllowedRedirectUri } from '../redirect-policy.js';
import { consentSecret } from '../handler.js';

const details = {
  clientId: 'c1',
  clientName: 'Claude',
  redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  redirectHost: 'claude.ai',
  redirectIsLoopback: false,
  scope: [],
};

describe('renderConsentPage', () => {
  it('names the client and the redirect host, with Approve / Cancel and the handle', () => {
    const html = renderConsentPage(details, 'h"andle');
    expect(html).toContain('Claude wants to access your Chinese Learning account');
    expect(html).toContain('<span class="host">claude.ai</span>');
    expect(html).toContain('value="approve"');
    expect(html).toContain('value="deny"');
    expect(html).toContain('value="h&#34;andle"');
    expect(html).toContain('name is not verified');
    expect(html).not.toContain('your own computer');
  });

  it('warns for a loopback redirect and escapes attacker-chosen names', () => {
    const html = renderConsentPage({ ...details, clientName: '"><img src=x onerror=alert(1)>', redirectHost: 'localhost', redirectIsLoopback: true }, 'h');
    expect(html).toContain('your own computer');
    expect(html).not.toContain('<img');
  });

  it('invite-only page escapes the email', () => {
    expect(renderInviteOnlyPage('<b>@x.com')).toContain('&#60;b&#62;@x.com');
    expect(escapeHtml(`&<>"'\``)).toBe('&#38;&#60;&#62;&#34;&#39;&#96;');
  });
});

describe('redirect policy', () => {
  it.each([
    ['https://claude.ai/api/mcp/auth_callback', true],
    ['https://claude.com/api/mcp/auth_callback', true],
    ['https://staging.claude.ai/cb', true],
    ['http://localhost:3334/oauth/callback', true],
    ['http://127.0.0.1:9000/callback', true],
    ['http://[::1]:9000/callback', true],
    ['http://claude.ai/api/mcp/auth_callback', false],
    ['https://evilclaude.ai/cb', false],
    ['https://claude.ai.evil.com/cb', false],
    ['https://user@claude.ai/cb', false],
    ['https://claude.ai/cb#frag', false],
    ['javascript:alert(1)', false],
    ['cursor://anysphere/cb', false],
    ['not a url', false],
  ])('%s → %s', (uri, ok) => {
    expect(isAllowedRedirectUri(uri)).toBe(ok);
  });

  it('a registration needs at least one URI, all allowed', () => {
    expect(checkClientRegistration({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] })).toBeUndefined();
    expect(checkClientRegistration({})).toMatchObject({ code: 'invalid_redirect_uri' });
    expect(checkClientRegistration({ redirect_uris: [] })).toMatchObject({ code: 'invalid_redirect_uri' });
  });
});

describe('consentSecret', () => {
  it('is 64 hex characters derived from COOKIE_ENCRYPTION_KEY, and refuses a missing key', async () => {
    const a = await consentSecret({ COOKIE_ENCRYPTION_KEY: 'x'.repeat(64) });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(await consentSecret({ COOKIE_ENCRYPTION_KEY: 'y'.repeat(64) }));
    await expect(consentSecret({ COOKIE_ENCRYPTION_KEY: '' })).rejects.toThrow();
  });
});
