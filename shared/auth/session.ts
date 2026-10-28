/**
 * Signed-out state + account switching, the rules every app shares (CLAUDE.md "Sign-in & sessions").
 *
 * Sessions slide (worker services/auth.ts): one used at least once a month never expires. When
 * one is gone anyway (revoked, "Sign out of all devices", a month unused), every request to our
 * API answers 401 — and the apps must SAY so instead of failing quietly (Oct 2026: the Lab app
 * kept studying offline for days while sync, analytics, feedback and transcription all got 401).
 * A 401 from our API puts the app in the signed-out state: a banner with Sign in on every
 * screen; local data, outboxes and the audio cache stay, and upload after the same account signs
 * in again.
 *
 * Signing in again must never wipe data (Oct 2026: Settings → Sign out + sign in wiped a day of
 * unsynced reviews and ~12,400 cached clips). Only a DIFFERENT account replaces the local data,
 * and never while something hasn't uploaded without asking first.
 *
 * Pure — the Lab app's port is android-lab/core/…/auth/SessionRules.kt (parity-tested,
 * parity/fixtures/session.ts).
 */

/** The banner on every screen while signed out. */
export function signedOutBanner(platform: 'web' | 'lab'): string {
  return `You're signed out — sign in again to sync, transcribe and use Claude. Your reviews are saved on this ${platform === 'lab' ? 'phone' : 'device'}.`;
}

/** What a transcription row says when the take couldn't be transcribed because the session is gone. */
export const SIGNED_OUT_TRANSCRIPTION = 'Signed out — sign in again';
/** The small line under it. */
export const SIGNED_OUT_TRANSCRIPTION_NOTE = 'Your recording is saved';

export type SignedOutWhere = 'sync' | 'transcribe' | 'ai' | 'analytics' | 'feedback' | 'chat' | 'media' | 'profile' | 'other';

/** Which kind of request found the 401 (analytics `auth.signed_out_detected { where }`). `path` is the URL path, query ignored. */
export function signedOutWhere(path: string): SignedOutWhere {
  const p = (path.split('?')[0] ?? '').replace(/^https?:\/\/[^/]+/, '');
  if (/^\/api\/transcribe(\/|$)/.test(p)) return 'transcribe';
  if (/^\/api\/(me\/usage-events|analytics\/)/.test(p)) return 'analytics';
  if (/^\/api\/feedback(\/|$)/.test(p)) return 'feedback';
  if (/^\/api\/(sync|reviews|decks|notes\/[^/]+$|sentences|custom-lessons|readers|me\/(homework|bumps|up-next|card-holds|card-forgets|study-time))(\/|$)/.test(p)) return 'sync';
  if (/^\/api\/(auth\/me|profile)(\/|$)/.test(p)) return 'profile';
  if (/^\/api\/(audio|chat-media|media)(\/|$)/.test(p)) return 'media';
  if (/^\/api\/(conversations|messages|me\/chats?|me\/chat-inbox|live)(\/|$)/.test(p)) return 'chat';
  if (/^\/api\/(ai|coach|sentence|sentences\/explain|lessons\/(answer-check|sentence-feedback)|notes\/[^/]+\/ask|note-questions|reader-words|practice)(\/|$)/.test(p)) return 'ai';
  return 'other';
}

/**
 * Requests whose 401 must NOT put the app in the signed-out state: signing out itself (the
 * session is being revoked) and the sign-in code exchange (no session yet).
 */
export function countsForSignedOut(path: string): boolean {
  const p = (path.split('?')[0] ?? '').replace(/^https?:\/\/[^/]+/, '');
  return !/^\/api\/auth\/(logout|logout-all|exchange|login|callback)(\/|$)/.test(p);
}

/**
 * A 2xx from this path proves the session works again (the banner goes). Only routes that always
 * need a session: a public one (a generated clip, an invite page) answers 200 to a dead token too.
 */
export function provesSignedIn(path: string): boolean {
  const where = signedOutWhere(path);
  return where === 'sync' || where === 'profile';
}

/** What hasn't reached the server yet on this device. */
export interface UnsyncedCounts {
  /** Review events (+ reader / lesson completions) not uploaded. */
  reviews: number;
  /** Recordings waiting to upload (pronunciation takes, lesson answers, call audio). */
  recordings: number;
  /** Anything else queued (flags, homework answers, queued edits, feedback…). */
  other: number;
}

export function unsyncedTotal(c: UnsyncedCounts): number {
  return Math.max(0, c.reviews) + Math.max(0, c.recordings) + Math.max(0, c.other);
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/** "3 reviews and 2 recordings haven't uploaded yet" ("1 review hasn't…"; other changes only when there are some). */
export function unsyncedSummary(c: UnsyncedCounts): string {
  const parts: string[] = [];
  if (c.reviews > 0) parts.push(plural(c.reviews, 'review', 'reviews'));
  if (c.recordings > 0) parts.push(plural(c.recordings, 'recording', 'recordings'));
  if (c.other > 0) parts.push(plural(c.other, 'other change', 'other changes'));
  if (parts.length === 0) return 'Everything has uploaded';
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const single = unsyncedTotal(c) === 1;
  return `${list} ${single ? "hasn't" : "haven't"} uploaded yet`;
}

/** Settings → Sign out with something unsynced: the question before signing out. */
export function signOutWarning(c: UnsyncedCounts): string {
  return `${unsyncedSummary(c)}. Sync first, or sign out anyway — they stay on this device and upload when you sign back in to the same account.`;
}

/** A different account signing in while the previous one's data hasn't uploaded. */
export function switchAccountWarning(c: UnsyncedCounts, previousEmail: string | null | undefined): string {
  const who = previousEmail?.trim() ? previousEmail.trim() : 'the previous account';
  return `${unsyncedSummary(c)} — sign back in as ${who} to upload them first, or discard them.`;
}

export interface AccountRef {
  id?: string | null;
  email?: string | null;
}

/**
 * Who just signed in, against whose data this device holds:
 *  - `first`  — no previous account known: keep whatever is there (it is this person's, or nothing);
 *  - `same`   — the same account (by id, else by e-mail for devices that never stored the id): resume, nothing cleared;
 *  - `switch` — a different account and everything uploaded: clear the previous account's data, then sign in;
 *  - `switch_blocked` — a different account with data not uploaded: ask first (sign back in / discard).
 */
export type AccountSwitch = 'first' | 'same' | 'switch' | 'switch_blocked';

export function accountSwitchFor(previous: AccountRef | null | undefined, next: AccountRef, unsynced: UnsyncedCounts): AccountSwitch {
  const prevId = previous?.id?.trim() || null;
  const prevEmail = previous?.email?.trim().toLowerCase() || null;
  if (!prevId && !prevEmail) return 'first';
  const nextId = next.id?.trim() || null;
  const nextEmail = next.email?.trim().toLowerCase() || null;
  const same = prevId && nextId ? prevId === nextId : !!prevEmail && !!nextEmail && prevEmail === nextEmail;
  if (same) return 'same';
  return unsyncedTotal(unsynced) > 0 ? 'switch_blocked' : 'switch';
}
