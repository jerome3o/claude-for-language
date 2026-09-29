/**
 * Golden vectors: "Notes from your tutor" (shared/tutor-notes) — the new / earlier merge and
 * its order, the Home line, and the practice rules (does a rating count as a review, the queue
 * after a rating, which card to practise). Writes tutor-notes.json; checked by
 * core/…/TutorNotesParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  mergeTutorNotes,
  tutorNotesHomeLine,
  tutorNoteLabel,
  practiceRatingCounts,
  practiceAfterRating,
  practiceCardIds,
  practiceHint,
  type TutorNote,
  type UnseenTutorNote,
} from '../../../shared/tutor-notes';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20260930);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const TUTORS = ['明慧老师', 'Mandarin Home 明慧老师', '王老师', '', '  '] as const;
const when = () => `2026-09-${String(int(20, 29)).padStart(2, '0')}T${String(int(0, 23)).padStart(2, '0')}:0${int(0, 1)}:00Z`;

function note(i: number): TutorNote {
  const kind = pick(['recording', 'flag'] as const);
  return {
    id: `x${int(0, 30)}-${i}`.slice(0, r() < 0.3 ? 3 : 10),
    kind,
    card_id: r() < 0.8 ? `c${int(0, 9)}` : null,
    card_type: r() < 0.8 ? 'hanzi_to_meaning' : null,
    note_id: `n${int(0, 9)}`,
    deck_id: r() < 0.9 ? 'd1' : null,
    hanzi: pick(['中国', '刮风', '感兴趣']),
    pinyin: pick(['Zhōngguó', '', 'guā fēng']),
    english: pick(['China', '', 'windy']),
    comment: pick(['第二声', '国 is guó', 'Nice']),
    tutor_name: r() < 0.85 ? pick(TUTORS) : null,
    updated_at: when(),
    seen_at: r() < 0.5 ? when() : null,
    recording_url: kind === 'recording' && r() < 0.8 ? 'recordings/x.webm' : null,
    student_message: kind === 'flag' ? pick(['help', null]) : null,
  };
}

const merges = Array.from({ length: 150 }, () => {
  const all = Array.from({ length: int(0, 8) }, (_, i) => note(i));
  const unseen: UnseenTutorNote[] = [];
  for (const n of all) if (r() < 0.4) unseen.push({ id: n.id, kind: n.kind, card_id: n.card_id, note_id: n.note_id, hanzi: n.hanzi, comment: r() < 0.2 ? 'edited' : n.comment, tutor_name: r() < 0.1 ? null : n.tutor_name, updated_at: r() < 0.2 ? when() : n.updated_at });
  for (let k = int(0, 2); k > 0; k--) {
    const n = note(100 + k);
    unseen.push({ id: n.id, kind: n.kind, card_id: n.card_id, note_id: n.note_id, hanzi: n.hanzi, comment: n.comment, tutor_name: n.tutor_name, updated_at: n.updated_at });
  }
  if (unseen.length && r() < 0.2) unseen.push(unseen[0]);
  const list = mergeTutorNotes(all, unseen);
  return { all, unseen, fresh: list.fresh, earlier: list.earlier, line: tutorNotesHomeLine(list.fresh) };
});

const labels = (['recording', 'flag'] as const).map((kind) => ({ kind, label: tutorNoteLabel({ kind }) }));

const cutoff = Date.parse('2026-09-29T23:59:59.999Z');
const counts = Array.from({ length: 80 }, () => {
  const queue = int(0, 3);
  const due_ms = r() < 0.15 ? null : cutoff + int(-3, 3) * pick([1, 60_000, 86_400_000]);
  const c = practiceRatingCounts({ queue, due_ms }, cutoff);
  return { queue, due_ms, cutoff, counts: c, hint: practiceHint(c) };
});

const after = Array.from({ length: 60 }, () => {
  const queue = Array.from({ length: int(0, 5) }, (_, i) => `c${i}`);
  const cardId = r() < 0.9 && queue.length ? pick(queue) : 'cx';
  const rating = int(0, 3);
  return { queue, cardId, rating, result: practiceAfterRating(queue, cardId, rating) };
});

const cardPicks = Array.from({ length: 60 }, () => {
  const cardsByNote: [string, { id: string; card_type: string }[]][] = Array.from({ length: int(0, 4) }, (_, i) => [
    `n${i}`,
    Array.from({ length: int(0, 3) }, (_, k) => ({ id: `n${i}c${k}`, card_type: pick(['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi']) })),
  ]);
  const notes = Array.from({ length: int(0, 6) }, () => ({ card_id: r() < 0.5 ? `n${int(0, 5)}c${int(0, 3)}` : null, note_id: `n${int(0, 5)}` }));
  return { notes, cardsByNote, result: practiceCardIds(notes, new Map(cardsByNote)) };
});

writeFileSync(join(OUT, 'tutor-notes.json'), JSON.stringify({ merges, labels, counts, after, cardPicks }));
