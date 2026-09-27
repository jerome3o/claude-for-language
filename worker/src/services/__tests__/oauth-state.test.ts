import { describe, it, expect } from 'vitest';
import { encodeOAuthState, parseOAuthState, parseNativeAuthClient, authRedirectUrl } from '../auth';

const NONCE = '3f1c2a9e-1111-4222-8333-944455556666';
const APP_NONCE = 'AbCdEfGhIjKlMnOp_-12';
const INVITE = 'x'.repeat(43);

describe('OAuth state', () => {
  it('keeps the plain and invite formats unchanged', () => {
    expect(encodeOAuthState(NONCE, null)).toBe(NONCE);
    expect(encodeOAuthState(NONCE, INVITE)).toBe(`${NONCE}.i.${INVITE}`);
    expect(parseOAuthState(`${NONCE}.i.${INVITE}`)).toEqual({ nonce: NONCE, inviteToken: INVITE, native: null });
    expect(parseOAuthState(NONCE)).toEqual({ nonce: NONCE, inviteToken: null, native: null });
    expect(parseOAuthState(undefined)).toEqual({ nonce: '', inviteToken: null, native: null });
  });

  it('round-trips a native client, with and without an invite', () => {
    const native = { client: 'lab', appNonce: APP_NONCE };
    const plain = encodeOAuthState(NONCE, null, native);
    expect(plain).toBe(`${NONCE}.c.lab.${APP_NONCE}`);
    expect(parseOAuthState(plain)).toEqual({ nonce: NONCE, inviteToken: null, native });
    const both = encodeOAuthState(NONCE, INVITE, native);
    expect(parseOAuthState(both)).toEqual({ nonce: NONCE, inviteToken: INVITE, native });
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
    expect(authRedirectUrl('https://app.example', null, { signup: 'email_mismatch', inviter: 'Wang Laoshi' }))
      .toBe('https://app.example?signup=email_mismatch&inviter=Wang+Laoshi');
  });
});
