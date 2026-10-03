/**
 * The editable profile against a REAL SQLite with every migration applied:
 * edits land in users.name / picture_url (what every other screen reads), and
 * the next Google sign-in refreshes Google's values without clobbering them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import {
  avatarUrl,
  clearPicture,
  getProfile,
  pictureProblems,
  setUploadedPicture,
  sniffImage,
  updateProfile,
} from '../profile';
import { createUser, touchExistingUser, type GoogleUserInfo } from '../auth';
import { getRelationshipById } from '../relationships';
import { pickProfileUpdate } from '@shared/profile';
import type { User } from '../../types';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0))));

function fakeBucket() {
  const objects = new Map<string, { bytes: Uint8Array; type?: string }>();
  const deleted: string[] = [];
  return {
    objects,
    deleted,
    bucket: {
      put: async (key: string, bytes: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) => {
        objects.set(key, { bytes, type: opts?.httpMetadata?.contentType });
      },
      delete: async (key: string) => {
        deleted.push(key);
        objects.delete(key);
      },
    } as unknown as R2Bucket,
  };
}

const google = (over: Partial<GoogleUserInfo> = {}): GoogleUserInfo => ({
  id: 'g-1',
  email: 'minghui@example.com',
  verified_email: true,
  name: 'Minghui Zhang',
  picture: 'https://lh3.googleusercontent.com/a/first',
  ...over,
});

const ORIGIN = 'https://api.example.dev';

describe('profile (real SQLite)', () => {
  let db: SqliteD1;
  let user: User;

  beforeEach(async () => {
    db = await createSqliteD1();
    user = await createUser(db, google(), false);
  });

  it('a new Google user follows Google and remembers its values', async () => {
    const p = await getProfile(db, user.id);
    expect(p).toMatchObject({
      name: 'Minghui Zhang',
      picture_url: 'https://lh3.googleusercontent.com/a/first',
      picture_source: 'google',
      name_custom: false,
      google_name: 'Minghui Zhang',
      google_picture_url: 'https://lh3.googleusercontent.com/a/first',
      about: null,
      time_zone: null,
    });
  });

  it('without edits, the next sign-in still refreshes name and picture from Google', async () => {
    await touchExistingUser(db, user, google({ name: 'Minghui Z.', picture: 'https://lh3/second' }), false);
    expect(await getProfile(db, user.id)).toMatchObject({ name: 'Minghui Z.', picture_url: 'https://lh3/second', google_name: 'Minghui Z.' });
  });

  it('Google sign-in does NOT clobber an edited name or an uploaded picture', async () => {
    const { update } = pickProfileUpdate({ name: '明慧老师', about: 'Mandarin tutor in Shanghai.', time_zone: 'Asia/Shanghai' });
    await updateProfile(db, user.id, update);
    const { bucket } = fakeBucket();
    const uploaded = await setUploadedPicture(db, bucket, user.id, JPEG, ORIGIN);

    const fresh = (await db.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<User>())!;
    const after = await touchExistingUser(db, fresh, google({ name: 'Minghui Zhang', picture: 'https://lh3/new-google' }), false);

    expect(after.name).toBe('明慧老师');
    expect(after.picture_url).toBe(uploaded!.picture_url);
    const p = (await getProfile(db, user.id))!;
    expect(p).toMatchObject({
      name: '明慧老师',
      name_custom: true,
      picture_source: 'upload',
      google_name: 'Minghui Zhang',
      google_picture_url: 'https://lh3/new-google',
      about: 'Mandarin tutor in Shanghai.',
      time_zone: 'Asia/Shanghai',
    });
  });

  it('a removed picture stays removed after sign-in; "Use Google photo" follows Google again', async () => {
    const { bucket } = fakeBucket();
    await clearPicture(db, bucket, user.id, 'none');
    let fresh = (await db.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<User>())!;
    await touchExistingUser(db, fresh, google({ picture: 'https://lh3/again' }), false);
    expect((await getProfile(db, user.id))!.picture_url).toBeNull();

    await clearPicture(db, bucket, user.id, 'google');
    expect((await getProfile(db, user.id))!).toMatchObject({ picture_url: 'https://lh3/again', picture_source: 'google' });
    fresh = (await db.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<User>())!;
    await touchExistingUser(db, fresh, google({ picture: 'https://lh3/later' }), false);
    expect((await getProfile(db, user.id))!.picture_url).toBe('https://lh3/later');
  });

  it('name null goes back to the Google name and follows Google again', async () => {
    await updateProfile(db, user.id, { name: 'Teacher M' });
    await updateProfile(db, user.id, { name: null });
    expect(await getProfile(db, user.id)).toMatchObject({ name: 'Minghui Zhang', name_custom: false });
    const fresh = (await db.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<User>())!;
    await touchExistingUser(db, fresh, google({ name: 'Minghui Zhang-Li' }), false);
    expect((await getProfile(db, user.id))!.name).toBe('Minghui Zhang-Li');
  });

  it('only the fields sent change', async () => {
    await updateProfile(db, user.id, { bio: 'Likes tea', about: 'Hi', time_zone: 'Europe/London' });
    await updateProfile(db, user.id, { about: null });
    expect(await getProfile(db, user.id)).toMatchObject({ bio: 'Likes tea', about: null, time_zone: 'Europe/London', name: 'Minghui Zhang' });
  });

  it('uploading replaces the previous upload in R2 and serves it from the public audio route', async () => {
    const { bucket, objects, deleted } = fakeBucket();
    const first = (await setUploadedPicture(db, bucket, user.id, JPEG, ORIGIN))!;
    const firstKey = [...objects.keys()][0];
    expect(firstKey).toMatch(new RegExp(`^avatars/${user.id}/[\\w-]+\\.jpg$`));
    expect(first.picture_url).toBe(`${ORIGIN}/api/audio/${firstKey}`);
    expect(objects.get(firstKey)!.type).toBe('image/jpeg');

    const second = (await setUploadedPicture(db, bucket, user.id, PNG, ORIGIN))!;
    expect(second.picture_url).toMatch(/\.png$/);
    expect(deleted).toEqual([firstKey]);
    expect(objects.size).toBe(1);

    await clearPicture(db, bucket, user.id, 'google');
    expect(objects.size).toBe(0);
  });

  it('the other side of a relationship sees the edited name, picture, about and time zone', async () => {
    const student = await createUser(db, google({ id: 'g-2', email: 'jerome@example.com', name: 'Jerome' }), false);
    db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel-1', ?, ?, 'student', 'active')", [student.id, user.id]);
    const { bucket } = fakeBucket();
    await updateProfile(db, user.id, { name: '明慧老师', about: 'HSK 1–4', time_zone: 'Asia/Shanghai', voice_gender: 'female' });
    const withPic = (await setUploadedPicture(db, bucket, user.id, WEBP, ORIGIN))!;
    const rel = (await getRelationshipById(db, 'rel-1'))!;
    expect(rel.recipient).toMatchObject({ name: '明慧老师', picture_url: withPic.picture_url, about: 'HSK 1–4', time_zone: 'Asia/Shanghai', voice_gender: 'female' });
    expect(rel.requester.voice_gender).toBeNull();
  });

  it('voice_gender is saved, read back and cleared', async () => {
    expect((await getProfile(db, user.id))!.voice_gender).toBeNull();
    expect((await updateProfile(db, user.id, { voice_gender: 'male' }))!.voice_gender).toBe('male');
    expect((await updateProfile(db, user.id, { bio: 'x' }))!.voice_gender).toBe('male');
    expect((await updateProfile(db, user.id, { voice_gender: null }))!.voice_gender).toBeNull();
  });
});

describe('picture checks', () => {
  it('sniffs the real type from the bytes', () => {
    expect(sniffImage(JPEG)?.mime).toBe('image/jpeg');
    expect(sniffImage(PNG)?.mime).toBe('image/png');
    expect(sniffImage(WEBP)?.mime).toBe('image/webp');
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull(); // GIF
  });

  it('rejects empty, oversized and non-image uploads', () => {
    expect(pictureProblems(null)).toEqual(['No picture was sent']);
    expect(pictureProblems(new Uint8Array(0))).toEqual(['No picture was sent']);
    expect(pictureProblems(new Uint8Array(2 * 1024 * 1024 + 1))[0]).toMatch(/at most 2 MB/);
    expect(pictureProblems(new TextEncoder().encode('hello'))[0]).toMatch(/JPEG, PNG or WebP/);
    expect(pictureProblems(JPEG)).toEqual([]);
  });

  it('builds the avatar url on the API origin', () => {
    expect(avatarUrl('https://api.example.dev/', 'avatars/u/x.jpg')).toBe('https://api.example.dev/api/audio/avatars/u/x.jpg');
  });
});
