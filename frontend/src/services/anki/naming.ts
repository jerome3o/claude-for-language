/**
 * File names for an Anki export — pure (no IndexedDB, no network), so the native Lab app's
 * port (android-lab/core/…/anki/AnkiNaming.kt) is parity-tested against these functions.
 */

import { pinyin } from 'pinyin-pro';
import { sha1Hex } from './hash';

/**
 * `Readers::小猫的一天` → `Readers-xiao-mao-de-yi-tian.apkg`.
 * ASCII only: Chinese is transliterated to toneless pinyin because some
 * browsers drop a non-ASCII `download` name and save a file called
 * "download" with no extension, which Anki then can't open.
 */
export function apkgFilename(title: string): string {
  const transliterated = title
    .replace(/::/g, ' ')
    .replace(/[㐀-鿿]+/g, run => ` ${pinyin(run, { toneType: 'none', type: 'array' }).join('-')} `);
  const base = transliterated
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'anki-export';
  return `${base}.apkg`;
}

/** The media file extension for a clip's MIME type (mp3 when unknown). */
export function mediaExtension(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('mpeg') || t.includes('mp3')) return 'mp3';
  if (t.includes('wav')) return 'wav';
  if (t.includes('ogg')) return 'ogg';
  if (t.includes('webm')) return 'webm';
  if (t.includes('aac') || t.includes('mp4')) return 'm4a';
  return 'mp3';
}

/** Media files are named by a hash of their bytes, so identical clips dedupe and
 * re-exports overwrite rather than pile up in Anki's media folder. */
export function mediaFilename(data: Uint8Array, type: string): string {
  return `${sha1Hex(data).slice(0, 20)}.${mediaExtension(type)}`;
}
