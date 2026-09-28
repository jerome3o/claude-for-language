import { describe, it, expect, beforeEach } from 'vitest';
import { b64urlDecode, b64urlEncode, encryptPayload, generateVapidKeys, sendWebPush, vapidAuthorization } from '../push/webpush';
import { getVapidKeys, pushToUsers, saveSubscription } from '../push';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import type { Env } from '../../types';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A browser's side of a subscription: its ECDH key pair and auth secret. */
async function fakeBrowser() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, p256dh: b64urlEncode(pub), auth: b64urlEncode(auth), pub, authBytes: auth };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** What the browser does with an aes128gcm push body (RFC 8291), written independently of the sender. */
async function browserDecrypt(body: Uint8Array, b: Awaited<ReturnType<typeof fakeBrowser>>): Promise<string> {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  expect(rs).toBe(4096);
  expect(idlen).toBe(65);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey } as unknown as Parameters<SubtleCrypto['deriveBits']>[0], b.pair.privateKey, 256));
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...b.pub, ...asPublic]);
  const ikm = await hkdf(b.authBytes, secret, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
  expect(plain[plain.length - 1]).toBe(2);
  return dec.decode(plain.slice(0, -1));
}

describe('Web Push encryption (RFC 8291 aes128gcm)', () => {
  it('encrypts a payload the browser can decrypt', async () => {
    const b = await fakeBrowser();
    const text = JSON.stringify({ title: '📹 王老师 is calling', url: '/calls/abc' });
    const body = await encryptPayload(enc.encode(text), b);
    expect(await browserDecrypt(body, b)).toBe(text);
  });

  it('uses a fresh key and salt for every message', async () => {
    const b = await fakeBrowser();
    const one = await encryptPayload(enc.encode('x'), b);
    const two = await encryptPayload(enc.encode('x'), b);
    expect(b64urlEncode(one)).not.toBe(b64urlEncode(two));
  });
});

describe('VAPID', () => {
  it('signs a JWT for the push service origin that verifies with the public key', async () => {
    const keys = { ...(await generateVapidKeys()), subject: 'mailto:admin@example.com' };
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 1_800_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m).toBeTruthy();
    expect(m[4]).toBe(keys.publicKey);
    const claims = JSON.parse(dec.decode(b64urlDecode(m[2])));
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 12 * 3600, sub: 'mailto:admin@example.com' });
    const pub = await crypto.subtle.importKey('raw', b64urlDecode(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(m[3]), enc.encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });
});

describe('sendWebPush', () => {
  it('posts the encrypted body with the push headers and reports a dead subscription', async () => {
    const b = await fakeBrowser();
    const keys = { ...(await generateVapidKeys()), subject: 'mailto:a@b.c' };
    const seen: { url: string; headers: Record<string, string>; body: Uint8Array }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: init.body as Uint8Array });
      return new Response('', { status: seen.length === 1 ? 201 : 410 });
    }) as unknown as typeof fetch;
    const sub = { endpoint: 'https://push.example/sub/1', p256dh: b.p256dh, auth: b.auth };
    const ok = await sendWebPush(sub, { hello: '你好' }, keys, { ttl: 60, topic: 'call-1234' }, fetcher);
    expect(ok).toMatchObject({ ok: true, status: 201, gone: false });
    expect(seen[0].headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '60', Urgency: 'high', Topic: 'call-1234' });
    expect(seen[0].headers.Authorization).toMatch(/^vapid t=/);
    expect(JSON.parse(await browserDecrypt(seen[0].body, b))).toEqual({ hello: '你好' });
    const gone = await sendWebPush(sub, {}, keys, {}, fetcher);
    expect(gone).toMatchObject({ ok: false, status: 410, gone: true });
  });
});

describe('subscriptions and keys (real SQLite)', () => {
  let db: SqliteD1;
  let env: Env;
  beforeEach(async () => {
    db = await createSqliteD1();
    db.raw.exec(`INSERT INTO users (id, email, name) VALUES ('u1', 'a@test', 'A'), ('u2', 'b@test', 'B')`);
    env = { DB: db, ADMIN_EMAIL: 'admin@test' } as unknown as Env;
  });

  it('generates the VAPID key pair once and keeps it', async () => {
    const a = await getVapidKeys(env);
    const b = await getVapidKeys(env);
    expect(a.publicKey).toBe(b.publicKey);
    expect(b64urlDecode(a.publicKey)).toHaveLength(65);
    expect(a.subject).toBe('mailto:admin@test');
  });

  it('prefers the configured secrets', async () => {
    const k = await generateVapidKeys();
    const got = await getVapidKeys({ ...env, VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey } as Env);
    expect(got.publicKey).toBe(k.publicKey);
  });

  it('saves a subscription idempotently, moves it between users, and drops dead / old-key ones on send', async () => {
    const b = await fakeBrowser();
    const input = { endpoint: 'https://push.example/sub/1', keys: { p256dh: b.p256dh, auth: b.auth } };
    await saveSubscription(env, 'u1', input, 'UA');
    await saveSubscription(env, 'u1', input, 'UA');
    expect(db.rows('SELECT user_id FROM push_subscriptions')).toEqual([{ user_id: 'u1' }]);
    await saveSubscription(env, 'u2', input, 'UA');
    expect(db.rows('SELECT user_id FROM push_subscriptions')).toEqual([{ user_id: 'u2' }]);
    await expect(saveSubscription(env, 'u2', { endpoint: 'http://x', keys: input.keys }, null)).rejects.toThrow(/https/);

    const b2 = await fakeBrowser();
    await saveSubscription(env, 'u2', { endpoint: 'https://push.example/sub/2', keys: { p256dh: b2.p256dh, auth: b2.auth } }, null);
    db.raw.exec(`UPDATE push_subscriptions SET vapid_key = 'old' WHERE endpoint LIKE '%/2'`);
    const fetcher = (async () => new Response('', { status: 410 })) as unknown as typeof fetch;
    const r = await pushToUsers(env, ['u2'], { type: 'test' }, {}, fetcher);
    expect(r).toEqual({ sent: 0, failed: 0, removed: 2 });
    expect(db.rows('SELECT id FROM push_subscriptions')).toEqual([]);
  });

  it('counts sends and keeps a subscription through a transient failure', async () => {
    const b = await fakeBrowser();
    await saveSubscription(env, 'u1', { endpoint: 'https://push.example/sub/9', keys: { p256dh: b.p256dh, auth: b.auth } }, null);
    let status = 500;
    const fetcher = (async () => new Response('', { status })) as unknown as typeof fetch;
    expect(await pushToUsers(env, ['u1'], {}, {}, fetcher)).toEqual({ sent: 0, failed: 1, removed: 0 });
    status = 201;
    expect(await pushToUsers(env, ['u1'], {}, {}, fetcher)).toEqual({ sent: 1, failed: 0, removed: 0 });
    expect(db.rows<{ failure_count: number }>('SELECT failure_count FROM push_subscriptions')[0].failure_count).toBe(0);
  });
});
