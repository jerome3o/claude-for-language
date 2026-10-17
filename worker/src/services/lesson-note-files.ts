/**
 * Files attached to lesson notes (POST /api/lesson-notes/:id/files): only document, picture
 * and audio types, recognised by extension AND checked against the first bytes where the
 * format has a signature. The stored Content-Type is ours, never the uploader's, and the
 * file name is cleaned before it goes into the R2 key.
 */
import { sniffImage } from './picture-hunt';
import { safeFileName } from './stored-file-headers';

type Check = 'pdf' | 'zip' | 'image' | 'gif' | 'none';

const ALLOWED: Record<string, { type: string; check: Check }> = {
  pdf: { type: 'application/pdf', check: 'pdf' },
  docx: { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: 'zip' },
  pptx: { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', check: 'zip' },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', check: 'zip' },
  txt: { type: 'text/plain; charset=utf-8', check: 'none' },
  md: { type: 'text/plain; charset=utf-8', check: 'none' },
  csv: { type: 'text/csv; charset=utf-8', check: 'none' },
  png: { type: 'image/png', check: 'image' },
  jpg: { type: 'image/jpeg', check: 'image' },
  jpeg: { type: 'image/jpeg', check: 'image' },
  webp: { type: 'image/webp', check: 'image' },
  gif: { type: 'image/gif', check: 'gif' },
  heic: { type: 'image/heic', check: 'none' },
  heif: { type: 'image/heif', check: 'none' },
  mp3: { type: 'audio/mpeg', check: 'none' },
  m4a: { type: 'audio/mp4', check: 'none' },
  aac: { type: 'audio/aac', check: 'none' },
  wav: { type: 'audio/wav', check: 'none' },
  ogg: { type: 'audio/ogg', check: 'none' },
  webm: { type: 'audio/webm', check: 'none' },
};

export const LESSON_NOTE_FILE_TYPES = Object.keys(ALLOWED);

/** The cleaned name and the type to store, or null when the file isn't an allowed kind. */
export function lessonNoteFileType(rawName: string | null | undefined, head: Uint8Array): { filename: string; contentType: string } | null {
  const filename = safeFileName(rawName, 'upload');
  const ext = (filename.includes('.') ? filename.split('.').pop()! : '').toLowerCase();
  const rule = ALLOWED[ext];
  if (!rule) return null;
  const ascii = (n: number) => String.fromCharCode(...head.subarray(0, n));
  let ok = true;
  if (rule.check === 'pdf') ok = ascii(5) === '%PDF-';
  else if (rule.check === 'zip') ok = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  else if (rule.check === 'image') ok = sniffImage(head)?.mime === rule.type;
  else if (rule.check === 'gif') ok = ascii(6) === 'GIF87a' || ascii(6) === 'GIF89a';
  if (!ok) return null;
  // A "text" file that is really a web page is refused too.
  if (rule.type.startsWith('text/') && /<\s*(html|script|svg|iframe)\b/i.test(new TextDecoder().decode(head.subarray(0, 4096)))) return null;
  return { filename, contentType: rule.type };
}
