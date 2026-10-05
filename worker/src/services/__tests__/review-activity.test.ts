import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { applyReviewMark, buildReviewSpec } from '../calls/review-activity';

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

const NOW = new Date('2026-10-05T12:00:00Z');

describe('review together list', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    exec(db, "INSERT INTO users (id, email, name) VALUES ('tut', 't@example.com', 'Minghui'), ('stu', 's@example.com', 'Jerome')");
    exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel', 'tut', 'stu', 'tutor', 'active')");
    exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('d', 'stu', 'Deck')");
    const word = (n: string, hanzi: string) => {
      exec(db, 'INSERT INTO notes (id, deck_id, hanzi, pinyin, english, audio_url) VALUES (?, ?, ?, ?, ?, ?)', n, 'd', hanzi, 'p', 'e', `generated/${n}.mp3`);
      exec(db, 'INSERT INTO cards (id, note_id, card_type) VALUES (?, ?, ?)', `c-${n}`, n, 'hanzi_to_meaning');
    };
    word('n1', '银行'); word('n2', '谢谢'); word('n3', '买'); word('n4', '卖'); word('n5', '再见');
    const rec = (id: string, n: string, rating: number, at: string) =>
      exec(db, 'INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at, recording_url) VALUES (?, ?, ?, ?, ?, ?)', id, `c-${n}`, 'stu', rating, at, `recordings/${id}.webm`);
    rec('e1', 'n1', 2, '2026-10-04T10:00:00Z'); // weak tone → queue
    rec('e2', 'n2', 3, '2026-10-04T09:00:00Z'); // clean → not listed
    rec('e3', 'n3', 0, '2026-10-03T10:00:00Z'); // Again → queue
    rec('e5', 'n5', 2, '2026-10-02T10:00:00Z'); // marked needs work → listed again
    exec(db, "INSERT INTO recording_checks (review_event_id, user_id, status, transcript, transcript_match, score, char_scores) VALUES ('e1', 'stu', 'done', '银行', 1, 74, ?)", JSON.stringify([{ char: '银', score: 50, error: 'Mispronunciation', tone_suspect: true }]));
    exec(db, "INSERT INTO recording_checks (review_event_id, user_id, status, transcript, transcript_match, score, char_scores) VALUES ('e2', 'stu', 'done', '谢谢', 1, 96, '[]')");
    exec(db, "INSERT INTO tutor_recording_marks (review_event_id, tutor_id, status, comment, updated_at) VALUES ('e5', 'tut', 'needs_work', 'zài, 4th tone', '2026-10-03T00:00:00Z')");
    exec(db, "INSERT INTO card_flags (id, relationship_id, student_id, tutor_id, note_id, message) VALUES ('f1', 'rel', 'stu', 'tut', 'n4', '买 or 卖?')");
  });

  it('lists the queue, flagged words and needs-work marks — not clean recordings', async () => {
    const spec = (await buildReviewSpec(db, 'rel', 'tut', NOW))!;
    expect(spec.kind).toBe('review');
    expect(spec.items.map((i) => [i.source, i.hanzi])).toEqual([
      ['recording', '银行'],
      ['recording', '买'],
      ['flag', '卖'],
      ['needs_work', '再见'],
    ]);
    const yin = spec.items[0];
    expect(yin).toMatchObject({ event_id: 'e1', recording_key: 'recordings/e1.webm', reference_key: 'generated/n1.mp3', weak: [{ char: '银', kind: 'tone' }] });
    expect(yin.labels).toContain('Sounded off: 银 (tone)');
    expect(spec.items[2]).toMatchObject({ flag_id: 'f1', event_id: null, recording_key: null, flag_message: '买 or 卖?' });
    expect(spec.items[3].labels).toEqual(['Needs work: zài, 4th tone']);
  });

  it('only the tutor of the relationship gets a list', async () => {
    expect(await buildReviewSpec(db, 'rel', 'someone-else', NOW)).toBeNull();
  });

  it('a mark in the call writes the recording mark and answers the flag', async () => {
    const spec = (await buildReviewSpec(db, 'rel', 'tut', NOW))!;
    await applyReviewMark(db, spec.items[0], 'tut', 'needs_work', 'yín — rising');
    expect(db.rows('SELECT status, comment FROM tutor_recording_marks WHERE review_event_id = ?', ['e1'])).toEqual([{ status: 'needs_work', comment: 'yín — rising' }]);
    await applyReviewMark(db, spec.items[2], 'tut', 'listened', '卖 is mài — falling');
    expect(db.rows("SELECT status, tutor_reply FROM card_flags WHERE id = 'f1'")).toEqual([{ status: 'resolved', tutor_reply: '卖 is mài — falling' }]);
    const after = (await buildReviewSpec(db, 'rel', 'tut', NOW))!;
    // 银行 left the queue and comes back as a needs-work item; the answered flag is gone.
    expect(after.items.map((i) => [i.source, i.hanzi])).toEqual([['recording', '买'], ['needs_work', '银行'], ['needs_work', '再见']]);
  });
});
