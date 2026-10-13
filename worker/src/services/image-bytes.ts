/** Image byte helpers shared by uploads (picture hunts, chat photos, card pictures). */

/**
 * JPEG with the metadata segments (EXIF incl. GPS, XMP, comments) taken out.
 * The apps already re-encode photos without them; this is the server's belt
 * and braces. Other formats pass through unchanged.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let o = 2;
  while (o + 4 <= bytes.length) {
    if (bytes[o] !== 0xff) return bytes; // not a clean marker stream: leave it alone
    const marker = bytes[o + 1];
    if (marker === 0xda) {
      parts.push(bytes.subarray(o));
      break;
    }
    const len = (bytes[o + 2] << 8) | bytes[o + 3];
    const segment = bytes.subarray(o, o + 2 + len);
    // APP1 (EXIF / XMP), APP2–APP15 except APP14 (Adobe colour), COM
    const drop = (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe;
    if (!drop) parts.push(segment);
    o += 2 + len;
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
