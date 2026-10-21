/**
 * System messages (docs/CHAT.md "System messages") against real SQLite with every
 * migration: migration 0131 tags the automated messages already in the chat by the
 * exact templates the code wrote (anything else stays an ordinary message), and the
 * new paths store the kind + data with a third-person fallback.
 */
import { describe, it, expect } from 'vitest';
import { createSqliteD1, applyMigrationsFrom, type SqliteD1 } from './sqlite-d1';
import { markCallMessageEnded, postSystemMessage } from '../chat/system';
import { getMessages } from '../conversations';
import { getChatInbox, getChatList } from '../chat/reads';
import { markCallEnded } from '../calls/store';

const TUTOR = 'tutor';
const STUDENT = 'student';

function seedPeople(db: SqliteD1) {
  db.raw.run("INSERT INTO users (id, email, name) VALUES ('tutor', 't@x.test', 'Minghui Wang'), ('student', 's@x.test', 'Jerome')");
  db.raw.run("INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel', 'tutor', 'student', 'tutor', 'active')");
  db.raw.run("INSERT INTO conversations (id, relationship_id) VALUES ('conv', 'rel')");
}

function insertMessage(db: SqliteD1, id: string, sender: string, content: string, at: string) {
  db.raw.run('INSERT INTO messages (id, conversation_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)', [id, 'conv', sender, content, at]);
}

function tagged(db: SqliteD1): Record<string, { kind: string | null; data: Record<string, unknown> | null }> {
  const out: Record<string, { kind: string | null; data: Record<string, unknown> | null }> = {};
  for (const r of db.rows<{ id: string; system_kind: string | null; system_data: string | null }>('SELECT id, system_kind, system_data FROM messages ORDER BY id')) {
    out[r.id] = { kind: r.system_kind, data: r.system_data ? JSON.parse(r.system_data) : null };
  }
  return out;
}

describe('migration 0131: existing automated messages', () => {
  it('tags each template, fills the data, and leaves everything else alone', async () => {
    const db = await createSqliteD1({ stopBefore: '0131' });
    seedPeople(db);
    db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d', 'student', 'HSK')");
    db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES ('n1', 'd', '银行', 'yínháng', 'bank'), ('n2', 'd', '长大', 'zhǎngdà', 'grow up')");
    db.raw.run(`INSERT INTO card_flags (id, relationship_id, student_id, tutor_id, note_id, message, status, tutor_reply, replied_at)
                VALUES ('f1', 'rel', 'student', 'tutor', 'n1', '我总是和很行搞混', 'resolved', '银行的银是金属', '2026-10-02 10:00:00')`);
    db.raw.run("INSERT INTO calls (id, relationship_id, created_by, status) VALUES ('call-live', 'rel', 'tutor', 'live'), ('call-old', 'rel', 'tutor', 'ended')");

    const T = (n: number) => `2026-10-0${n}T10:00:00.000Z`;
    insertMessage(db, 'a-budget', TUTOR, "I've set your new cards to 2 a day (+5 extra) 📚", T(1));
    insertMessage(db, 'a-budget-none', TUTOR, "I've set your new cards to 12 a day (no extra cards) 📚", T(1));
    insertMessage(db, 'a-budget-back', TUTOR, "I've set your new cards back to the usual 3 a day (+6 extra) 📚", T(1));
    insertMessage(db, 'b-call-live', TUTOR, '📹 I started a video call — join here: https://app.test/calls/call-live', T(2));
    insertMessage(db, 'b-call-old', TUTOR, '📹 I started a video call — join here: https://app.test/calls/call-old', T(2));
    insertMessage(db, 'c-flag', STUDENT, '🚩 Flagged 银行 (yínháng · bank): 我总是和很行搞混', T(3));
    insertMessage(db, 'c-flag-edited', STUDENT, '🚩 Flagged 长大 (zhǎng dà · to grow up): 读音？', T(3));
    insertMessage(db, 'd-reply', TUTOR, '🚩 About 银行: 银行的银是金属', T(4));
    insertMessage(
      db,
      'e-howto',
      TUTOR,
      'Hi Jerome! Here is how to get the app on your phone so it works offline (on the train, on a plane):\n\nAndroid app (recommended):\n1. Install Obtainium …\n\n' +
        'Or add a home-screen shortcut: open https://app.test in Chrome, tap the ⋮ menu → "Add to Home screen" / "Install app".\n\n' +
        'Once it is installed, open it while you have internet so your words and audio download. After that it works without a connection.',
      T(5),
    );
    insertMessage(db, 'f-group', TUTOR, '🧪 Group class "周三班" is starting now — join here: https://app.test/group-class/sess-1\n(This is an experimental group class: your tutor and a few other students on one video call.)', T(6));
    // Not templates: a person typing something similar stays a normal message.
    insertMessage(db, 'z-typed', TUTOR, "I've set your new cards to whatever you like 📚", T(7));
    insertMessage(db, 'z-typed2', STUDENT, '🚩 Flagged it', T(7));
    insertMessage(db, 'z-chinese', STUDENT, '我今天去银行了', T(7));
    db.raw.run("UPDATE messages SET deleted_at = '2026-10-08T00:00:00Z', content = '' WHERE id = 'z-typed2'");

    applyMigrationsFrom(db, '0131');
    const t = tagged(db);
    expect(t['a-budget']).toEqual({ kind: 'study_budget', data: { new_cards_per_day: 2, secondary_cards_per_day: 5, is_default: false } });
    expect(t['a-budget-none']).toEqual({ kind: 'study_budget', data: { new_cards_per_day: 12, secondary_cards_per_day: 0, is_default: false } });
    expect(t['a-budget-back']).toEqual({ kind: 'study_budget', data: { new_cards_per_day: 3, secondary_cards_per_day: 6, is_default: true } });
    expect(t['b-call-live']).toEqual({ kind: 'call_started', data: { call_id: 'call-live', ended: false } });
    expect(t['b-call-old']).toEqual({ kind: 'call_started', data: { call_id: 'call-old', ended: true } });
    expect(t['c-flag']).toEqual({
      kind: 'card_flag',
      data: { flag_id: 'f1', note_id: 'n1', hanzi: '银行', pinyin: 'yínháng', english: 'bank', message: '我总是和很行搞混' },
    });
    // The word was edited since: parsed from the text itself.
    expect(t['c-flag-edited']).toEqual({ kind: 'card_flag', data: { hanzi: '长大', pinyin: 'zhǎng dà', english: 'to grow up', message: '读音？' } });
    expect(t['d-reply']).toEqual({ kind: 'flag_reply', data: { flag_id: 'f1', note_id: 'n1', hanzi: '银行', reply: '银行的银是金属' } });
    expect(t['e-howto']).toEqual({ kind: 'install_howto', data: { app_url: 'https://app.test' } });
    expect(t['f-group']).toEqual({ kind: 'group_class', data: { group_name: '周三班', session_id: 'sess-1' } });
    for (const id of ['z-typed', 'z-typed2', 'z-chinese']) expect(t[id]).toEqual({ kind: null, data: null });
  });
});

describe('posting and reading system messages', () => {
  it('stores the kind + data, a third-person fallback, and reads back for both people', async () => {
    const db = await createSqliteD1();
    seedPeople(db);
    const sent = await postSystemMessage(db, 'conv', TUTOR, 'study_budget', { new_cards_per_day: 2, secondary_cards_per_day: 5, is_default: false });
    expect(sent.content).toBe('📚 Minghui set your new cards to 2 a day (+5 extra)');
    expect(sent.system_kind).toBe('study_budget');

    const { messages } = await getMessages(db, 'conv', STUDENT);
    expect(messages[0]).toMatchObject({ system_kind: 'study_budget', system_data: { new_cards_per_day: 2, secondary_cards_per_day: 5, is_default: false } });

    // The inbox reads it from each side, never "You: I've set…".
    const tutorList = await getChatList(db, TUTOR);
    expect(tutorList.conversations[0].last_message).toMatchObject({ preview: "📚 You set Jerome's new cards to 2 a day (+5 extra)", system_kind: 'study_budget' });
    const studentList = await getChatList(db, STUDENT);
    expect(studentList.conversations[0].last_message?.preview).toBe('📚 Minghui set your new cards to 2 a day (+5 extra)');
    const inbox = await getChatInbox(db, STUDENT);
    expect(inbox.messages[0]).toMatchObject({ content: '📚 Minghui set your new cards to 2 a day (+5 extra)', system_kind: 'study_budget' });
  });

  it('a call line: the join link for older apps, then ended / missed when the call ends', async () => {
    const db = await createSqliteD1();
    seedPeople(db);
    db.raw.run("INSERT INTO calls (id, relationship_id, created_by, status) VALUES ('c1', 'rel', 'tutor', 'live')");
    const sent = await postSystemMessage(db, 'conv', TUTOR, 'call_started', { call_id: 'c1' }, { url: 'https://app.test/calls/c1' });
    expect(sent.content).toBe('📹 Minghui started a video call — join here: https://app.test/calls/c1');

    expect(await markCallEnded(db, 'c1')).toBe(true);
    let data = (await getMessages(db, 'conv', STUDENT)).messages[0].system_data;
    expect(data).toEqual({ call_id: 'c1', ended: true });
    // The room knows who came: only the caller → missed.
    expect(await markCallMessageEnded(db, 'c1', [TUTOR])).toEqual([sent.id]);
    data = (await getMessages(db, 'conv', STUDENT)).messages[0].system_data;
    expect(data).toEqual({ call_id: 'c1', ended: true, missed: true });
    // Nothing more to change → no update.
    expect(await markCallMessageEnded(db, 'c1', [TUTOR])).toEqual([]);
    expect(await markCallMessageEnded(db, 'c1', [TUTOR, STUDENT])).toEqual([sent.id]);
    expect((await getMessages(db, 'conv', STUDENT)).messages[0].system_data).toMatchObject({ missed: false });
  });
});
