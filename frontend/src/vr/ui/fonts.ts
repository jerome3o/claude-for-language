/**
 * Chinese in VR windows (docs/VR.md "Fonts"): Noto Sans SC (SIL OFL 1.1), self-hosted from
 * @fontsource-variable/noto-sans-sc — ~100 woff2 slices by Unicode range, imported ONLY by the VR
 * chunk. The browser fetches just the slices holding the characters a window draws (font-src
 * 'self', no CDN); the service worker keeps them once fetched (vite.config.ts "vr-fonts") and
 * leaves them out of the precache, so nobody downloads the font who never opens /vr.
 */
import '@fontsource-variable/noto-sans-sc/index.css';

const attempted = new Set<string>();

/**
 * Loads the font slices for every text a panel draws. Resolves true when something new loaded
 * (the panel then lays out again: the metrics changed), false when everything was already there.
 */
export async function ensureFonts(texts: ReadonlyMap<string, string>): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts) return false;
  const loads: Promise<unknown>[] = [];
  for (const [font, text] of texts) {
    // Offline with a slice never fetched: try once, then draw with the fallback font (no redraw loop).
    const key = `${font}\u0000${text}`;
    if (attempted.has(key)) continue;
    try {
      if (!document.fonts.check(font, text)) {
        attempted.add(key);
        loads.push(document.fonts.load(font, text));
      }
    } catch {
      /* an odd font string: the system font draws it */
    }
  }
  if (loads.length === 0) return false;
  await Promise.allSettled(loads);
  return true;
}
