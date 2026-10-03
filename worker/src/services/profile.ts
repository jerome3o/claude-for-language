/**
 * The editable profile (display name, picture, bio, About me, time zone).
 *
 * users.name / users.picture_url remain the EFFECTIVE values that every other
 * query reads, so an edit reaches relationships, chat, invites, the tutor
 * dashboard and the MCP tools without touching them. Google's own values live
 * in google_name / google_picture_url; the sign-in refreshes those always and
 * the effective ones only while the user follows Google (see
 * googleProfileRefresh, used by services/auth.ts touchExistingUser).
 */
import type { User } from '../types';
import {
  PROFILE_PICTURE_MAX_BYTES,
  type PictureSource,
  type Profile,
  type ProfileUpdate,
} from '@shared/profile';
import { parseVoiceGender } from '@shared/chats';

export const AVATAR_PREFIX = 'avatars/';

type ProfileRow = Pick<User, 'id' | 'email' | 'name' | 'picture_url' | 'bio'> & {
  google_name: string | null;
  google_picture_url: string | null;
  name_custom: number | null;
  picture_source: string | null;
  picture_key: string | null;
  about: string | null;
  time_zone: string | null;
  voice_gender: string | null;
};

const PROFILE_COLUMNS =
  'id, email, name, picture_url, bio, google_name, google_picture_url, name_custom, picture_source, picture_key, about, time_zone, voice_gender';

function asPictureSource(v: string | null | undefined): PictureSource {
  return v === 'upload' || v === 'none' ? v : 'google';
}

export function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    picture_url: row.picture_url,
    picture_source: asPictureSource(row.picture_source),
    name_custom: !!row.name_custom,
    google_name: row.google_name,
    google_picture_url: row.google_picture_url,
    bio: row.bio || null,
    about: row.about || null,
    time_zone: row.time_zone || null,
    voice_gender: parseVoiceGender(row.voice_gender),
  };
}

async function getRow(db: D1Database, userId: string): Promise<ProfileRow | null> {
  return db.prepare(`SELECT ${PROFILE_COLUMNS} FROM users WHERE id = ?`).bind(userId).first<ProfileRow>();
}

export async function getProfile(db: D1Database, userId: string): Promise<Profile | null> {
  const row = await getRow(db, userId);
  return row ? toProfile(row) : null;
}

/** Apply a validated update (shared/profile pickProfileUpdate). name null = follow Google again. */
export async function updateProfile(db: D1Database, userId: string, update: ProfileUpdate): Promise<Profile | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (update.name !== undefined) {
    if (update.name === null) {
      sets.push('name = COALESCE(google_name, name)', 'name_custom = 0');
    } else {
      sets.push('name = ?', 'name_custom = 1');
      binds.push(update.name);
    }
  }
  for (const key of ['bio', 'about', 'time_zone', 'voice_gender'] as const) {
    if (update[key] !== undefined) {
      sets.push(`${key} = ?`);
      binds.push(update[key]);
    }
  }
  if (sets.length) {
    await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, userId).run();
  }
  return getProfile(db, userId);
}

/**
 * The statement the Google sign-in runs for an existing user: Google's values
 * are always remembered, but they only become the displayed name / picture
 * while the user hasn't set their own.
 */
export function googleProfileRefresh(
  db: D1Database,
  userId: string,
  google: { id: string; name: string | null; picture: string | null; email: string },
  isAdmin: number
): D1PreparedStatement {
  return db
    .prepare(`
      UPDATE users SET
        google_id = ?,
        last_login_at = datetime('now'),
        google_name = ?,
        google_picture_url = ?,
        name = CASE WHEN name_custom = 1 THEN name ELSE ? END,
        picture_url = CASE WHEN picture_source = 'google' THEN ? ELSE picture_url END,
        email = ?,
        is_admin = ?
      WHERE id = ?
    `)
    .bind(google.id, google.name, google.picture, google.name, google.picture, google.email, isAdmin, userId);
}

// ---------- Pictures ----------

export type ImageKind = { mime: 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'jpg' | 'png' | 'webp' };

/** What the bytes really are (never trust the Content-Type alone); null = not an accepted image. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { mime: 'image/png', ext: 'png' };
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

/** Problems with an uploaded picture ([] = fine). */
export function pictureProblems(bytes: Uint8Array | null): string[] {
  if (!bytes || bytes.length === 0) return ['No picture was sent'];
  if (bytes.length > PROFILE_PICTURE_MAX_BYTES) return [`The picture must be at most ${PROFILE_PICTURE_MAX_BYTES / 1024 / 1024} MB`];
  if (!sniffImage(bytes)) return ['The picture must be a JPEG, PNG or WebP image'];
  return [];
}

/** Public URL of an avatar key: the existing public GET /api/audio/<key> route serves any R2 object. */
export function avatarUrl(origin: string, key: string): string {
  return `${origin.replace(/\/$/, '')}/api/audio/${key}`;
}

/** Store a new picture, point the profile at it and drop the previous upload. */
export async function setUploadedPicture(
  db: D1Database,
  bucket: R2Bucket,
  userId: string,
  bytes: Uint8Array,
  origin: string
): Promise<Profile | null> {
  const kind = sniffImage(bytes)!;
  const before = await getRow(db, userId);
  const key = `${AVATAR_PREFIX}${userId}/${crypto.randomUUID()}.${kind.ext}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: kind.mime, cacheControl: 'public, max-age=31536000' } });
  await db
    .prepare("UPDATE users SET picture_url = ?, picture_key = ?, picture_source = 'upload' WHERE id = ?")
    .bind(avatarUrl(origin, key), key, userId)
    .run();
  if (before?.picture_key && before.picture_key !== key) {
    await bucket.delete(before.picture_key).catch(() => {});
  }
  return getProfile(db, userId);
}

/** Drop an uploaded picture: back to the Google photo ('google') or no photo at all ('none'). */
export async function clearPicture(
  db: D1Database,
  bucket: R2Bucket,
  userId: string,
  use: 'google' | 'none'
): Promise<Profile | null> {
  const before = await getRow(db, userId);
  if (use === 'google') {
    await db
      .prepare("UPDATE users SET picture_url = google_picture_url, picture_key = NULL, picture_source = 'google' WHERE id = ?")
      .bind(userId)
      .run();
  } else {
    await db
      .prepare("UPDATE users SET picture_url = NULL, picture_key = NULL, picture_source = 'none' WHERE id = ?")
      .bind(userId)
      .run();
  }
  if (before?.picture_key) await bucket.delete(before.picture_key).catch(() => {});
  return getProfile(db, userId);
}

/** Read the picture bytes from a request: multipart (field `picture` or `file`) or a raw image body. */
export async function readPictureBytes(req: Request): Promise<Uint8Array | null> {
  const type = req.headers.get('Content-Type') || '';
  if (type.startsWith('multipart/form-data')) {
    const form = await req.formData();
    const file = (form.get('picture') ?? form.get('file')) as unknown;
    if (!file || typeof file === 'string') return null;
    return new Uint8Array(await (file as Blob).arrayBuffer());
  }
  const buf = await req.arrayBuffer();
  return buf.byteLength ? new Uint8Array(buf) : null;
}
