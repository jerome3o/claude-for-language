import { describe, it, expect } from 'vitest';
import { sendDefaults, sendHow, lessonWhere } from './sendHomework';

describe('Send homework sheet defaults', () => {
  it('opens on Both, due in two days when no lesson is coming up', () => {
    expect(sendDefaults('2026-09-28')).toEqual({ mode: 'both', dueDate: '2026-09-30', nextLesson: null });
    expect(sendDefaults('2026-09-28', [{ lesson_at: '2026-09-22T12:00:00.000Z' }])).toEqual({ mode: 'both', dueDate: '2026-09-30', nextLesson: null });
  });

  it('is due at the next logged lesson', () => {
    const d = sendDefaults('2026-09-28', [{ lesson_at: '2026-10-06' }, { lesson_at: '2026-10-01' }, { lesson_at: '2026-09-22' }]);
    expect(d).toEqual({ mode: 'both', dueDate: '2026-10-01', nextLesson: '2026-10-01' });
  });
});

describe('Send homework sentences', () => {
  const both = { mode: 'both' as const, dueDate: '2026-09-30', splitDays: 1, priority: 'core' as const };

  it('says both halves for the default', () => {
    expect(sendHow('deck', both)).toBe('as one-off homework by Wed 30 Sep, then in long-term review (the top of their queue)');
    expect(sendHow('deck', { ...both, splitDays: 3, priority: 'non_urgent' })).toBe('as one-off homework over 3 days from Wed 30 Sep, then in long-term review (the bottom of their queue)');
    expect(sendHow('lesson', both)).toBe('as one-off homework by Wed 30 Sep, then in long-term review');
    expect(lessonWhere('both')).toBe(' in their homework list, then in their study sessions');
  });

  it('keeps the one-off and long-term wording', () => {
    expect(sendHow('deck', { ...both, mode: 'one_off' })).toBe('as one-off homework by Wed 30 Sep');
    expect(sendHow('deck', { ...both, mode: 'fsrs' })).toBe('at the top of their queue, so their new words come from it next');
    expect(sendHow('lesson', { ...both, mode: 'fsrs' })).toBe('in their long-term review');
  });
});
