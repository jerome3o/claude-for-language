import { describe, it, expect } from 'vitest';
import { encodeOAuthState, parseOAuthState, parseNativeAuthClient, authRedirectUrl } from '../auth';

const NONCE = '3f1c2a9e-1111-4222-8333-944455556666';
const APP_NONCE = 'AbCdEfGhIjKlMnOp_-12';
const INVITE = 'x'.repeat(43);

describe('OAuth state', () => {
  it('keeps the plain and invite formats unchanged', () => {
    expect(encodeOAuthState(NONCE, null)).toBe(NONCE);
    expect(encodeOAuthState(NONCE, INVITE)).toBe(`${NONCE}.i.${INVITE}`);
    expect(parseOAuthState(`${NONCE}.i.${INVITE}`)).toEqual({ nonce: NONCE, inviteToken: INVITE, native: null, challenge: null });
    expect(parseOAuthState(NONCE)).toEqual({ nonce: NONCE, inviteToken: null, native: null, challenge: null });
    expect(parseOAuthState(undefined)).toEqual({ nonce: '', inviteToken: null, native: null, challenge: null });
  });

  it('round-trips a native client, with and without an invite', () => {
    const native = { client: 'lab', appNonce: APP_NONCE };
    const plain = encodeOAuthState(NONCE, null, native);
    expect(plain).toBe(`${NONCE}.c.lab.${APP_NONCE}`);
    expect(parseOAuthState(plain)).toEqual({ nonce: NONCE, inviteToken: null, native, challenge: null });
    const both = encodeOAuthState(NONCE, INVITE, native);
    expect(parseOAuthState(both)).toEqual({ nonce: NONCE, inviteToken: INVITE, native, challenge: null });
  });

  it('carries a PKCE challenge, with or without a native client and invite', () => {
    const challenge = 'C'.repeat(43);
    const native = { client: 'lab', appNonce: APP_NONCE };
    expect(encodeOAuthState(NONCE, null, null, challenge)).toBe(`${NONCE}.x.${challenge}`);
    expect(parseOAuthState(`${NONCE}.x.${challenge}`)).toEqual({ nonce: NONCE, inviteToken: null, native: null, challenge });
    const all = encodeOAuthState(NONCE, INVITE, native, challenge);
    expect(all).toBe(`${NONCE}.c.lab.${APP_NONCE}.x.${challenge}.i.${INVITE}`);
    expect(parseOAuthState(all)).toEqual({ nonce: NONCE, inviteToken: INVITE, native, challenge });
    // A malformed challenge is dropped (the legacy token flow), never trusted.
    expect(parseOAuthState(`${NONCE}.x.short`).challenge).toBeNull();
    expect(parseOAuthState(NONCE).challenge).toBeNull();
    // The web and native code redirects.
    expect(authRedirectUrl('https://app.example', null, { code: 'abc' })).toBe('https://app.example?code=abc');
    expect(authRedirectUrl('https://app.example', native, { code: 'abc' })).toBe(`chineselearning-lab://auth?code=abc&nonce=${APP_NONCE}`);
  });

  it('only accepts known clients with a well-formed app nonce', () => {
    expect(parseNativeAuthClient('lab', APP_NONCE)).toEqual({ client: 'lab', appNonce: APP_NONCE });
    expect(parseNativeAuthClient('evil', APP_NONCE)).toBeNull();
    expect(parseNativeAuthClient('toString', APP_NONCE)).toBeNull();
    expect(parseNativeAuthClient('lab', 'short')).toBeNull();
    expect(parseNativeAuthClient('lab', 'has.dot.in.it.1234567')).toBeNull();
    expect(parseNativeAuthClient('lab', undefined)).toBeNull();
    expect(parseOAuthState(`${NONCE}.c.evil.${APP_NONCE}`).native).toBeNull();
  });

  it('sends the web app its token and the native app its scheme + nonce', () => {
    expect(authRedirectUrl('https://app.example', null, { session_token: 'abc' })).toBe('https://app.example?session_token=abc');
    expect(authRedirectUrl('https://app.example', { client: 'lab', appNonce: APP_NONCE }, { session_token: 'abc' }))
      .toBe(`chineselearning-lab://auth?session_token=abc&nonce=${APP_NONCE}`);
    // The desktop app (desktop/) gets its own scheme; its nonce check is shared/desktop/bridge.ts.
    expect(parseNativeAuthClient('desktop', APP_NONCE)).toEqual({ client: 'desktop', appNonce: APP_NONCE });
    expect(authRedirectUrl('https://app.example', { client: 'desktop', appNonce: APP_NONCE }, { session_token: 'abc' }))
      .toBe(`chineselearning-desktop://auth?session_token=abc&nonce=${APP_NONCE}`);
    expect(authRedirectUrl('https://app.example', null, { signup: 'email_mismatch', inviter: 'Wang Laoshi' }))
      .toBe('https://app.example?signup=email_mismatch&inviter=Wang+Laoshi');
  });
});
