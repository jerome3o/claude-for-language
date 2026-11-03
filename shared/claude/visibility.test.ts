import { describe, expect, it } from 'vitest';
import {
  askedClaudeTodayLabel,
  CLAUDE_TUTOR_VISIBILITIES,
  nextTutorVisible,
  parseTutorVisibility,
  pickTutorVisibility,
  sharedLine,
  shareMenuLabel,
  tutorCanSee,
  tutorEmptyText,
  tutorReadOnlyLine,
  visibleByDefault,
} from './visibility';
import { CLAUDE_CONTEXT_KINDS } from './context';

describe('tutor visibility of Claude chats', () => {
  it('parses the account setting: NULL / unknown = card questions only', () => {
    expect(parseTutorVisibility(null)).toBe('card_only');
    expect(parseTutorVisibility(undefined)).toBe('card_only');
    expect(parseTutorVisibility('cards')).toBe('card_only');
    expect(parseTutorVisibility('all')).toBe('all');
    expect(parseTutorVisibility('none')).toBe('none');
    expect(pickTutorVisibility(null)).toBeNull();
    expect(pickTutorVisibility('none')).toBe('none');
    expect(pickTutorVisibility('everything')).toBeUndefined();
    expect(pickTutorVisibility(true)).toBeUndefined();
  });

  it('by default the tutor sees card questions only; practice and plain chats stay private', () => {
    for (const kind of CLAUDE_CONTEXT_KINDS) {
      expect(tutorCanSee({ context_kind: kind, tutor_visible: null }, 'card_only')).toBe(kind === 'card');
      expect(tutorCanSee({ context_kind: kind, tutor_visible: null }, 'all')).toBe(true);
      expect(tutorCanSee({ context_kind: kind, tutor_visible: null }, 'none')).toBe(false);
    }
    // An older Coach chat (no kind) is a plain chat.
    expect(tutorCanSee({ context_kind: null, tutor_visible: null }, 'card_only')).toBe(false);
    expect(visibleByDefault(null, 'all')).toBe(true);
  });

  it('a chat’s own choice wins over the account', () => {
    for (const setting of CLAUDE_TUTOR_VISIBILITIES) {
      expect(tutorCanSee({ context_kind: 'practice', tutor_visible: true }, setting)).toBe(true);
      expect(tutorCanSee({ context_kind: 'card', tutor_visible: false }, setting)).toBe(false);
    }
  });

  it('the ⋯ toggle flips what the tutor sees; back to the account’s default stores null', () => {
    expect(nextTutorVisible({ context_kind: 'practice', tutor_visible: null }, 'card_only')).toBe(true);
    expect(nextTutorVisible({ context_kind: 'practice', tutor_visible: true }, 'card_only')).toBeNull();
    expect(nextTutorVisible({ context_kind: 'card', tutor_visible: null }, 'card_only')).toBe(false);
    expect(nextTutorVisible({ context_kind: 'card', tutor_visible: false }, 'card_only')).toBeNull();
    expect(nextTutorVisible({ context_kind: 'card', tutor_visible: null }, 'none')).toBe(true);
    expect(nextTutorVisible({ context_kind: 'general', tutor_visible: null }, 'all')).toBe(false);
    for (const setting of CLAUDE_TUTOR_VISIBILITIES) {
      for (const kind of CLAUDE_CONTEXT_KINDS) {
        for (const v of [null, true, false]) {
          const t = { context_kind: kind, tutor_visible: v };
          expect(tutorCanSee({ context_kind: kind, tutor_visible: nextTutorVisible(t, setting) }, setting)).toBe(!tutorCanSee(t, setting));
        }
      }
    }
  });

  it('words', () => {
    expect(shareMenuLabel({ context_kind: 'practice', tutor_visible: null }, 'card_only')).toBe('👁 Share with my tutor');
    expect(shareMenuLabel({ context_kind: 'card', tutor_visible: null }, 'card_only')).toBe('🙈 Hide from my tutor');
    expect(sharedLine({ context_kind: 'card', tutor_visible: null }, 'card_only', 'Minghui')).toBe('👁 Minghui can read this chat');
    expect(sharedLine({ context_kind: 'card', tutor_visible: null }, 'card_only', ' ')).toBe('👁 Your tutor can read this chat');
    expect(sharedLine({ context_kind: 'general', tutor_visible: null }, 'card_only', 'Minghui')).toBe('');
    expect(askedClaudeTodayLabel(0)).toBe('');
    expect(askedClaudeTodayLabel(3)).toBe('✦ Asked Claude 3× today');
    expect(tutorEmptyText('Jerome', 'card_only')).toBe('Jerome has not asked Claude about a card yet. Other chats with Claude are private unless they share them.');
    expect(tutorEmptyText(null, 'all')).toBe('The student has not chatted with Claude yet.');
    expect(tutorEmptyText('Jerome', 'none')).toContain('keeps their chats with Claude private');
    expect(tutorReadOnlyLine('Jerome')).toBe('Read only · Jerome’s chat with Claude — only Jerome can write in it.');
  });
});
