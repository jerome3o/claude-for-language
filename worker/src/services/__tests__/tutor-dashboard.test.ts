import { describe, it, expect } from 'vitest';
import {
  dayKey,
  computeStreak,
  computeStudyStatus,
  recentActivityDays,
  homeworkPercent,
  summarizeHomework,
  pickNeedsAttention,
  deriveSetup,
  buildStudentOverview,
  parseTzOffset,
  type ActivityRow,
  type HomeworkDeckInput,
  type HomeworkLessonInput,
  type StudentUserRow,
} from '../tutor-dashboard';
import { rankStruggling, listRecordings, type InsightReviewRow } from '../insights';

const NOW = new Date('2026-09-18T10:00:00Z');

let seq = 0;
function row(overrides: Partial<InsightReviewRow> = {}): InsightReviewRow {
  seq++;
  const noteId = overrides.note_id ?? 'note-1';
  const cardType = overrides.card_type ?? 'meaning_to_hanzi';
  return {
    event_id: `ev-${seq}`,
    card_id: `${noteId}-${cardType}`,
    card_type: cardType,
    note_id: noteId,
    hanzi: '刮风',
    pinyin: 'guā fēng',
    english: 'windy',
    deck_id: 'deck-1',
    deck_name: '第三周作业',
    rating: 2,
    time_spent_ms: 4000,
    user_answer: null,
    recording_url: null,
    reviewed_at: '2026-09-18T08:00:00Z',
    ...overrides,
  };
}

function activity(reviewed_at: string, rating = 2, time_spent_ms = 3000): ActivityRow {
  return { reviewed_at, rating, time_spent_ms };
}

function student(overrides: Partial<StudentUserRow> = {}): StudentUserRow {
  return {
    id: 'student-1',
    email: 'li.hua@example.com',
    name: 'Li Hua',
    picture_url: null,
    last_login_at: '2026-09-18T09:41:00Z',
    install_kind: null,
    cached_audio_count: null,
    last_opened_at: null,
    created_at: '2026-09-18T09:41:00Z',
    ...overrides,
  };
}

function deck(overrides: Partial<HomeworkDeckInput> = {}): HomeworkDeckInput {
  return {
    shared_deck_id: 'sd-1',
    source_deck_id: 'deck-1',
    target_deck_id: 'deck-1-copy',
    source_deck_name: '第三周作业：天气',
    target_deck_name: '第三周作业：天气 (from tutor)',
    shared_at: '2026-09-15T00:00:00Z',
    notes_total: 6,
    notes_introduced: 0,
    cards_total: 18,
    cards_started: 7,
    cards_mastered: 0,
    notes_missing: 0,
    ...overrides,
  };
}

function lesson(overrides: Partial<HomeworkLessonInput> = {}): HomeworkLessonInput {
  return {
    lesson_id: 'lesson-1',
    title: '把 sentences',
    icon: '🎓',
    created_at: '2026-09-15T00:00:00Z',
    completions: 0,
    last_completed_at: null,
    last_rating: null,
    ...overrides,
  };
}

describe('dayKey', () => {
  it('buckets an instant into the client zone', () => {
    // 23:30 UTC on the 17th is already the 18th in UTC+8 (offset -480)
    expect(dayKey('2026-09-17T23:30:00Z', -480)).toBe('2026-09-18');
    expect(dayKey('2026-09-17T23:30:00Z', 0)).toBe('2026-09-17');
    // 02:00 UTC on the 18th is still the 17th in UTC-7 (offset 420)
    expect(dayKey('2026-09-18T02:00:00Z', 420)).toBe('2026-09-17');
  });
});

describe('computeStreak', () => {
  it('counts consecutive days ending today', () => {
    expect(computeStreak(['2026-09-18', '2026-09-17', '2026-09-16'], '2026-09-18')).toBe(3);
  });

  it('does not break the streak on a day that is not over yet', () => {
    expect(computeStreak(['2026-09-17', '2026-09-16'], '2026-09-18')).toBe(2);
  });

  it('is zero after a gap of two days', () => {
    expect(computeStreak(['2026-09-15', '2026-09-14'], '2026-09-18')).toBe(0);
  });

  it('stops at the first missing day', () => {
    expect(computeStreak(['2026-09-18', '2026-09-16', '2026-09-15'], '2026-09-18')).toBe(1);
  });
});

describe('computeStudyStatus', () => {
  it('reports studied today, streak, accuracy and time', () => {
    const rows = [
      activity('2026-09-18T08:00:00Z', 2, 5000),
      activity('2026-09-18T08:01:00Z', 0, 7000),
      activity('2026-09-18T08:02:00Z', 3, 3000),
      activity('2026-09-18T08:03:00Z', 2, 5000),
      activity('2026-09-17T08:00:00Z', 2),
      activity('2026-09-16T08:00:00Z', 1),
    ];
    const s = computeStudyStatus(rows, 0, NOW);
    expect(s.studied_today).toBe(true);
    expect(s.last_studied_at).toBe('2026-09-18T08:03:00Z');
    expect(s.streak_days).toBe(3);
    expect(s.active_days_30).toBe(3);
    expect(s.today).toEqual({ reviews: 4, accuracy: 0.75, time_ms: 20000 });
  });

  it('handles a student with no activity', () => {
    const s = computeStudyStatus([], 0, NOW);
    expect(s).toEqual({
      last_studied_at: null,
      studied_today: false,
      streak_days: 0,
      active_days_30: 0,
      today: { reviews: 0, accuracy: null, time_ms: 0 },
    });
  });

  it('uses the client zone for "today"', () => {
    // 23:30 UTC yesterday is "today" for a student in UTC+8
    const rows = [activity('2026-09-17T23:30:00Z')];
    expect(computeStudyStatus(rows, -480, new Date('2026-09-18T01:00:00Z')).studied_today).toBe(true);
    expect(computeStudyStatus(rows, 0, new Date('2026-09-18T01:00:00Z')).studied_today).toBe(false);
  });
});

describe('recentActivityDays', () => {
  it('returns the newest two days with per-day accuracy', () => {
    const rows = [
      activity('2026-09-16T08:00:00Z', 2),
      activity('2026-09-18T08:00:00Z', 2, 1000),
      activity('2026-09-18T08:05:00Z', 0, 2000),
      activity('2026-09-15T08:00:00Z', 2),
    ];
    const days = recentActivityDays(rows, 0);
    expect(days.map((d) => d.day)).toEqual(['2026-09-18', '2026-09-16']);
    expect(days[0]).toEqual({ day: '2026-09-18', reviews: 2, accuracy: 0.5, time_ms: 3000 });
  });
});

describe('homework', () => {
  it('is null when nothing has been assigned', () => {
    expect(homeworkPercent({ cards_total: 0, cards_started: 0, cards_mastered: 0, lessons_total: 0, lessons_completed: 0 })).toBeNull();
    expect(summarizeHomework([], []).percent).toBeNull();
  });

  it('gives started cards half credit and mastered cards full credit', () => {
    // 18 cards: 7 started (0 mastered) → 3.5 / 18 = 19%
    expect(homeworkPercent({ cards_total: 18, cards_started: 7, cards_mastered: 0, lessons_total: 0, lessons_completed: 0 })).toBe(19);
    // 18 cards all mastered → 100%
    expect(homeworkPercent({ cards_total: 18, cards_started: 18, cards_mastered: 18, lessons_total: 0, lessons_completed: 0 })).toBe(100);
  });

  it('counts a lesson as done once it has been completed', () => {
    const s = summarizeHomework([deck({ cards_total: 10, cards_started: 10, cards_mastered: 10 })], [
      lesson({ completions: 1 }),
      lesson({ lesson_id: 'lesson-2', completions: 0 }),
    ]);
    // 10 mastered cards + 1 lesson done out of 10 cards + 2 lessons = 11/12
    expect(s.percent).toBe(92);
    expect(s.lessons_total).toBe(2);
    expect(s.lessons_completed).toBe(1);
    expect(s.decks[0].percent_started).toBe(100);
    expect(s.decks[0].percent_mastered).toBe(100);
  });

  it('sums across several decks', () => {
    const s = summarizeHomework([deck(), deck({ shared_deck_id: 'sd-2', cards_total: 6, cards_started: 6, cards_mastered: 3 })], []);
    expect(s.cards_total).toBe(24);
    expect(s.cards_started).toBe(13);
    expect(s.cards_mastered).toBe(3);
    expect(s.decks[1].percent_started).toBe(100);
    expect(s.decks[1].percent_mastered).toBe(50);
  });

  it("places each packet in the student's deck queue", () => {
    const queue = [{ id: 'own-a' }, { id: 'deck-1-copy' }, { id: 'own-b' }, { id: 'deck-2-copy' }];
    const s = summarizeHomework(
      [deck(), deck({ shared_deck_id: 'sd-2', target_deck_id: 'deck-2-copy' }), deck({ shared_deck_id: 'sd-3', target_deck_id: 'gone', target_deck_name: null })],
      [],
      undefined,
      queue
    );
    expect(s.decks.map((d) => [d.queue_position, d.queue_total])).toEqual([[2, 4], [4, 4], [null, 4]]);
  });

  it('has no queue positions when the queue is not supplied', () => {
    const s = summarizeHomework([deck()], []);
    expect(s.decks[0].queue_position).toBeNull();
    expect(s.decks[0].queue_total).toBe(0);
  });
});

describe('pickNeedsAttention', () => {
  it('keeps the top struggling words with their wrong answers and the newest unheard recording', () => {
    const rows = [
      row({ note_id: 'n1', hanzi: '刮风', rating: 0, user_answer: '括风', reviewed_at: '2026-09-18T08:00:00Z' }),
      row({ note_id: 'n1', hanzi: '刮风', rating: 0, reviewed_at: '2026-09-18T07:00:00Z' }),
      row({ note_id: 'n1', hanzi: '刮风', card_type: 'hanzi_to_meaning', rating: 2, recording_url: '/rec/old.webm', reviewed_at: '2026-09-17T08:00:00Z' }),
      row({ note_id: 'n1', hanzi: '刮风', card_type: 'hanzi_to_meaning', rating: 2, recording_url: '/rec/new.webm', reviewed_at: '2026-09-18T08:30:00Z' }),
      row({ note_id: 'n2', hanzi: '晴天', rating: 0, user_answer: '清天', card_type: 'audio_to_hanzi' }),
      row({ note_id: 'n3', hanzi: '下雨', rating: 1 }),
      row({ note_id: 'n4', hanzi: '你好', rating: 2 }),
    ];
    const marks = [{ review_event_id: rows[2].event_id, status: 'listened' as const, comment: null, updated_at: '2026-09-17T09:00:00Z' }];
    const items = pickNeedsAttention(rankStruggling(rows), listRecordings(rows, marks));
    expect(items.map((i) => i.note.hanzi)).toEqual(['刮风', '晴天', '下雨']);
    expect(items[0].again_count).toBe(2);
    expect(items[0].wrong_answers).toEqual(['括风']);
    expect(items[0].recording).toEqual({ event_id: rows[3].event_id, recording_url: '/rec/new.webm' });
    expect(items[0].recordings_unheard).toBe(1);
    expect(items[1].wrong_answers).toEqual(['清天']);
    expect(items[2].recording).toBeNull();
  });

  it('adds words with an unheard recording when there is room', () => {
    const rows = [
      row({ note_id: 'n1', hanzi: '刮风', rating: 0 }),
      row({ note_id: 'n5', hanzi: '雪', rating: 2, card_type: 'hanzi_to_meaning', recording_url: '/rec/snow.webm' }),
    ];
    const items = pickNeedsAttention(rankStruggling(rows), listRecordings(rows, []));
    expect(items.map((i) => i.note.hanzi)).toEqual(['刮风', '雪']);
    expect(items[1].recording?.recording_url).toBe('/rec/snow.webm');
  });

  it('never exceeds the limit', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((n) => row({ note_id: n, hanzi: n, rating: 0 }));
    expect(pickNeedsAttention(rankStruggling(rows), [], 3)).toHaveLength(3);
  });
});

describe('deriveSetup', () => {
  const homework = summarizeHomework([deck()], []);

  it('ticks signed-in and homework for a fresh invitee', () => {
    const s = deriveSetup({
      student: student(),
      homework,
      first_review_at: null,
      audio_total: 18,
      invite: { id: 'inv', url: 'https://app/join/inv', status: 'used', redeemed_at: '2026-09-18T09:41:00Z' },
    });
    expect(s.steps.map((st) => [st.key, st.done])).toEqual([
      ['signed_in', true],
      ['homework', true],
      ['installed', false],
      ['first_session', false],
    ]);
    expect(s.done_count).toBe(2);
    expect(s.steps[1].detail).toContain('第三周作业：天气');
    expect(s.steps[1].detail).toContain('copied automatically from your invite');
    expect(s.steps[2].detail).toBe('Not opened on a phone yet');
    expect(s.audio).toEqual({ cached: null, total: 18 });
  });

  it('counts the Android app and a home-screen shortcut as installed, a browser tab not', () => {
    const base = { homework, first_review_at: null, audio_total: 0, invite: null };
    expect(deriveSetup({ ...base, student: student({ install_kind: 'android' }) }).steps[2]).toMatchObject({ done: true, detail: 'Using the Android app' });
    expect(deriveSetup({ ...base, student: student({ install_kind: 'pwa' }) }).steps[2]).toMatchObject({ done: true, detail: 'Opens from the home screen' });
    expect(deriveSetup({ ...base, student: student({ install_kind: 'browser' }) }).steps[2]).toMatchObject({ done: false, detail: 'Last opened in a browser tab' });
  });

  it('completes all four once the first session happened', () => {
    const s = deriveSetup({
      student: student({ install_kind: 'pwa', cached_audio_count: 18, last_opened_at: '2026-09-18T09:50:00Z' }),
      homework,
      first_review_at: '2026-09-18T09:55:00Z',
      audio_total: 18,
      invite: null,
    });
    expect(s.done_count).toBe(4);
    expect(s.audio).toEqual({ cached: 18, total: 18 });
    expect(s.last_opened_at).toBe('2026-09-18T09:50:00Z');
  });

  it('flags a student with nothing shared', () => {
    const s = deriveSetup({ student: student({ last_login_at: null }), homework: summarizeHomework([], []), first_review_at: null, audio_total: 0, invite: null });
    expect(s.done_count).toBe(0);
    expect(s.steps[1].detail).toContain('Nothing shared yet');
  });
});

describe('buildStudentOverview', () => {
  const base = {
    relationship_id: 'rel-1',
    student: student(),
    joined_at: '2026-09-15T00:00:00Z',
    activity_rows: [] as ActivityRow[],
    week_rows: [] as InsightReviewRow[],
    week_marks: [],
    unheard_recordings: 0,
    first_review_at: null as string | null,
    total_reviews: 0,
    homework_decks: [deck()],
    homework_lessons: [] as HomeworkLessonInput[],
    audio_total: 18,
    invite: null,
    last_conversation_id: null as string | null,
    tz_offset_minutes: 0,
    now: NOW,
  };

  it('marks a student with no reviews as new and carries the setup checklist', () => {
    const o = buildStudentOverview(base);
    expect(o.is_new).toBe(true);
    expect(o.joined_via_invite).toBe(false);
    expect(o.setup.done_count).toBe(2);
    expect(o.pills).toEqual({ struggling_words: 0, recordings_to_hear: 0, homework_percent: 19, flags_open: 0 });
    expect(o.needs_attention).toEqual([]);
    expect(o.activity).toEqual([]);
    expect(o.student).toEqual({ id: 'student-1', email: 'li.hua@example.com', name: 'Li Hua', picture_url: null });
  });

  it('builds the pills and status line for an active student', () => {
    const weekRows = [
      row({ note_id: 'n1', hanzi: '刮风', rating: 0, user_answer: '括风', reviewed_at: '2026-09-18T08:00:00Z' }),
      row({ note_id: 'n2', hanzi: '晴天', rating: 0, user_answer: '清天', reviewed_at: '2026-09-18T08:01:00Z' }),
      row({ note_id: 'n3', hanzi: '你好', rating: 3, reviewed_at: '2026-09-18T08:02:00Z' }),
    ];
    const o = buildStudentOverview({
      ...base,
      total_reviews: 31,
      first_review_at: '2026-09-10T08:00:00Z',
      activity_rows: [
        activity('2026-09-18T08:00:00Z', 0),
        activity('2026-09-18T08:01:00Z', 0),
        activity('2026-09-18T08:02:00Z', 3),
        activity('2026-09-18T08:03:00Z', 2),
        activity('2026-09-17T08:00:00Z', 2),
        activity('2026-09-16T08:00:00Z', 2),
      ],
      week_rows: weekRows,
      unheard_recordings: 2,
      last_conversation_id: 'conv-9',
      invite: { id: 'inv', url: 'https://app/join/inv', status: 'used', redeemed_at: '2026-09-15T00:00:00Z' },
    });
    expect(o.is_new).toBe(false);
    expect(o.joined_via_invite).toBe(true);
    expect(o.status.streak_days).toBe(3);
    expect(o.status.today.accuracy).toBe(0.5);
    expect(o.pills).toEqual({ struggling_words: 2, recordings_to_hear: 2, homework_percent: 19, flags_open: 0 });
    expect(o.needs_attention.map((i) => i.note.hanzi).sort()).toEqual(['刮风', '晴天']);
    expect(o.activity.map((d) => d.day)).toEqual(['2026-09-18', '2026-09-17']);
    expect(o.last_conversation_id).toBe('conv-9');
  });
});

describe('parseTzOffset', () => {
  it('defaults to UTC and clamps nonsense', () => {
    expect(parseTzOffset(undefined)).toBe(0);
    expect(parseTzOffset('abc')).toBe(0);
    expect(parseTzOffset('-480')).toBe(-480);
    expect(parseTzOffset('99999')).toBe(840);
  });
});
