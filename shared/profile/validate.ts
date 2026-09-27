/**
 * The editable profile: display name, bio (private — Claude's context for
 * example sentences), "About me" (public — the other side of a tutor
 * relationship and invite links show it) and time zone (the other side sees
 * your local time). Used by the worker (PUT /api/profile → 400 + problems)
 * and by the Profile screen for inline hints. The native Lab app relies on the
 * server's problems.
 */

export const PROFILE_LIMITS = {
  name: 60,
  bio: 500,
  about: 500,
  time_zone: 64,
} as const;

/** Largest picture upload the server accepts (the clients send ~512px JPEGs, far below). */
export const PROFILE_PICTURE_MAX_BYTES = 2 * 1024 * 1024;
/** Edge length the clients crop / resize an uploaded picture to. */
export const PROFILE_PICTURE_SIZE = 512;

export interface ProfileUpdate {
  /** null = go back to the Google name. */
  name?: string | null;
  bio?: string | null;
  about?: string | null;
  time_zone?: string | null;
}

export type PictureSource = 'google' | 'upload' | 'none';

/** What GET /api/profile returns (and PUT / picture routes answer with). */
export interface Profile {
  id: string;
  email: string | null;
  name: string | null;
  picture_url: string | null;
  picture_source: PictureSource;
  /** True when the display name was typed by the user (not Google's). */
  name_custom: boolean;
  google_name: string | null;
  google_picture_url: string | null;
  bio: string | null;
  about: string | null;
  time_zone: string | null;
}

// C0 / C1 control characters except tab and newline, plus zero-width / bidi overrides.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;

/** One line: controls and newlines gone, runs of whitespace collapsed. */
export function normalizeName(raw: string): string {
  return raw.replace(CONTROL, '').replace(/\s+/g, ' ').trim();
}

/** Multi-line text: controls gone, trailing spaces trimmed, at most one blank line in a row. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(CONTROL, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Length in characters as a person counts them (an emoji or 汉字 is one). */
export function charCount(s: string): number {
  return Array.from(s).length;
}

/** An IANA zone the runtime knows ("Asia/Shanghai", "UTC"). */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > PROFILE_LIMITS.time_zone) return false;
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const TEXT_FIELDS = [
  { key: 'bio', label: 'Bio' },
  { key: 'about', label: 'About me' },
] as const;

/**
 * Validate a profile update from an untrusted object. Only the keys present
 * are returned; a key the caller left out is left alone. Too-long text is a
 * problem, never silently cut.
 */
export function pickProfileUpdate(input: Record<string, unknown> | null | undefined): { update: ProfileUpdate; problems: string[] } {
  const update: ProfileUpdate = {};
  const problems: string[] = [];
  const src = input ?? {};

  if ('name' in src && src.name !== undefined) {
    const v = src.name;
    if (v === null) update.name = null;
    else if (typeof v !== 'string') problems.push('Name must be text');
    else {
      const name = normalizeName(v);
      if (!name) problems.push('Name can\'t be empty (use your Google name instead)');
      else if (charCount(name) > PROFILE_LIMITS.name) problems.push(`Name must be at most ${PROFILE_LIMITS.name} characters`);
      else update.name = name;
    }
  }

  for (const { key, label } of TEXT_FIELDS) {
    if (!(key in src) || src[key] === undefined) continue;
    const v = src[key];
    if (v === null) { update[key] = null; continue; }
    if (typeof v !== 'string') { problems.push(`${label} must be text`); continue; }
    const text = normalizeText(v);
    if (charCount(text) > PROFILE_LIMITS[key]) problems.push(`${label} must be at most ${PROFILE_LIMITS[key]} characters`);
    else update[key] = text || null;
  }

  if ('time_zone' in src && src.time_zone !== undefined) {
    const v = src.time_zone;
    if (v === null || v === '') update.time_zone = null;
    else if (typeof v !== 'string' || !isValidTimeZone(v.trim())) problems.push('Time zone must be an IANA zone such as Asia/Shanghai');
    else update.time_zone = v.trim();
  }

  return { update, problems };
}

/** "Asia/Shanghai" → "Shanghai", "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export function timeZoneCity(tz: string): string {
  const last = tz.split('/').pop() || tz;
  return last.replace(/_/g, ' ');
}

/** The wall-clock time in a zone, e.g. "9:04 pm" (null for an unknown zone). */
export function localTimeIn(tz: string, now: Date = new Date()): string | null {
  if (!isValidTimeZone(tz)) return null;
  const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(now);
  return s.replace(/\s?AM$/i, ' am').replace(/\s?PM$/i, ' pm');
}

/** "9:04 pm in Shanghai" — what the other side of a relationship sees (null when unset / unknown). */
export function localTimeLabel(tz: string | null | undefined, now: Date = new Date()): string | null {
  if (!tz) return null;
  const time = localTimeIn(tz, now);
  return time ? `${time} in ${timeZoneCity(tz)}` : null;
}
