import { describe, expect, it } from 'vitest';
import {
  audioLessonListened,
  companionBadge,
  companionLessonTitle,
  earlierUnlock,
  lessonLockStatus,
  lessonsUnlockedByListen,
  lessonUnlockColumns,
  lessonUnlockFromRow,
  lockedLessonLine,
  lockSets,
  pickLessonUnlock,
  unlockButtonLabel,
  UNLOCK_PROMPT_MAX,
} from './unlock';

describe('pickLessonUnlock', () => {
  it('none', () => {
    expect(pickLessonUnlock(undefined)).toEqual({ unlock: null, problems: [] });
    expect(pickLessonUnlock(null)).toEqual({ unlock: null, problems: [] });
  });
  it('an audio lesson', () => {
    expect(pickLessonUnlock({ kind: 'audio_lesson', audio_lesson_id: ' al1 ' }).unlock).toEqual({ kind: 'audio_lesson', audio_lesson_id: 'al1' });
    expect(pickLessonUnlock({ kind: 'audio_lesson' }).problems).toHaveLength(1);
  });
  it('a manual prompt, whitespace folded', () => {
    expect(pickLessonUnlock({ kind: 'manual', prompt: '  Go to a restaurant\n and order 打包 ' }).unlock).toEqual({ kind: 'manual', prompt: 'Go to a restaurant and order 打包' });
    expect(pickLessonUnlock({ kind: 'manual', prompt: '' }).problems).toHaveLength(1);
    expect(pickLessonUnlock({ kind: 'manual', prompt: 'x'.repeat(UNLOCK_PROMPT_MAX + 1) }).problems).toHaveLength(1);
  });
  it('garbage', () => {
    expect(pickLessonUnlock('audio').problems).toHaveLength(1);
    expect(pickLessonUnlock({ kind: 'later' }).problems).toHaveLength(1);
    expect(pickLessonUnlock([]).problems).toHaveLength(1);
  });
});

describe('columns round trip', () => {
  it('audio / manual / none', () => {
    for (const u of [{ kind: 'audio_lesson' as const, audio_lesson_id: 'a' }, { kind: 'manual' as const, prompt: 'Watch episode 3' }, null]) {
      expect(lessonUnlockFromRow(lessonUnlockColumns(u))).toEqual(u);
    }
    expect(lessonUnlockFromRow({ unlock_kind: 'audio_lesson', unlock_ref: null })).toBeNull();
  });
});

describe('lock status', () => {
  const u = { kind: 'manual' as const, prompt: 'p' };
  it('none / locked / unlocked', () => {
    expect(lessonLockStatus(null, null)).toBe('none');
    expect(lessonLockStatus(null, '2026-10-09T00:00:00Z')).toBe('none');
    expect(lessonLockStatus(u, null)).toBe('locked');
    expect(lessonLockStatus(u, '2026-10-09T00:00:00Z')).toBe('unlocked');
  });
  it('lockSets', () => {
    const sets = lockSets([
      { id: 'a', unlock: u, unlocked_at: null },
      { id: 'b', unlock: u, unlocked_at: '2026-10-09T00:00:00Z' },
      { id: 'c' },
    ]);
    expect([...sets.locked]).toEqual(['a']);
    expect([...sets.unlocked]).toEqual(['b']);
  });
  it('earliest unlock wins', () => {
    expect(earlierUnlock('2026-10-09T10:00:00.000Z', '2026-10-09T09:00:00.000Z')).toBe('2026-10-09T09:00:00.000Z');
    expect(earlierUnlock(null, '2026-10-09T09:00:00.000Z')).toBe('2026-10-09T09:00:00.000Z');
    expect(earlierUnlock('garbage', null)).toBeNull();
    expect(earlierUnlock('2026-10-09T10:00:00.000Z', 'garbage')).toBe('2026-10-09T10:00:00.000Z');
  });
});

describe('audioLessonListened', () => {
  const chapters = [0, 30_000, 300_000, 540_000];
  it('85 % of the length', () => {
    expect(audioLessonListened(849_000, 1_000_000)).toBe(false);
    expect(audioLessonListened(850_000, 1_000_000)).toBe(true);
  });
  it('or into the last chapter (Final listen)', () => {
    expect(audioLessonListened(539_999, 1_000_000, chapters)).toBe(false);
    expect(audioLessonListened(540_000, 1_000_000, chapters)).toBe(true);
  });
  it('one chapter only = the length rule', () => {
    expect(audioLessonListened(10, 1_000_000, [0])).toBe(false);
  });
  it('nothing known = not listened', () => {
    expect(audioLessonListened(0, 1_000_000, chapters)).toBe(false);
    expect(audioLessonListened(900_000, 0)).toBe(false);
    expect(audioLessonListened(NaN, 1_000)).toBe(false);
  });
});

describe('lessonsUnlockedByListen', () => {
  it('only the locked lessons waiting on that audio lesson', () => {
    const lessons = [
      { id: 'c1', unlock: { kind: 'audio_lesson' as const, audio_lesson_id: 'al1' }, unlocked_at: null },
      { id: 'c2', unlock: { kind: 'audio_lesson' as const, audio_lesson_id: 'al1' }, unlocked_at: '2026-10-01T00:00:00Z' },
      { id: 'c3', unlock: { kind: 'audio_lesson' as const, audio_lesson_id: 'al2' }, unlocked_at: null },
      { id: 'm', unlock: { kind: 'manual' as const, prompt: 'p' }, unlocked_at: null },
      { id: 'x' },
    ];
    expect(lessonsUnlockedByListen(lessons, 'al1')).toEqual(['c1']);
  });
});

describe('words', () => {
  it('companion title = the podcast title + — mini lesson', () => {
    expect(companionLessonTitle("去朋友家吃饭 · Dinner at a friend's parents' home")).toBe("去朋友家吃饭 · Dinner at a friend's parents' home — mini lesson");
    expect(companionLessonTitle('X — mini lesson')).toBe('X — mini lesson');
    expect(companionLessonTitle('  ')).toBe('Audio lesson — mini lesson');
  });
  it('buttons and lines', () => {
    expect(unlockButtonLabel({ kind: 'audio_lesson', audio_lesson_id: 'a' })).toBe("✓ I've listened — unlock");
    expect(unlockButtonLabel({ kind: 'manual', prompt: 'p' })).toBe('✓ Done — unlock');
    expect(lockedLessonLine({ kind: 'manual', prompt: 'Order 打包' })).toBe('🔒 Order 打包');
    expect(lockedLessonLine({ kind: 'audio_lesson', audio_lesson_id: 'a' }, '去朋友家吃饭')).toBe('🔒 Unlocks when you\'ve listened to “去朋友家吃饭”');
    expect(companionBadge('locked')).toBe('🔒 Mini lesson waiting');
    expect(companionBadge('unlocked')).toBe('✓ Mini lesson unlocked');
  });
});
