/**
 * Link previews for chat messages (docs/CHAT.md "Round 2"): the page's Open
 * Graph / Twitter card / <title>, fetched by the worker so the browser doesn't
 * need CORS. Only public http(s) URLs; at most 512 KB read; 5 s.
 */

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
}

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;

/** null when the URL must not be fetched (not http(s), credentials, a port, a private / local host). */
export function safePreviewUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return null;
  // IP literals: refuse private, loopback, link-local and any IPv6 literal.
  if (host.includes(':')) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return null;
  }
  return u;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function clean(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  const t = decodeEntities(s).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? null) : null;
}

/** The preview from a page's HTML (only the <head> matters). null when it has no title at all. */
export function parseLinkPreview(html: string, pageUrl: string): LinkPreview | null {
  const head = html.slice(0, MAX_BYTES);
  const meta = new Map<string, string>();
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
    const content = attr(tag, 'content');
    if (key && content != null && !meta.has(key)) meta.set(key, content);
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? null;
  const title = clean(meta.get('og:title') ?? meta.get('twitter:title') ?? titleTag, 200);
  if (!title) return null;
  let image: string | null = meta.get('og:image') ?? meta.get('og:image:url') ?? meta.get('twitter:image') ?? null;
  if (image) {
    try {
      const abs = new URL(decodeEntities(image.trim()), pageUrl);
      image = abs.protocol === 'https:' || abs.protocol === 'http:' ? abs.toString() : null;
    } catch {
      image = null;
    }
  }
  let site = clean(meta.get('og:site_name') ?? null, 80);
  if (!site) {
    try {
      site = new URL(pageUrl).hostname.replace(/^www\./, '');
    } catch {
      site = null;
    }
  }
  return {
    url: pageUrl,
    title,
    description: clean(meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description') ?? null, 300),
    image,
    site_name: site,
  };
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.byteLength;
    // The head is enough; stop early once it has ended.
    if (total > 4096 && /<\/head>/i.test(new TextDecoder().decode(value))) break;
  }
  await reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(total, MAX_BYTES));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, all.length - off);
    all.set(c.subarray(0, take), off);
    off += take;
    if (off >= all.length) break;
  }
  return new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(all);
}

export async function fetchLinkPreview(raw: string, fetcher: typeof fetch = fetch): Promise<LinkPreview | null> {
  const url = safePreviewUrl(raw);
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetcher(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ChineseLearningLinkPreview/1.0)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en,zh;q=0.8',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const finalUrl = res.url || url.toString();
    if (!safePreviewUrl(finalUrl)) return null;
    const type = res.headers.get('Content-Type') || '';
    if (/^image\//i.test(type)) {
      return { url: finalUrl, title: null, description: null, image: finalUrl, site_name: new URL(finalUrl).hostname.replace(/^www\./, '') };
    }
    if (!/html/i.test(type)) return null;
    return parseLinkPreview(await readCapped(res), finalUrl);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
