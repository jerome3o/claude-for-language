import { describe, it, expect } from 'vitest';
import { challengeFor, exchangeErrorMessage, loginUrlWithChallenge, makeVerifier, readSignInReturn, stripSignInParams } from './signin';

describe('sign-in hand-off', () => {
  it('makes 43-character base64url verifiers, all different', () => {
    const a = makeVerifier();
    const b = makeVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('computes the RFC 7636 S256 challenge', async () => {
    // RFC 7636 appendix B test vector.
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('adds the challenge to the login link, keeping an invite', () => {
    const url = loginUrlWithChallenge('https://api.example/api/auth/login?invite=abc', 'C'.repeat(43));
    const u = new URL(url);
    expect(u.searchParams.get('invite')).toBe('abc');
    expect(u.searchParams.get('challenge')).toBe('C'.repeat(43));
    expect(loginUrlWithChallenge('/api/auth/login', 'x', 'http://localhost:3000')).toBe('http://localhost:3000/api/auth/login?challenge=x');
  });

  it('reads a code (preferred) or a legacy token from the redirect, and strips both', () => {
    expect(readSignInReturn('?code=abc')).toEqual({ kind: 'code', code: 'abc' });
    expect(readSignInReturn('?session_token=t')).toEqual({ kind: 'token', token: 't' });
    expect(readSignInReturn('?code=abc&session_token=t')).toEqual({ kind: 'code', code: 'abc' });
    expect(readSignInReturn('?signup=invite_only')).toBeNull();
    expect(stripSignInParams('?code=abc&tab=2')).toBe('?tab=2');
    expect(stripSignInParams('?session_token=t')).toBe('');
  });

  it('words every refusal', () => {
    for (const r of ['expired', 'nonce_mismatch', 'no_verifier', 'invalid_code', 'network', undefined]) {
      expect(exchangeErrorMessage(r)).toMatch(/\.$/);
    }
  });
});
