/**
 * Response headers for anything served out of R2 (audio clips, pictures, uploaded files).
 *
 * The stored Content-Type came from whoever uploaded the object, so a response must never
 * let a browser treat it as a page of this origin:
 * - `X-Content-Type-Options: nosniff` — the type is taken as given, never guessed;
 * - `Content-Security-Policy: sandbox; default-src 'none'` — even if it is opened as a
 *   document, it runs no script and loads nothing (ignored for <img> / <audio> / <video>);
 * - `Content-Disposition: attachment` for everything that is not audio, video or a raster
 *   picture, and active types (HTML, SVG, XML, scripts) are sent as application/octet-stream.
 * Media elements and fetch() ignore Content-Disposition, so playback and the apps' blob
 * downloads are unchanged.
 */

const RASTER_IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/;
const ACTIVE_TYPES = /(html|xml|svg|javascript|ecmascript|x-sh|xhtml)/;

/** The bare media type ("Text/HTML; charset=utf-8" → "text/html"). */
export function bareContentType(raw: string | null | undefined): string {
  return (raw ?? '').split(';')[0].trim().toLowerCase();
}

/** May this type be shown inline (played / drawn) without risk? */
export function isInlineSafeType(raw: string | null | undefined): boolean {
  const t = bareContentType(raw);
  return t.startsWith('audio/') || t.startsWith('video/') || RASTER_IMAGE.test(t);
}

/** A file name safe inside a key or a header: no path separators, controls or quotes. */
export function safeFileName(raw: string | null | undefined, fallback = 'file'): string {
  const cleaned = (raw ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f"'\\/<>:*?|%#&;]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s_]+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

/**
 * Set Content-Type plus the safety headers on `headers`. `filename` names the download.
 * Returns the Content-Type actually sent.
 */
export function applyStoredFileHeaders(
  headers: Headers,
  opts: { contentType?: string | null; fallbackType?: string; filename?: string | null } = {},
): string {
  const given = bareContentType(opts.contentType) || bareContentType(opts.fallbackType) || 'application/octet-stream';
  const inline = isInlineSafeType(given);
  const type = !inline && ACTIVE_TYPES.test(given) ? 'application/octet-stream' : given;
  headers.set('Content-Type', type);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "sandbox; default-src 'none'");
  if (!inline) {
    const name = opts.filename ? safeFileName(opts.filename) : null;
    headers.set('Content-Disposition', name ? `attachment; filename*=UTF-8''${encodeURIComponent(name)}` : 'attachment');
  }
  return type;
}
