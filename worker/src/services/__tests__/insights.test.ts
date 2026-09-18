import { describe, it, expect } from 'vitest';
import {
  computeTotals,
  rankStruggling,
  pickGoingWell,
  listRecordings,
  collectWrongAnswers,
  countForgotAfterCorrect,
  struggleScore,
  normalizeAnswer,
  resolveRange,
  computeInsights,
  type InsightReviewRow,
} from '../insights';

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
    hanzi: '你好',
    pinyin: 'nǐ hǎo',
    english: 'hello',
    deck_id: 'deck-1',
    deck_name: 'HSK 1',
    rating: 2,
    time_spent_ms: 4000,
    user_answer: null,
    recording_url: null,
    reviewed_at: `2026-09-${String(10 + (seq % 5)).padStart(2, '0')}T10:${String(seq % 60).padStart(2, '0')}:00.000Z`,
    ...overrides,
  };
}

describe('normalizeAnswer', () => {
  it('ignores whitespace and punctuation', () => {
    expect(normalizeAnswer('你好。')).toBe('你好');
    expect(normalizeAnswer(' 你 好 ！')).toBe('你好');
    expect(normalizeAnswer('nǐ hǎo')).toBe('nǐhǎo');
  });
});

describe('computeTotals', () => {
  it('counts reviews, cards, notes, days, accuracy and time', () => {
    const rows = [
      row({ note_id: 'a', rating: 2, reviewed_at: '2026-09-01T10:00:00Z', time_spent_ms: 1000 }),
      row({ note_id: 'a', rating: 0, reviewed_at: '2026-09-01T11:00:00Z', time_spent_ms: 2000, card_type: 'audio_to_hanzi' }),
      row({ note_id: 'b', rating: 3, reviewed_at: '2026-09-02T10:00:00Z', time_spent_ms: null }),
      row({ note_id: 'b', rating: 1, reviewed_at: '2026-09-03T10:00:00Z', time_spent_ms: 500 }),
    ];
    const t = computeTotals(rows, 7);
    expect(t.reviews).toBe(4);
    expect(t.unique_cards).toBe(3);
    expect(t.unique_notes).toBe(2);
    expect(t.days_active).toBe(3);
    expect(t.accuracy).toBe(0.75);
    expect(t.again_rate).toBe(0.25);
    expect(t.time_ms).toBe(3500);
    expect(t.new_words_introduced).toBe(7);
    expect(t.by_card_type.meaning_to_hanzi).toEqual({ attempts: 3, again_count: 0, accuracy: 1 });
    expect(t.by_card_type.audio_to_hanzi).toEqual({ attempts: 1, again_count: 1, accuracy: 0 });
  });

  it('handles an empty range', () => {
    const t = computeTotals([], 0);
    expect(t.reviews).toBe(0);
    expect(t.accuracy).toBe(0);
    expect(t.days_active).toBe(0);
  });
});

describe('collectWrongAnswers', () => {
  it('returns distinct wrong typed answers, newest first, capped at 5', () => {
    const rows = [
      row({ user_answer: '你好', reviewed_at: '2026-09-05T10:00:00Z' }), // correct
      row({ user_answer: '你好。', reviewed_at: '2026-09-05T10:01:00Z' }), // punctuation only → correct
      row({ user_answer: '尼好', reviewed_at: '2026-09-04T10:00:00Z' }),
      row({ user_answer: '你号', reviewed_at: '2026-09-06T10:00:00Z' }),
      row({ user_answer: '尼好', reviewed_at: '2026-09-03T10:00:00Z' }), // duplicate
      row({ user_answer: '', reviewed_at: '2026-09-02T10:00:00Z' }),
      row({ user_answer: null }),
    ];
    const { answers, count } = collectWrongAnswers(rows, '你好');
    expect(answers).toEqual(['你号', '尼好']);
    expect(count).toBe(3);
  });

  it('caps the list at max but counts everything', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((a, i) =>
      row({ user_answer: a, reviewed_at: `2026-09-0${i + 1}T10:00:00Z` })
    );
    const { answers, count } = collectWrongAnswers(rows, '你好');
    expect(answers).toHaveLength(5);
    expect(answers[0]).toBe('g');
    expect(count).toBe(7);
  });
});

describe('countForgotAfterCorrect', () => {
  it('counts an Again that follows a Good on the same card', () => {
    const rows = [
      row({ rating: 2, reviewed_at: '2026-09-01T10:00:00Z' }),
      row({ rating: 0, reviewed_at: '2026-09-02T10:00:00Z' }),
      row({ rating: 2, reviewed_at: '2026-09-03T10:00:00Z' }),
      row({ rating: 0, reviewed_at: '2026-09-04T10:00:00Z' }),
    ];
    expect(countForgotAfterCorrect(rows)).toBe(2);
  });

  it('does not count Again on a card that was never correct in range', () => {
    const rows = [
      row({ rating: 0, reviewed_at: '2026-09-01T10:00:00Z' }),
      row({ rating: 0, reviewed_at: '2026-09-02T10:00:00Z' }),
    ];
    expect(countForgotAfterCorrect(rows)).toBe(0);
  });

  it('tracks cards independently', () => {
    const rows = [
      row({ card_type: 'meaning_to_hanzi', rating: 2, reviewed_at: '2026-09-01T10:00:00Z' }),
      row({ card_type: 'audio_to_hanzi', rating: 0, reviewed_at: '2026-09-02T10:00:00Z' }),
    ];
    expect(countForgotAfterCorrect(rows)).toBe(0);
  });
});

describe('struggleScore', () => {
  it('is zero with no attempts', () => {
    expect(struggleScore({ attempts: 0, again_count: 0, hard_count: 0, forgot_count: 0, wrong_typed_count: 0 })).toBe(0);
  });

  it('weights again-rate by how often the word was seen', () => {
    const oneOfOne = struggleScore({ attempts: 1, again_count: 1, hard_count: 0, forgot_count: 0, wrong_typed_count: 0 });
    const fourOfFour = struggleScore({ attempts: 4, again_count: 4, hard_count: 0, forgot_count: 0, wrong_typed_count: 0 });
    expect(fourOfFour).toBeGreaterThan(oneOfOne);
  });

  it('ranks forgetting and wrong typed answers above a single hard', () => {
    const hard = struggleScore({ attempts: 2, again_count: 0, hard_count: 1, forgot_count: 0, wrong_typed_count: 0 });
    const forgot = struggleScore({ attempts: 2, again_count: 1, hard_count: 0, forgot_count: 1, wrong_typed_count: 1 });
    expect(forgot).toBeGreaterThan(hard);
  });
});

describe('rankStruggling', () => {
  it('ranks the worst word first and leaves out words with no trouble', () => {
    const rows = [
      // 'bad': 3 agains out of 4, one wrong typed answer
      row({ note_id: 'bad', hanzi: '谢谢', rating: 0, user_answer: '写写', reviewed_at: '2026-09-01T10:00:00Z' }),
      row({ note_id: 'bad', hanzi: '谢谢', rating: 2, reviewed_at: '2026-09-02T10:00:00Z' }),
      row({ note_id: 'bad', hanzi: '谢谢', rating: 0, reviewed_at: '2026-09-03T10:00:00Z' }),
      row({ note_id: 'bad', hanzi: '谢谢', rating: 0, reviewed_at: '2026-09-04T10:00:00Z', recording_url: 'recordings/x.webm' }),
      // 'meh': one hard
      row({ note_id: 'meh', hanzi: '再见', rating: 1, reviewed_at: '2026-09-02T10:00:00Z' }),
      // 'fine': all good
      row({ note_id: 'fine', hanzi: '不', rating: 2, reviewed_at: '2026-09-02T10:00:00Z' }),
      row({ note_id: 'fine', hanzi: '不', rating: 3, reviewed_at: '2026-09-03T10:00:00Z' }),
    ];
    const ranked = rankStruggling(rows);
    expect(ranked.map((s) => s.note.id)).toEqual(['bad', 'meh']);
    const bad = ranked[0];
    expect(bad.attempts).toBe(4);
    expect(bad.again_count).toBe(3);
    expect(bad.again_rate).toBe(0.75);
    expect(bad.forgot_count).toBe(1);
    expect(bad.wrong_answers).toEqual(['写写']);
    expect(bad.wrong_typed_count).toBe(1);
    expect(bad.recordings_count).toBe(1);
    expect(bad.last_reviewed_at).toBe('2026-09-04T10:00:00Z');
    expect(bad.events[0].event_id).toBe(rows[3].event_id); // newest first
    expect(bad.by_card_type.meaning_to_hanzi?.attempts).toBe(4);
  });

  it('respects the limit', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row({ note_id: `n${i}`, rating: 0 }));
    expect(rankStruggling(rows, 25)).toHaveLength(25);
  });

  it('averages only positive times', () => {
    const rows = [
      row({ rating: 0, time_spent_ms: 3000 }),
      row({ rating: 0, time_spent_ms: 0 }),
      row({ rating: 0, time_spent_ms: null }),
      row({ rating: 0, time_spent_ms: 5000 }),
    ];
    expect(rankStruggling(rows)[0].avg_time_ms).toBe(4000);
  });
});

describe('pickGoingWell', () => {
  it('includes words good/easy on every attempt with at least two attempts', () => {
    const rows = [
      row({ note_id: 'a', rating: 2 }),
      row({ note_id: 'a', rating: 3 }),
      row({ note_id: 'once', rating: 3 }), // only one attempt
      row({ note_id: 'mixed', rating: 2 }),
      row({ note_id: 'mixed', rating: 0 }),
    ];
    const well = pickGoingWell(rows, []);
    expect(well.map((w) => w.note.id)).toEqual(['a']);
    expect(well[0].reason).toBe('consistent');
    expect(well[0].easy_count).toBe(1);
  });

  it('includes words that graduated to a week or more, from cached card state', () => {
    const rows = [row({ note_id: 'g', rating: 2 })];
    const well = pickGoingWell(rows, [
      { note_id: 'g', card_type: 'hanzi_to_meaning', queue: 2, interval: 12 },
      { note_id: 'g', card_type: 'meaning_to_hanzi', queue: 1, interval: 0 },
    ]);
    expect(well).toHaveLength(1);
    expect(well[0].reason).toBe('graduated');
    expect(well[0].max_interval_days).toBe(12);
  });

  it('never lists a word that was forgotten in the range', () => {
    const rows = [row({ note_id: 'g', rating: 0 }), row({ note_id: 'g', rating: 2 })];
    const well = pickGoingWell(rows, [{ note_id: 'g', card_type: 'hanzi_to_meaning', queue: 2, interval: 30 }]);
    expect(well).toHaveLength(0);
  });

  it('sorts longest interval first', () => {
    const rows = [
      row({ note_id: 'a', rating: 2 }),
      row({ note_id: 'a', rating: 2 }),
      row({ note_id: 'b', rating: 2 }),
      row({ note_id: 'b', rating: 2 }),
    ];
    const well = pickGoingWell(rows, [{ note_id: 'b', card_type: 'hanzi_to_meaning', queue: 2, interval: 20 }]);
    expect(well.map((w) => w.note.id)).toEqual(['b', 'a']);
  });
});

describe('listRecordings', () => {
  it('lists only events with a recording, newest first, with the tutor mark attached', () => {
    const rows = [
      row({ recording_url: 'recordings/1.webm', reviewed_at: '2026-09-01T10:00:00Z' }),
      row({ recording_url: null }),
      row({ recording_url: 'recordings/2.webm', reviewed_at: '2026-09-03T10:00:00Z' }),
    ];
    const recs = listRecordings(rows, [
      { review_event_id: rows[0].event_id, status: 'needs_work', comment: 'second tone', updated_at: '2026-09-04T00:00:00Z' },
    ]);
    expect(recs.map((r) => r.recording_url)).toEqual(['recordings/2.webm', 'recordings/1.webm']);
    expect(recs[0].mark).toBeNull();
    expect(recs[1].mark?.status).toBe('needs_work');
  });
});

describe('resolveRange', () => {
  const now = new Date('2026-09-18T12:00:00.000Z');

  it('defaults to since the last lesson when one exists', () => {
    const r = resolveRange({}, '2026-09-10T15:00:00.000Z', now);
    expect(r.from).toBe('2026-09-10T15:00:00.000Z');
    expect(r.to).toBe(now.toISOString());
    expect(r.used_since_lesson).toBe(true);
  });

  it('defaults to the last 14 days with no lesson', () => {
    const r = resolveRange({}, null, now);
    expect(r.from).toBe('2026-09-04T12:00:00.000Z');
    expect(r.used_since_lesson).toBe(false);
  });

  it('uses explicit bounds and treats bare dates as whole days', () => {
    const r = resolveRange({ from: '2026-09-01', to: '2026-09-05T23:59:59.999Z' }, '2026-09-10T00:00:00Z', now);
    expect(r.from).toBe('2026-09-01T00:00:00.000Z');
    expect(r.to).toBe('2026-09-05T23:59:59.999Z');
    expect(r.used_since_lesson).toBe(false);
  });

  it('caps the range at 400 days', () => {
    const r = resolveRange({ from: '2020-01-01' }, null, now);
    const days = (new Date(r.to).getTime() - new Date(r.from).getTime()) / 86_400_000;
    expect(days).toBe(400);
  });

  it('ignores a lesson that is after `to`', () => {
    const r = resolveRange({ to: '2026-09-01' }, '2026-09-10T00:00:00Z', now);
    expect(r.used_since_lesson).toBe(false);
  });

  it('falls back when from is after to', () => {
    const r = resolveRange({ from: '2026-09-17', to: '2026-09-01' }, null, now);
    expect(new Date(r.from).getTime()).toBeLessThan(new Date(r.to).getTime());
  });
});

describe('computeInsights', () => {
  it('assembles the whole report', () => {
    const rows = [
      row({ note_id: 'a', rating: 0, user_answer: '尼好', recording_url: 'recordings/a.webm' }),
      row({ note_id: 'b', rating: 2 }),
      row({ note_id: 'b', rating: 2 }),
    ];
    const report = computeInsights({
      rows,
      cardStates: [],
      newWordsIntroduced: 2,
      activity: { lessons: [], readers: [], quests: [] },
      marks: [],
    });
    expect(report.totals.reviews).toBe(3);
    expect(report.struggling.map((s) => s.note.id)).toEqual(['a']);
    expect(report.going_well.map((s) => s.note.id)).toEqual(['b']);
    expect(report.recordings).toHaveLength(1);
  });
});
