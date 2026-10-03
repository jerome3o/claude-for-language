/**
 * Photo and voice messages (docs/CHAT.md PR 2): what an upload may be, how it
 * is checked (magic bytes, never the client's Content-Type alone), where it
 * lives in R2 and what the client is told about it.
 *
 * The R2 key `chat-media/<conversationId>/<messageId>.<ext>` is stored inside
 * `messages.attachment` (so the storage clean-up's reference scan and account
 * deletion find it) and stripped from every response (`publicAttachment`).
 */

import { chatMessagePreview } from '@shared/chats/inbox';
import type { ChatAttachment, MessageWithSender } from '../../types';
import { sniffImage, extFor as imageExt } from '../picture-hunt';

export const CHAT_MEDIA_PREFIX = 'chat-media/';
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
export const VOICE_MAX_MS = 5 * 60 * 1000;
export const FILE_MAX_BYTES = 20 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 25 * 1024 * 1024;
export const FILE_NAME_MAX = 200;
export const CAPTION_MAX = 4000;

export type ChatMediaKind = ChatAttachment['kind'];

/** What `messages.attachment` holds: the public attachment plus its R2 key. */
export type StoredAttachment = ChatAttachment & { key: string };

export type AudioMime = 'audio/webm' | 'audio/ogg' | 'audio/mp4' | 'audio/aac' | 'audio/mpeg' | 'audio/wav';

const AUDIO_EXT: Record<AudioMime, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

export function chatMediaKey(conversationId: string, messageId: string, ext: string): string {
  return `chat-media/${conversationId}/${messageId}.${ext}`;
}

export function chatMediaUrl(messageId: string): string {
  return `/api/chat-media/${messageId}`;
}

/** The audio container from the first bytes; null when it is not one we take. */
export function sniffAudio(bytes: Uint8Array): AudioMime | null {
  if (bytes.length < 12) return null;
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm';
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(4, 8) === 'ftyp') return 'audio/mp4';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(0, 3) === 'ID3') return 'audio/mpeg';
  if (bytes[0] === 0xff) {
    if ((bytes[1] & 0xf6) === 0xf0) return 'audio/aac'; // ADTS
    if ((bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0) return 'audio/mpeg'; // MPEG audio frame
  }
  return null;
}

export class ChatMediaError extends Error {
  constructor(message: string, readonly status: 400 | 413 | 415) {
    super(message);
    this.name = 'ChatMediaError';
  }
}

export function maxBytesFor(kind: ChatMediaKind): number {
  return kind === 'image' ? IMAGE_MAX_BYTES : kind === 'voice' ? VOICE_MAX_BYTES : kind === 'file' ? FILE_MAX_BYTES : VIDEO_MAX_BYTES;
}

export function tooBigMessage(kind: ChatMediaKind): string {
  return kind === 'image'
    ? 'Photos can be at most 8 MB'
    : kind === 'voice'
      ? 'Voice messages can be at most 10 MB'
      : kind === 'file'
        ? 'Files can be at most 20 MB'
        : 'Video clips can be at most 25 MB';
}

export function parseMediaKind(value: unknown): ChatMediaKind | null {
  return value === 'image' || value === 'voice' || value === 'file' || value === 'video' ? value : null;
}

/** Documents we accept, by extension → the type they are served as. Never HTML / SVG / scripts. */
export const FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  rtf: 'application/rtf',
  zip: 'application/zip',
  apkg: 'application/octet-stream',
  epub: 'application/epub+zip',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
};

/** A file name made safe to store and show: no paths or control characters, ≤ 200 characters, keeps its extension. */
export function cleanFileName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  let name = raw.replace(/[\u0000-\u001f\u007f]/g, '').split(/[\\/]/).pop()!.trim();
  if (!name || name === '.' || name === '..') return null;
  if (name.length > FILE_NAME_MAX) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
    name = name.slice(0, FILE_NAME_MAX - ext.length) + ext;
  }
  return name;
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** The video container from the first bytes; null when it is not one we take. */
export function sniffVideo(bytes: Uint8Array): 'video/mp4' | 'video/webm' | 'video/quicktime' | null {
  if (bytes.length < 12) return null;
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
  if (ascii(4, 8) === 'ftyp') return ascii(8, 10) === 'qt' ? 'video/quicktime' : 'video/mp4';
  if (ascii(4, 8) === 'moov' || ascii(4, 8) === 'mdat' || ascii(4, 8) === 'wide') return 'video/quicktime';
  return null;
}

const VIDEO_EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' } as const;

function positiveInt(value: number | null | undefined, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max ? Math.round(value) : null;
}

/** `duration_ms` from the query string: 1 ms … 5 min, else null. */
export function parseDurationMs(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,9}(\.\d+)?$/.test(value.trim())) return null;
  const n = Math.round(Number(value));
  return n >= 1 && n <= VOICE_MAX_MS ? n : null;
}

/**
 * Check an upload and describe it. Throws ChatMediaError (400 / 413 / 415).
 * Returns the attachment (without the key) and the file extension.
 */
export function inspectUpload(
  kind: ChatMediaKind,
  bytes: Uint8Array,
  opts: { durationMs?: number | null; contentType?: string | null; name?: string | null; width?: number | null; height?: number | null } = {},
): { attachment: ChatAttachment; ext: string } {
  if (bytes.length === 0) throw new ChatMediaError('The upload is empty', 400);
  if (bytes.length > maxBytesFor(kind)) throw new ChatMediaError(tooBigMessage(kind), 413);
  const declared = (opts.contentType || '').split(';')[0].trim().toLowerCase();
  if (kind === 'file') {
    const name = cleanFileName(opts.name);
    if (!name) throw new ChatMediaError('A file needs its name (name=…)', 400);
    const ext = fileExtension(name);
    const mime = FILE_TYPES[ext];
    if (!mime) throw new ChatMediaError('That kind of file can’t be sent — PDF, Office documents, text, zip, audio or pictures', 415);
    // A PDF must really be one (it is shown inline).
    if (ext === 'pdf' && String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new ChatMediaError('That PDF looks damaged', 415);
    return { attachment: { kind: 'file', name, bytes: bytes.length, mime }, ext };
  }
  if (kind === 'video') {
    const mime = sniffVideo(bytes);
    if (!mime) throw new ChatMediaError('A video must be MP4, WebM or MOV', 415);
    return {
      attachment: {
        kind: 'video',
        bytes: bytes.length,
        mime,
        duration_ms: positiveInt(opts.durationMs, 30 * 60 * 1000),
        width: positiveInt(opts.width, 10000),
        height: positiveInt(opts.height, 10000),
      },
      ext: VIDEO_EXT[mime],
    };
  }
  if (kind === 'image') {
    if (declared && declared !== 'application/octet-stream' && !declared.startsWith('image/')) {
      throw new ChatMediaError('A photo must be a JPEG, PNG or WebP image', 415);
    }
    const img = sniffImage(bytes);
    if (!img) throw new ChatMediaError('A photo must be a JPEG, PNG or WebP image', 415);
    return {
      attachment: { kind: 'image', width: img.width, height: img.height, bytes: bytes.length, mime: img.mime },
      ext: imageExt(img.mime),
    };
  }
  if (declared && declared !== 'application/octet-stream' && !declared.startsWith('audio/') && !declared.startsWith('video/')) {
    throw new ChatMediaError('A voice message must be WebM, Ogg, MP4/M4A, AAC, MP3 or WAV audio', 415);
  }
  const mime = sniffAudio(bytes);
  if (!mime) throw new ChatMediaError('A voice message must be WebM, Ogg, MP4/M4A, AAC, MP3 or WAV audio', 415);
  const duration = opts.durationMs ?? null;
  if (!duration) throw new ChatMediaError('duration_ms is required for a voice message (1 ms to 5 minutes)', 400);
  return {
    attachment: { kind: 'voice', duration_ms: duration, bytes: bytes.length, mime, transcript_status: 'pending', transcript: null, translation: null },
    ext: AUDIO_EXT[mime],
  };
}

/** `messages.attachment` → the stored shape, or null when absent / unreadable. */
export function parseStoredAttachment(raw: string | null | undefined): StoredAttachment | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as StoredAttachment;
    return v && (v.kind === 'image' || v.kind === 'voice' || v.kind === 'file' || v.kind === 'video') ? v : null;
  } catch {
    return null;
  }
}

/** What clients see: everything but the R2 key. */
export function publicAttachment(stored: StoredAttachment | null): ChatAttachment | null {
  if (!stored) return null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { key, ...rest } = stored;
  return rest as ChatAttachment;
}

/** The one-line text a notification shows for a message (photo / voice / file / video label + caption): the shared rule. */
export function messagePreviewText(message: Pick<MessageWithSender, 'content' | 'attachment' | 'deleted_at'>): string {
  const a = message.attachment;
  return chatMessagePreview({
    content: message.content,
    attachment_kind: a?.kind ?? null,
    attachment_name: a?.kind === 'file' ? a.name : null,
    deleted: !!message.deleted_at,
  });
}
