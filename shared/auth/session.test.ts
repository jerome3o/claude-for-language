import { describe, it, expect } from 'vitest';
import {
  accountSwitchFor,
  countsForSignedOut,
  provesSignedIn,
  signedOutBanner,
  signedOutWhere,
  signOutWarning,
  switchAccountWarning,
  unsyncedSummary,
  unsyncedTotal,
} from './session';

const none = { reviews: 0, recordings: 0, other: 0 };

describe('signed-out state', () => {
  it('banner copy per platform', () => {
    expect(signedOutBanner('lab')).toBe("You're signed out — sign in again to sync, transcribe and use Claude. Your reviews are saved on this phone.");
    expect(signedOutBanner('web')).toContain('saved on this device');
  });

  it('classifies where the 401 came from', () => {
    expect(signedOutWhere('/api/sync/changes?since=1')).toBe('sync');
    expect(signedOutWhere('/api/reviews')).toBe('sync');
    expect(signedOutWhere('https://x.workers.dev/api/transcribe/live')).toBe('transcribe');
    expect(signedOutWhere('/api/transcribe')).toBe('transcribe');
    expect(signedOutWhere('/api/me/usage-events')).toBe('analytics');
    expect(signedOutWhere('/api/feedback')).toBe('feedback');
    expect(signedOutWhere('/api/auth/me')).toBe('profile');
    expect(signedOutWhere('/api/notes/n1/ask')).toBe('ai');
    expect(signedOutWhere('/api/conversations/c1/messages')).toBe('chat');
    expect(signedOutWhere('/api/audio/recordings/x.webm')).toBe('media');
    expect(signedOutWhere('/api/quests')).toBe('other');
  });

  it('only routes that always need a session prove it works again', () => {
    expect(provesSignedIn('/api/sync/changes')).toBe(true);
    expect(provesSignedIn('/api/auth/me')).toBe(true);
    expect(provesSignedIn('/api/audio/generated/x.mp3')).toBe(false);
    expect(provesSignedIn('/api/invites/abc/public')).toBe(false);
  });

  it('signing out and the code exchange never count', () => {
    expect(countsForSignedOut('/api/auth/logout')).toBe(false);
    expect(countsForSignedOut('/api/auth/logout-all')).toBe(false);
    expect(countsForSignedOut('/api/auth/exchange')).toBe(false);
    expect(countsForSignedOut('/api/auth/me')).toBe(true);
    expect(countsForSignedOut('/api/sync/changes')).toBe(true);
  });
});

describe('unsynced data', () => {
  it('summaries', () => {
    expect(unsyncedSummary({ reviews: 3, recordings: 2, other: 0 })).toBe("3 reviews and 2 recordings haven't uploaded yet");
    expect(unsyncedSummary({ reviews: 1, recordings: 0, other: 0 })).toBe("1 review hasn't uploaded yet");
    expect(unsyncedSummary({ reviews: 1200, recordings: 1, other: 4 })).toBe("1,200 reviews, 1 recording and 4 other changes haven't uploaded yet");
    expect(unsyncedSummary(none)).toBe('Everything has uploaded');
    expect(unsyncedTotal({ reviews: 2, recordings: 1, other: 1 })).toBe(4);
  });

  it('warnings', () => {
    expect(switchAccountWarning({ reviews: 5, recordings: 1, other: 0 }, 'jerome@example.com')).toBe(
      "5 reviews and 1 recording haven't uploaded yet — sign back in as jerome@example.com to upload them first, or discard them.",
    );
    expect(switchAccountWarning({ reviews: 1, recordings: 0, other: 0 }, null)).toContain('sign back in as the previous account');
    expect(signOutWarning({ reviews: 2, recordings: 0, other: 0 })).toMatch(/^2 reviews haven't uploaded yet\. Sync first, or sign out anyway/);
  });
});

describe('accountSwitchFor', () => {
  it('no previous account → first (keep what is there)', () => {
    expect(accountSwitchFor(null, { id: 'u1' }, { reviews: 9, recordings: 0, other: 0 })).toBe('first');
    expect(accountSwitchFor({ id: null, email: ' ' }, { id: 'u1' }, none)).toBe('first');
  });
  it('same account by id, else by e-mail', () => {
    expect(accountSwitchFor({ id: 'u1', email: 'a@x' }, { id: 'u1', email: 'other@x' }, { reviews: 3, recordings: 0, other: 0 })).toBe('same');
    expect(accountSwitchFor({ email: 'Jerome@Example.com' }, { id: 'u1', email: 'jerome@example.com' }, none)).toBe('same');
  });
  it('a different account: clear when all uploaded, else ask', () => {
    expect(accountSwitchFor({ id: 'u1' }, { id: 'u2' }, none)).toBe('switch');
    expect(accountSwitchFor({ id: 'u1' }, { id: 'u2' }, { reviews: 0, recordings: 1, other: 0 })).toBe('switch_blocked');
    expect(accountSwitchFor({ email: 'a@x' }, { id: 'u2', email: 'b@x' }, { reviews: 0, recordings: 0, other: 2 })).toBe('switch_blocked');
  });
});
