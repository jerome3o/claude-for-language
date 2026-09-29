import { describe, it, expect } from 'vitest';
import {
  mergeTutorNotes,
  tutorNotesHomeLine,
  practiceRatingCounts,
  practiceAfterRating,
  practiceCardIds,
  practiceHint,
  type TutorNote,
  type UnseenTutorNote,
} from './index';

function note(id: string, updated_at: string, over: Partial<TutorNote> = {}): TutorNote {
  return {
    id,
    kind: 'recording',
    card_id: `card-${id}`,
    card_type: 'hanzi_to_meaning',
    note_id: `note-${id}`,
    deck_id: 'deck-1',
    hanzi: '中国',
    pinyin: 'Zhōngguó',
    english: 'China',
    comment: '第二声',
    tutor_name: '明慧老师',
    updated_at,
    seen_at: null,
    recording_url: `recordings/${id}.webm`,
    student_message: null,
    ...over,
  };
}

function unseen(n: TutorNote, over: Partial<UnseenTutorNote> = {}): UnseenTutorNote {
  return { id: n.id, kind: n.kind, card_id: n.card_id, note_id: n.note_id, hanzi: n.hanzi, comment: n.comment, tutor_name: n.tutor_name, updated_at: n.updated_at, ...over };
}

describe('mergeTutorNotes', () => {
  const a = note('a', '2026-09-28T10:00:00Z');
  const b = note('b', '2026-09-27T10:00:00Z', { seen_at: '2026-09-27T12:00:00Z' });
  const c = note('c', '2026-09-26T10:00:00Z', { kind: 'flag', recording_url: null, student_message: 'help' });

  it('the unseen feed decides what is new; the rest is earlier; each newest first', () => {
    const { fresh, earlier } = mergeTutorNotes([c, b, a], [unseen(c), unseen(a)]);
    expect(fresh.map((n) => n.id)).toEqual(['a', 'c']);
    expect(earlier.map((n) => n.id)).toEqual(['b']);
    expect(fresh[1]).toMatchObject({ pinyin: 'Zhōngguó', student_message: 'help', seen_at: null });
  });

  it('a note the full list still calls unseen but the feed dropped was seen here → earlier', () => {
    const { fresh, earlier } = mergeTutorNotes([a, c], [unseen(c)]);
    expect(fresh.map((n) => n.id)).toEqual(['c']);
    expect(earlier.map((n) => n.id)).toEqual(['a']);
  });

  it('a new note not in the full list yet is listed from the feed alone; the feed has the latest comment', () => {
    const d = note('d', '2026-09-29T08:00:00Z');
    const { fresh } = mergeTutorNotes([a], [unseen(d), unseen(a, { comment: 'edited', updated_at: '2026-09-29T09:00:00Z' })]);
    expect(fresh.map((n) => n.id)).toEqual(['a', 'd']);
    expect(fresh[0]).toMatchObject({ comment: 'edited', updated_at: '2026-09-29T09:00:00Z', pinyin: 'Zhōngguó' });
    expect(fresh[1]).toMatchObject({ pinyin: '', english: '', recording_url: null, card_type: null, deck_id: null });
  });

  it('ties on time are ordered by id, duplicates in the feed are ignored', () => {
    const x = note('x', '2026-09-28T10:00:00Z');
    const y = note('y', '2026-09-28T10:00:00Z');
    const { fresh } = mergeTutorNotes([x, y], [unseen(x), unseen(y), unseen(x)]);
    expect(fresh.map((n) => n.id)).toEqual(['y', 'x']);
  });
});

describe('tutorNotesHomeLine', () => {
  it('counts and names the tutor', () => {
    expect(tutorNotesHomeLine([])).toBeNull();
    expect(tutorNotesHomeLine([{ tutor_name: '明慧老师' }])).toBe('1 new note from 明慧老师');
    expect(tutorNotesHomeLine([{ tutor_name: '明慧老师' }, { tutor_name: '明慧老师' }, { tutor_name: '明慧老师' }])).toBe('3 new notes from 明慧老师');
    expect(tutorNotesHomeLine([{ tutor_name: '明慧老师' }, { tutor_name: '王老师' }])).toBe('2 new notes from your tutors');
    expect(tutorNotesHomeLine([{ tutor_name: null }])).toBe('1 new note from your tutor');
  });
});

describe('practice: the FSRS rule', () => {
  const now = Date.parse('2026-09-29T09:00:00Z');
  const cutoff = Date.parse('2026-09-29T23:59:59Z');

  it('a due review or learning card counts as a review', () => {
    expect(practiceRatingCounts({ queue: 2, due_ms: now - 86_400_000 }, cutoff)).toBe(true);
    expect(practiceRatingCounts({ queue: 2, due_ms: cutoff }, cutoff)).toBe(true); // due later today
    expect(practiceRatingCounts({ queue: 1, due_ms: now + 60_000 }, cutoff)).toBe(true);
    expect(practiceRatingCounts({ queue: 3, due_ms: null }, cutoff)).toBe(true);
  });

  it('a card not due, or still NEW, is practice only (no review event)', () => {
    expect(practiceRatingCounts({ queue: 2, due_ms: cutoff + 1 }, cutoff)).toBe(false);
    expect(practiceRatingCounts({ queue: 2, due_ms: now + 5 * 86_400_000 }, cutoff)).toBe(false);
    expect(practiceRatingCounts({ queue: 0, due_ms: null }, cutoff)).toBe(false);
    expect(practiceRatingCounts({ queue: 0, due_ms: now - 1 }, cutoff)).toBe(false);
  });

  it('says so on the card', () => {
    expect(practiceHint(true)).toMatch(/counts as a review/);
    expect(practiceHint(false)).toMatch(/Practice only/);
  });

  it('Again sends the card to the back; any other rating takes it out', () => {
    expect(practiceAfterRating(['a', 'b', 'c'], 'a', 0)).toEqual(['b', 'c', 'a']);
    expect(practiceAfterRating(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c']);
    expect(practiceAfterRating(['a'], 'a', 3)).toEqual([]);
    expect(practiceAfterRating(['a'], 'a', 0)).toEqual(['a']);
  });
});

describe('practiceCardIds', () => {
  const cards = new Map([
    ['n1', [{ id: 'c1-mh', card_type: 'meaning_to_hanzi' }, { id: 'c1-hm', card_type: 'hanzi_to_meaning' }]],
    ['n2', [{ id: 'c2-ah', card_type: 'audio_to_hanzi' }]],
  ]);

  it("uses the note's card, else hanzi → meaning, else the first; dedupes; skips words not on the device", () => {
    expect(
      practiceCardIds(
        [
          { card_id: 'c1-mh', note_id: 'n1' },
          { card_id: null, note_id: 'n1' },
          { card_id: 'gone', note_id: 'n2' },
          { card_id: 'c1-mh', note_id: 'n1' },
          { card_id: null, note_id: 'n-missing' },
        ],
        cards
      )
    ).toEqual(['c1-mh', 'c1-hm', 'c2-ah']);
  });
});
