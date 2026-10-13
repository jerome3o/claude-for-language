/**
 * "Turn off chat emails" links (docs/CHAT.md "E-mail opt-out").
 *
 * Every chat e-mail carries a link that needs no sign-in: a token that is the
 * HMAC of the user id and the purpose, keyed by a worker secret. It never
 * expires (an old e-mail's link must still work) and only ever changes ONE
 * preference of ONE account, so a leaked token can at worst flip someone's chat
 * e-mails — the page offers "Turn back on" for exactly that reason.
 *
 *   token = <b64url(userId)>.<b64url(HMAC-SHA256(key, "<purpose>:<userId>"))>
 */

export type UnsubscribePurpose = 'chat' | 'homework';

/** `?k=` on the link: which e-mails it turns off (none = chat, the links already sent). */
export function purposeFromQuery(k: string | null | undefined): UnsubscribePurpose {
  return k === 'homework' ? 'homework' : 'chat';
}

type SecretEnv = { SESSION_SECRET?: string; GOOGLE_CLIENT_SECRET?: string; E2E_TEST_MODE?: string };

const DEV_SECRET = 'dev-only-email-unsubscribe-secret';

/** The default public origin of the API worker (the links point at it, not the Pages site). */
export const DEFAULT_API_ORIGIN = 'https://chinese-learning-api.jeromeswannack.workers.dev';

function secretFor(env: SecretEnv): string {
  if (env.SESSION_SECRET) return `email-unsubscribe:${env.SESSION_SECRET}`;
  if (env.GOOGLE_CLIENT_SECRET) return `email-unsubscribe:${env.GOOGLE_CLIENT_SECRET}`;
  if (env.E2E_TEST_MODE === 'true') return DEV_SECRET;
  throw new Error('SESSION_SECRET is not set');
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sign(env: SecretEnv, purpose: UnsubscribePurpose, userId: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secretFor(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${purpose}:${userId}`))));
}

export async function createUnsubscribeToken(env: SecretEnv, userId: string, purpose: UnsubscribePurpose = 'chat'): Promise<string> {
  return `${b64url(new TextEncoder().encode(userId))}.${await sign(env, purpose, userId)}`;
}

/** The user id a valid token was made for, else null. */
export async function verifyUnsubscribeToken(
  env: SecretEnv,
  token: string | null | undefined,
  purpose: UnsubscribePurpose = 'chat',
): Promise<string | null> {
  if (!token || token.length > 512) return null;
  const [idPart, sig, extra] = token.split('.');
  if (!idPart || !sig || extra !== undefined) return null;
  let userId: string;
  try {
    userId = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(fromB64url(idPart));
  } catch {
    return null;
  }
  if (!userId) return null;
  const expected = await sign(env, purpose, userId);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? userId : null;
}

/** The link in the e-mail body (opens the confirmation page) — also the List-Unsubscribe target. */
export function unsubscribeUrl(apiOrigin: string | undefined, token: string, purpose: UnsubscribePurpose = 'chat'): string {
  return `${(apiOrigin || DEFAULT_API_ORIGIN).replace(/\/+$/, '')}/api/email/unsubscribe?t=${encodeURIComponent(token)}${purpose === 'chat' ? '' : `&k=${purpose}`}`;
}

/**
 * The headers that give mail apps their own "Unsubscribe" button (RFC 2369 +
 * RFC 8058 one-click: the client POSTs `List-Unsubscribe=One-Click` to the URL).
 */
export function listUnsubscribeHeaders(url: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/**
 * The tiny page the link opens. Opening it must not change anything by itself
 * (mail scanners fetch links) — the page POSTs as soon as it loads in a real
 * browser, so for a person it is still one tap; without JavaScript there is a
 * button. `state` = what the page shows first.
 */
/** What the page says for each kind of e-mail. */
const PAGE_COPY: Record<UnsubscribePurpose, { title: string; lower: string; offBody: string; onBody: string; turnOff: string }> = {
  chat: {
    title: 'Chat e-mails',
    lower: 'chat e-mails',
    offBody: 'You won’t get an e-mail for new chat messages any more. Notifications in the app are not affected.',
    onBody: 'You’ll get an e-mail when someone sends you a chat message.',
    turnOff: 'Turn off chat e-mails',
  },
  homework: {
    title: 'Homework e-mails',
    lower: 'homework e-mails',
    offBody: 'You won’t get an e-mail when homework arrives or the day before it’s due. Your homework is still in the app.',
    onBody: 'You’ll get an e-mail when your tutor sends homework, and a reminder the evening before it’s due.',
    turnOff: 'Turn off homework e-mails',
  },
};

export function unsubscribePageHtml(input: {
  token: string;
  state: 'pending' | 'off' | 'on' | 'invalid';
  appUrl: string;
  /** Which e-mails (default chat). */
  purpose?: UnsubscribePurpose;
}): string {
  const purpose = input.purpose ?? 'chat';
  const copy = PAGE_COPY[purpose];
  const t = esc(input.token);
  // The forms and the script carry `k` so the POST changes the same switch.
  const q = `t=${t}${purpose === 'chat' ? '' : `&amp;k=${purpose}`}`;
  const app = esc(input.appUrl);
  const body =
    input.state === 'invalid'
      ? `<h1>This link doesn’t work</h1><p>It may have been copied incompletely. You can turn ${copy.lower} off in the app: <a href="${app}/settings">Settings → Notifications</a>.</p>`
      : `<div id="pending" ${input.state === 'pending' ? '' : 'hidden'}>
  <h1 id="pending-title">Turning off ${copy.lower}…</h1>
  <noscript><p>Tap the button to turn them off.</p><form method="post" action="/api/email/unsubscribe?${q}"><button type="submit">${copy.turnOff}</button></form></noscript>
</div>
<div id="off" ${input.state === 'off' ? '' : 'hidden'}>
  <h1>${copy.title} are off</h1>
  <p>${copy.offBody}</p>
  <form method="post" action="/api/email/resubscribe?${q}" data-action="resubscribe"><button type="submit" class="secondary">Turn back on</button></form>
</div>
<div id="on" ${input.state === 'on' ? '' : 'hidden'}>
  <h1>${copy.title} are on</h1>
  <p>${copy.onBody}</p>
  <form method="post" action="/api/email/unsubscribe?${q}" data-action="unsubscribe"><button type="submit">${copy.turnOff}</button></form>
</div>
<p class="small"><a href="${app}/settings">Open the app’s settings</a></p>`;
  // In a browser the page turns e-mails off as it loads (one tap from the
  // e-mail) and the two buttons switch without reloading.
  const script =
    input.state === 'invalid'
      ? ''
      : `<script>
(function(){
  var t=${JSON.stringify(input.token)};var k=${JSON.stringify(purpose === 'chat' ? '' : purpose)};
  function show(id){['pending','off','on'].forEach(function(k){document.getElementById(k).hidden=k!==id;});}
  function post(action){return fetch('/api/email/'+action+'?t='+encodeURIComponent(t)+(k?'&k='+k:''),{method:'POST',headers:{'Accept':'application/json'}}).then(function(r){if(!r.ok)throw 0;show(action==='resubscribe'?'on':'off');}).catch(function(){show('pending');document.getElementById('pending-title').textContent='Something went wrong — reload to try again';});}
  document.querySelectorAll('form[data-action]').forEach(function(f){f.addEventListener('submit',function(e){e.preventDefault();post(f.getAttribute('data-action'));});});
  ${input.state === 'pending' ? "post('unsubscribe');" : ''}
})();
</script>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${copy.title}</title>
<style>
:root{color-scheme:light dark;--bg:#f7f7f8;--card:#fff;--fg:#1f2937;--muted:#6b7280;--accent:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--card:#1b1e25;--fg:#e5e7eb;--muted:#9ca3af;--accent:#60a5fa}}
body{margin:0;background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.5}
main{max-width:420px;width:calc(100% - 32px);box-sizing:border-box;margin:12vh auto 0;padding:24px 20px;background:var(--card);border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:1.3rem;margin:0 0 .5rem}p{margin:.4rem 0 1rem;color:var(--muted)}.small{font-size:.9rem;margin-top:1.2rem}
button{font:inherit;min-height:44px;padding:0 18px;border-radius:10px;border:0;background:var(--accent);color:#fff;cursor:pointer}
button.secondary{background:transparent;color:var(--accent);border:1px solid var(--accent)}a{color:var(--accent)}
</style></head><body><main>${body}</main>${script}</body></html>`;
}
