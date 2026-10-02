import { describe, it, expect, beforeEach } from 'vitest';
import {
  fcmConfigured,
  getFcmAccessToken,
  isGoneTokenError,
  parseServiceAccount,
  resetFcmTokenCache,
  sendFcm,
  signServiceAccountJwt,
  toFcmData,
} from '../push/fcm';
import { fakeGoogle, INVALID_TOKEN, makeServiceAccount, SERVER_ERROR, UNREGISTERED } from './fcm-fixture';

function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

describe('FCM HTTP v1', () => {
  let sa: Awaited<ReturnType<typeof makeServiceAccount>>;

  beforeEach(async () => {
    resetFcmTokenCache();
    sa ??= await makeServiceAccount();
  });

  it('reads the service account from the secret, and says when it is missing', () => {
    expect(fcmConfigured({})).toBe(false);
    expect(fcmConfigured({ FCM_SERVICE_ACCOUNT_JSON: '' })).toBe(false);
    expect(fcmConfigured({ FCM_SERVICE_ACCOUNT_JSON: '{not json' })).toBe(false);
    expect(fcmConfigured({ FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'p' }) })).toBe(false);
    expect(fcmConfigured({ FCM_SERVICE_ACCOUNT_JSON: sa.json })).toBe(true);
    // A key pasted with literal "\n" still works.
    const raw = JSON.parse(sa.json) as { private_key: string };
    const escaped = JSON.stringify({ ...raw, private_key: raw.private_key.replace(/\n/g, '\\n') });
    expect(parseServiceAccount(escaped)?.private_key).toBe(raw.private_key);
  });

  it('signs an RS256 assertion Google can verify', async () => {
    const account = parseServiceAccount(sa.json)!;
    const jwt = await signServiceAccountJwt(account, 1_000_000);
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(p)))).toEqual({
      iss: account.client_email,
      sub: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_000_000,
      exp: 1_003_600,
    });
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', sa.publicKey, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
    expect(ok).toBe(true);
  });

  it('caches the access token until five minutes before it expires', async () => {
    const google = fakeGoogle();
    const account = parseServiceAccount(sa.json)!;
    const t0 = Date.now();
    expect(await getFcmAccessToken(account, google.fetcher, t0)).toBe('access-1');
    expect(await getFcmAccessToken(account, google.fetcher, t0 + 30 * 60_000)).toBe('access-1');
    expect(google.tokenExchanges()).toBe(1);
    const exchange = google.calls[0];
    expect(exchange.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(exchange.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(form.get('assertion')?.split('.')).toHaveLength(3);
    // 56 minutes in: inside the 5-minute margin → a fresh token.
    expect(await getFcmAccessToken(account, google.fetcher, t0 + 56 * 60_000)).toBe('access-2');
    expect(google.tokenExchanges()).toBe(2);
  });

  it('sends a data-only, high-priority message with string values', async () => {
    const google = fakeGoogle();
    const env = { FCM_SERVICE_ACCOUNT_JSON: sa.json };
    const r = await sendFcm(env, 'device-token-1', { type: 'chat_message', n: 3, none: null }, { collapseKey: 'conv-1' }, google.fetcher);
    expect(r).toEqual({ ok: true, status: 200, gone: false });
    const [send] = google.sends();
    expect(send.url).toBe('https://fcm.googleapis.com/v1/projects/demo-project/messages:send');
    expect(send.headers.authorization).toBe('Bearer access-1');
    expect(send.json).toEqual({
      message: {
        token: 'device-token-1',
        data: { type: 'chat_message', n: '3' },
        android: { priority: 'HIGH', ttl: '86400s', collapse_key: 'conv-1' },
      },
    });
    // The second send reuses the cached access token.
    await sendFcm(env, 'device-token-2', { type: 'x' }, {}, google.fetcher);
    expect(google.tokenExchanges()).toBe(1);
  });

  it('classifies dead tokens apart from other failures', async () => {
    const google = fakeGoogle({ dead: UNREGISTERED, bad: INVALID_TOKEN, flaky: SERVER_ERROR });
    const env = { FCM_SERVICE_ACCOUNT_JSON: sa.json };
    expect((await sendFcm(env, 'dead', {}, {}, google.fetcher)).gone).toBe(true);
    expect((await sendFcm(env, 'bad', {}, {}, google.fetcher)).gone).toBe(true);
    const flaky = await sendFcm(env, 'flaky', {}, {}, google.fetcher);
    expect(flaky).toMatchObject({ ok: false, status: 500, gone: false, error: 'Internal error' });
    // A payload problem (INVALID_ARGUMENT not about the token) never deletes the token.
    expect(isGoneTokenError(400, JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: "Invalid value at 'message.data[0].value'" } }))).toBe(false);
    expect(isGoneTokenError(403, JSON.stringify({ error: { status: 'PERMISSION_DENIED', details: [{ errorCode: 'SENDER_ID_MISMATCH' }] } }))).toBe(true);
  });

  it('refreshes the access token once on a 401', async () => {
    let fcmCalls = 0;
    const base = fakeGoogle();
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('https://fcm.googleapis.com/')) {
        fcmCalls++;
        if (fcmCalls === 1) return new Response(JSON.stringify({ error: { status: 'UNAUTHENTICATED', message: 'expired' } }), { status: 401 });
      }
      return base.fetcher(input, init);
    }) as typeof fetch;
    const r = await sendFcm({ FCM_SERVICE_ACCOUNT_JSON: sa.json }, 'tok', {}, {}, fetcher);
    expect(r.ok).toBe(true);
    expect(base.tokenExchanges()).toBe(2);
  });

  it('never throws: no credentials, or the network fails', async () => {
    expect(await sendFcm({}, 'tok', {})).toMatchObject({ ok: false, gone: false });
    const r = await sendFcm({ FCM_SERVICE_ACCOUNT_JSON: sa.json }, 'tok', {}, {}, (async () => { throw new Error('offline'); }) as typeof fetch);
    expect(r).toMatchObject({ ok: false, status: 0, gone: false, error: 'offline' });
  });

  it('turns data into strings', () => {
    expect(toFcmData({ a: 'x', b: 1, c: true, d: { e: 1 }, f: undefined, g: null })).toEqual({ a: 'x', b: '1', c: 'true', d: '{"e":1}' });
  });
});
