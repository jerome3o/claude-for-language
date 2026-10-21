-- System messages in the chat (docs/CHAT.md "System messages"): lines the platform posts on
-- someone's behalf (the tutor changed the daily new cards, a video call started, a card was
-- flagged / a flag answered, the install how-to, a group-class link). The person stays the
-- sender; the apps draw the row from the kind + data, third person, from the viewer's side.
--   system_kind  'study_budget' | 'call_started' | 'card_flag' | 'flag_reply' | 'install_howto' | 'group_class'
--   system_data  JSON (shared/chats/system.ts); `content` keeps a readable fallback for older apps
ALTER TABLE messages ADD COLUMN system_kind TEXT;
ALTER TABLE messages ADD COLUMN system_data TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_system ON messages(system_kind) WHERE system_kind IS NOT NULL;

-- Existing automated messages, tagged by the exact templates the code wrote. Anything that
-- doesn't match stays an ordinary message.

-- 1. "I've set your new cards to 5 a day (+10 extra) 📚" / "… (no extra cards) 📚"
UPDATE messages
   SET system_kind = 'study_budget',
       system_data = json_object(
         'new_cards_per_day', CAST(substr(content, 28) AS INTEGER),
         'secondary_cards_per_day', CASE WHEN instr(content, '(+') > 0 THEN CAST(substr(content, instr(content, '(+') + 2) AS INTEGER) ELSE 0 END,
         'is_default', json('false'))
 WHERE system_kind IS NULL AND deleted_at IS NULL
   AND content LIKE 'I''ve set your new cards to % a day (%) 📚'
   AND CAST(substr(content, 28) AS INTEGER) || ' a day (' = substr(content, 28, length(CAST(substr(content, 28) AS INTEGER) || ' a day ('));

-- "I've set your new cards back to the usual 3 a day (+6 extra) 📚"
UPDATE messages
   SET system_kind = 'study_budget',
       system_data = json_object(
         'new_cards_per_day', CAST(substr(content, 43) AS INTEGER),
         'secondary_cards_per_day', CASE WHEN instr(content, '(+') > 0 THEN CAST(substr(content, instr(content, '(+') + 2) AS INTEGER) ELSE 0 END,
         'is_default', json('true'))
 WHERE system_kind IS NULL AND deleted_at IS NULL
   AND content LIKE 'I''ve set your new cards back to the usual % a day (%) 📚'
   AND CAST(substr(content, 43) AS INTEGER) || ' a day (' = substr(content, 43, length(CAST(substr(content, 43) AS INTEGER) || ' a day ('));

-- 2. "📹 I started a video call — join here: https://…/calls/<id>" (ended when the call row is)
UPDATE messages
   SET system_kind = 'call_started',
       system_data = json_object(
         'call_id', substr(content, instr(content, '/calls/') + 7),
         'ended', json(CASE WHEN EXISTS (
            SELECT 1 FROM calls c WHERE c.id = substr(messages.content, instr(messages.content, '/calls/') + 7) AND c.status = 'live'
          ) THEN 'false' ELSE 'true' END))
 WHERE system_kind IS NULL AND deleted_at IS NULL
   AND content LIKE '📹 I started a video call — join here: %/calls/%'
   AND instr(substr(content, instr(content, '/calls/') + 7), '/') = 0
   AND instr(substr(content, instr(content, '/calls/') + 7), ' ') = 0
   AND length(substr(content, instr(content, '/calls/') + 7)) > 0;

-- 3. The card-flag mirror "🚩 Flagged 银行 (yínháng · bank): <the student's note>", matched to its flag.
UPDATE messages
   SET system_kind = 'card_flag',
       system_data = (
         SELECT json_object('flag_id', f.id, 'note_id', f.note_id, 'hanzi', n.hanzi, 'pinyin', n.pinyin, 'english', n.english, 'message', f.message)
           FROM card_flags f JOIN notes n ON n.id = f.note_id
          WHERE f.student_id = messages.sender_id
            AND messages.content = '🚩 Flagged ' || n.hanzi || ' (' || n.pinyin || ' · ' || n.english || '): ' || f.message
          ORDER BY f.created_at LIMIT 1)
 WHERE system_kind IS NULL AND deleted_at IS NULL
   AND content LIKE '🚩 Flagged % (% · %): %'
   AND EXISTS (
     SELECT 1 FROM card_flags f JOIN notes n ON n.id = f.note_id
      WHERE f.student_id = messages.sender_id
        AND messages.content = '🚩 Flagged ' || n.hanzi || ' (' || n.pinyin || ' · ' || n.english || '): ' || f.message);

-- …and the rest of that template (the word edited since): the text itself.
UPDATE messages
   SET system_kind = 'card_flag',
       system_data = json_object(
         'hanzi', substr(content, 11, instr(content, ' (') - 11),
         'pinyin', substr(content, instr(content, ' (') + 2, instr(content, ' · ') - instr(content, ' (') - 2),
         'english', substr(content, instr(content, ' · ') + 3, instr(content, '): ') - instr(content, ' · ') - 3),
         'message', substr(content, instr(content, '): ') + 3))
 WHERE system_kind IS NULL AND deleted_at IS NULL
   AND content LIKE '🚩 Flagged % (% · %): %'
   AND instr(content, ' (') > 11
   AND instr(content, ' · ') > instr(content, ' (')
   AND instr(content, '): ') > instr(content, ' · ');

-- 4. The tutor's reply mirror "🚩 About 银行: <her reply>", matched to its flag when possible.
UPDATE messages
   SET system_kind = 'flag_reply',
       system_data = json_object(
         'flag_id', (SELECT f.id FROM card_flags f JOIN notes n ON n.id = f.note_id
                      WHERE f.tutor_id = messages.sender_id AND messages.content = '🚩 About ' || n.hanzi || ': ' || f.tutor_reply
                      ORDER BY f.replied_at LIMIT 1),
         'note_id', (SELECT f.note_id FROM card_flags f JOIN notes n ON n.id = f.note_id
                      WHERE f.tutor_id = messages.sender_id AND messages.content = '🚩 About ' || n.hanzi || ': ' || f.tutor_reply
                      ORDER BY f.replied_at LIMIT 1),
         'hanzi', substr(content, 9, instr(content, ': ') - 9),
         'reply', substr(content, instr(content, ': ') + 2))
 WHERE system_kind IS NULL AND deleted_at IS NULL
   AND content LIKE '🚩 About %: %'
   AND instr(content, ': ') > 9;

-- 5. The install how-to ("Hi …! Here is how to get the app on your phone so it works offline …").
UPDATE messages
   SET system_kind = 'install_howto',
       system_data = json_object(
         'app_url', CASE WHEN instr(content, 'shortcut: open ') > 0 AND instr(content, ' in Chrome') > instr(content, 'shortcut: open ')
                         THEN substr(content, instr(content, 'shortcut: open ') + 15, instr(content, ' in Chrome') - instr(content, 'shortcut: open ') - 15)
                         ELSE NULL END)
 WHERE system_kind IS NULL AND deleted_at IS NULL
   AND content LIKE 'Hi %Here is how to get the app on your phone so it works offline (on the train, on a plane):%'
   AND content LIKE '%After that it works without a connection.';

-- 6. The group-class link "🧪 Group class "<name>" is starting now — join here: …/group-class/<id>\n(…)".
UPDATE messages
   SET system_kind = 'group_class',
       system_data = json_object(
         'group_name', substr(content, 16, instr(content, '" is starting now — join here: ') - 16),
         'session_id', CASE WHEN instr(content, '/group-class/') > 0 AND instr(substr(content, instr(content, '/group-class/') + 13), char(10)) > 1
                            THEN substr(content, instr(content, '/group-class/') + 13, instr(substr(content, instr(content, '/group-class/') + 13), char(10)) - 1)
                            ELSE NULL END)
 WHERE system_kind IS NULL AND deleted_at IS NULL
   AND content LIKE '🧪 Group class "%" is starting now — join here: %'
   AND instr(content, '" is starting now — join here: ') > 16;
