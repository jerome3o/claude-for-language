/**
 * Test rows for the reader / exercise contexts (harness, memory and privacy tests): a graded reader
 * of three pages and a mini lesson, both the learner's ('u1'); and a stranger's reader + lesson.
 */
import type { SqliteD1 } from '../../__tests__/sqlite-d1';

export const LESSON_SPEC = {
  title: '把字句',
  sections: [
    {
      title: 'Practice',
      exercises: [
        { type: 'note', title: '把', body: '把 + 宾语 + 动词 + 结果' },
        { type: 'translate', english: 'I put the book on the table.', reference_hanzi: '我把书放在桌子上。', reference_pinyin: 'Wǒ bǎ shū fàng zài zhuōzi shang.' },
      ],
    },
  ],
};

export function seedReaderAndLesson(db: SqliteD1, userId = 'u1', strangerId: string | null = 'x1') {
  db.raw.run("INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, topic, source_deck_ids, vocabulary_used) VALUES ('rd1', ?, '成都', 'Chengdu', 'elementary', 'travel', '[]', '[]')", [userId]);
  const pages = [
    ['pg1', 1, '小明去成都。', 'Xiǎo Míng qù Chéngdū.', 'Xiao Ming goes to Chengdu.'],
    ['pg2', 2, '成都的熊猫很可爱。', 'Chéngdū de xióngmāo hěn kě’ài.', 'The pandas of Chengdu are cute.'],
    ['pg3', 3, '他吃了很辣的火锅。', 'Tā chī le hěn là de huǒguō.', 'He ate a very spicy hotpot.'],
  ];
  for (const [id, n, zh, py, en] of pages) {
    db.raw.run('INSERT INTO reader_pages (id, reader_id, page_number, content_chinese, content_pinyin, content_english) VALUES (?, ?, ?, ?, ?, ?)', [id, 'rd1', n, zh, py, en]);
  }
  db.raw.run("INSERT INTO custom_lessons (id, user_id, title, spec) VALUES ('ls1', ?, '把字句', ?)", [userId, JSON.stringify(LESSON_SPEC)]);
  if (strangerId) {
    db.raw.run("INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, source_deck_ids, vocabulary_used) VALUES ('rdx', ?, '秘密', 'Secret', 'beginner', '[]', '[]')", [strangerId]);
    db.raw.run("INSERT INTO custom_lessons (id, user_id, title, spec) VALUES ('lsx', ?, '秘密', ?)", [strangerId, JSON.stringify(LESSON_SPEC)]);
  }
}
