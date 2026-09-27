/**
 * The Profile screen's form state: what the text fields hold, and the minimal
 * update (only changed fields) that PUT /api/profile needs.
 */
import { normalizeName, normalizeText, type Profile, type ProfileUpdate } from '@shared/profile';

export interface ProfileDraft {
  name: string;
  about: string;
  time_zone: string;
  bio: string;
}

export function draftFrom(p: Profile): ProfileDraft {
  return {
    name: p.name ?? '',
    about: p.about ?? '',
    time_zone: p.time_zone ?? '',
    bio: p.bio ?? '',
  };
}

/** Only what changed. A name that is back to Google's (and wasn't custom) sends nothing. */
export function profileChanges(saved: Profile, draft: ProfileDraft): ProfileUpdate {
  const out: ProfileUpdate = {};
  const name = normalizeName(draft.name);
  if (name !== normalizeName(saved.name ?? '')) {
    out.name = !name ? '' : name; // empty → the server says why
  }
  const about = normalizeText(draft.about);
  if (about !== (saved.about ?? '')) out.about = about || null;
  const bio = normalizeText(draft.bio);
  if (bio !== (saved.bio ?? '')) out.bio = bio || null;
  const tz = draft.time_zone.trim();
  if (tz !== (saved.time_zone ?? '')) out.time_zone = tz || null;
  return out;
}

export function hasChanges(update: ProfileUpdate): boolean {
  return Object.keys(update).length > 0;
}

/** This device's IANA zone (null when the runtime doesn't say). */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Every zone the runtime knows (for the picker), with `extra` included even if unknown. */
export function timeZoneOptions(extra: Array<string | null | undefined> = []): string[] {
  let zones: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    zones = intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  if (!zones.length) {
    zones = ['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
      'Pacific/Auckland', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York', 'America/Chicago',
      'America/Denver', 'America/Los_Angeles', 'UTC'];
  }
  const set = new Set(zones);
  for (const z of extra) if (z) set.add(z);
  return [...set].sort();
}
