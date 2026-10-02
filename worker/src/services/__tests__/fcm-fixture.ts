/** Test helpers for FCM: a real RSA service account and a fake Google (token endpoint + FCM send). */

export async function makeServiceAccount(projectId = 'demo-project'): Promise<{ json: string; publicKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  let bin = '';
  for (const b of pkcs8) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/(.{64})/g, '$1\n');
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
  const json = JSON.stringify({
    type: 'service_account',
    project_id: projectId,
    client_email: `push@${projectId}.iam.gserviceaccount.com`,
    private_key: pem,
  });
  return { json, publicKey: pair.publicKey };
}

export interface FakeGoogleCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * A fetch that answers the OAuth token exchange and FCM sends. `answers` maps a
 * device token to the FCM reply (default 200).
 */
export function fakeGoogle(answers: Record<string, { status: number; body?: unknown }> = {}, opts: { expiresIn?: number } = {}) {
  const calls: FakeGoogleCall[] = [];
  let tokenCount = 0;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({ url, headers, body });
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenCount++;
      return new Response(JSON.stringify({ access_token: `access-${tokenCount}`, expires_in: opts.expiresIn ?? 3600, token_type: 'Bearer' }), { status: 200 });
    }
    if (url.startsWith('https://fcm.googleapis.com/v1/projects/')) {
      const token = (JSON.parse(body) as { message: { token: string } }).message.token;
      const a = answers[token] ?? { status: 200, body: { name: 'projects/x/messages/1' } };
      return new Response(JSON.stringify(a.body ?? {}), { status: a.status });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return {
    fetcher,
    calls,
    sends: () => calls.filter((c) => c.url.startsWith('https://fcm.googleapis.com/')).map((c) => ({ ...c, json: JSON.parse(c.body) as { message: { token: string; data: Record<string, string>; android: Record<string, string> } } })),
    tokenExchanges: () => calls.filter((c) => c.url === 'https://oauth2.googleapis.com/token').length,
  };
}

export const UNREGISTERED = {
  status: 404,
  body: { error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } },
};
export const INVALID_TOKEN = {
  status: 400,
  body: { error: { code: 400, message: 'The registration token is not a valid FCM registration token', status: 'INVALID_ARGUMENT' } },
};
export const SERVER_ERROR = { status: 500, body: { error: { code: 500, message: 'Internal error', status: 'INTERNAL' } } };
