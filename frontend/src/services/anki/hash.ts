/**
 * Small, dependency-free hashes for deterministic Anki identifiers.
 *
 * Anki matches things across imports by id, not by name: models and decks by
 * their integer id, notes by their GUID. Deriving all three from stable input
 * (a fixed namespace + the app's own ids) means re-exporting a deck UPDATES
 * the notes already in the user's collection instead of duplicating them.
 */

/** cyrb53 — a fast 53-bit string hash (public domain, bryc). */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * A stable 31-bit id in [2^30, 2^31) — the range genanki recommends for
 * model and deck ids — derived from a namespace and a name.
 */
export function stableId(namespace: string, name: string): number {
  const h = cyrb53(`${namespace}::${name}`);
  return (h % 1073741824) + 1073741824;
}

// Anki's GUID alphabet (base91) — the same table genanki uses.
const BASE91 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';

/**
 * A 10 character base91 GUID derived from the given parts. Two independent
 * 53-bit hashes give 106 bits of input — plenty to avoid collisions within a
 * collection, and identical every time the same source is exported.
 */
export function guidFor(...parts: string[]): string {
  const input = parts.join('|');
  let out = '';
  for (const seed of [0x9e3779b9, 0x7f4a7c15]) {
    let n = cyrb53(input, seed);
    for (let i = 0; i < 5; i++) {
      out += BASE91[n % 91];
      n = Math.floor(n / 91);
    }
  }
  return out;
}

/** Pure-JS SHA-1 (hex). Used for Anki's field checksum and media names, so
 * it works the same in the browser, in workers and under vitest. */
export function sha1Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const ml = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) << 6) + 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, ml >>> 0);
  view.setUint32(padded.length - 8, Math.floor(ml / 4294967296));

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map(n => n.toString(16).padStart(8, '0')).join('');
}

/** Anki's note checksum: the first 8 hex digits of sha1(first field, HTML stripped). */
export function fieldChecksum(field: string): number {
  return parseInt(sha1Hex(stripHtmlMedia(field)).slice(0, 8), 16);
}

/** Anki's stripHTMLMedia: drop [sound:] tags, <img>s and other markup. */
export function stripHtmlMedia(text: string): string {
  return text
    .replace(/\[sound:[^\]]+\]/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}
