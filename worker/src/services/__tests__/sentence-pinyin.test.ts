/**
 * The pinyin check on example sentences and their breakdowns (services/sentence-pinyin.ts):
 * - 这些破烂东西可以扔掉。 "… zhuāngdiào" → "… rēngdiào" in a set row and in its breakdown (Jerome, Nov 2026);
 * - real readings are never touched (大人 dàrén, 还 hái, 好好 hǎohāo, 东西 dōngxi);
 * - new sets are returned checked; the stored-row repair (migration 0155, real SQLite) corrects a row,
 *   bumps every row of its note past the sync cursor, leaves the card row's pinyin (a note field) alone,
 *   marks every row it looked at and is idempotent.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import * as q from '../../db/queries';
import {
  checkBriefExplanationPinyin,
  checkExplanationJson,
  checkSentencePinyin,
  repairSentencePinyin,
  repairUserSentencePinyinSoon,
  resetSentencePinyinThrottle,
  SENTENCE_PINYIN_CHECK_VERSION,
} from '../sentence-pinyin';
import { generateSentenceSet } from '../sentence-set';

const JEROME = '这些破烂东西可以扔掉。';
const WRONG = 'Zhèxiē pòlàn dōngxi kěyǐ zhuāngdiào.';
const RIGHT = 'Zhèxiē pòlàn dōngxi kěyǐ rēngdiào.';
const WRONG_BREAKDOWN = {
  translation: 'This junk can be thrown away.',
  words: [
    { hanzi: '这些', pinyin: 'zhèxiē', gloss: 'these' },
    { hanzi: '破烂', pinyin: 'pòlàn', gloss: 'junk' },
    { hanzi: '东西', pinyin: 'dōngxi', gloss: 'things' },
    { hanzi: '可以', pinyin: 'kěyǐ', gloss: 'can' },
    { hanzi: '扔掉', pinyin: 'zhuāngdiào', gloss: 'throw away' },
  ],
  construction: 'Topic + 可以 + verb-result.',
};

describe('checkSentencePinyin', () => {
  it('corrects the impossible syllable only (扔 is never zhuāng)', async () => {
    expect(await checkSentencePinyin(JEROME, WRONG)).toBe(RIGHT);
    expect(await checkSentencePinyin(JEROME, 'zhèxiē pòlàn dōngxi kěyǐ zhuāngdiào。')).toBe('zhèxiē pòlàn dōngxi kěyǐ rēngdiào。');
  });

  it('never touches a real reading', async () => {
    for (const [hanzi, pinyin] of [
      ['大人在家。', 'Dàrén zài jiā.'],
      ['他还没来。', 'Tā hái méi lái.'],
      ['你好好休息。', 'Nǐ hǎohāo xiūxi.'],
      ['这些东西很贵。', 'Zhèxiē dōngxi hěn guì.'],
      ['我觉得很好。', 'Wǒ juéde hěn hǎo.'],
    ]) {
      expect(await checkSentencePinyin(hanzi, pinyin)).toBe(pinyin);
    }
  });

  it('applies the 一 / 不 rule (the card standard)', async () => {
    expect(await checkSentencePinyin('我买了一个苹果。', 'Wǒ mǎi le yī gè píngguǒ.')).toBe('Wǒ mǎi le yí gè píngguǒ.');
    expect(await checkSentencePinyin('这不是我的。', 'Zhè bù shì wǒ de.')).toBe('Zhè bú shì wǒ de.');
  });

  it('leaves blank / misaligned pinyin as written', async () => {
    expect(await checkSentencePinyin(JEROME, '')).toBe('');
    expect(await checkSentencePinyin(JEROME, null)).toBe('');
    expect(await checkSentencePinyin(JEROME, 'zhèxiē dōngxi')).toBe('zhèxiē dōngxi');
  });
});

describe('checkBriefExplanationPinyin', () => {
  it('corrects 扔掉 zhuāngdiào → rēngdiào in the breakdown, nothing else', async () => {
    const r = await checkBriefExplanationPinyin(WRONG_BREAKDOWN);
    expect(r.changed).toBe(true);
    expect(r.explanation.words.map((w) => w.pinyin)).toEqual(['zhèxiē', 'pòlàn', 'dōngxi', 'kěyǐ', 'rēngdiào']);
    expect(r.explanation.translation).toBe(WRONG_BREAKDOWN.translation);
    expect(r.explanation.construction).toBe(WRONG_BREAKDOWN.construction);
  });

  it('keeps a right breakdown as it is (same object)', async () => {
    const right = { words: [{ hanzi: '大人', pinyin: 'dàrén', gloss: 'adult' }, { hanzi: '还', pinyin: 'hái', gloss: 'still' }], construction: '' };
    const r = await checkBriefExplanationPinyin(right);
    expect(r.changed).toBe(false);
    expect(r.explanation).toBe(right);
  });

  it('a stored breakdown JSON: corrected, or the same string', async () => {
    const fixed = await checkExplanationJson(JSON.stringify(WRONG_BREAKDOWN));
    expect(JSON.parse(fixed!).words[4].pinyin).toBe('rēngdiào');
    const ok = JSON.stringify({ words: [{ hanzi: '好好', pinyin: 'hǎohāo', gloss: 'well' }], construction: '' });
    expect(await checkExplanationJson(ok)).toBe(ok);
    expect(await checkExplanationJson('not json')).toBe('not json');
    expect(await checkExplanationJson(null)).toBeNull();
  });
});

describe('generateSentenceSet returns checked pinyin', () => {
  it('corrects a wrong sentence from the model', async () => {
    const client = {
      messages: {
        create: async () => ({
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              name: 'create_sentence_set',
              input: { sentences: [{ hanzi: JEROME, pinyin: WRONG, translation: 'This junk can be thrown away.', focus: 'core' }] },
            },
          ],
        }),
      },
    };
    const out = await generateSentenceSet('key', { hanzi: '破烂', pinyin: 'pòlàn', english: 'junk' }, 3, {
      client: client as never,
      sleep: async () => {},
    });
    expect(out.map((s) => s.pinyin)).toEqual([RIGHT]);
  });
});

describe('repairSentencePinyin (stored rows, migration 0155)', () => {
  let db: SqliteD1;
  const D1 = () => db as unknown as D1Database;
  const OLD = '2026-10-01T00:00:00.000Z';

  beforeEach(async () => {
    resetSentencePinyinThrottle();
    db = await createSqliteD1();
    db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('jer', 'j@x.test', 'J', 'student')");
    db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('oth', 'o@x.test', 'O', 'student')");
    db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d1', 'jer', 'Mine')");
    db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('d2', 'oth', 'Theirs')");
    // 破烂 with a card sentence whose note pinyin is wrong too (a note field — left to the word check).
    db.raw.run(
      "INSERT INTO notes (id, deck_id, hanzi, pinyin, english, sentence_clue, sentence_clue_pinyin, updated_at) VALUES ('n1', 'd1', '破烂', 'pòlàn', 'junk', '把破烂扔掉。', 'Bǎ pòlàn zhuāngdiào.', '2026-10-01 00:00:00')",
    );
    db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english, updated_at) VALUES ('n2', 'd1', '大人', 'dàrén', 'adult', '2026-10-01 00:00:00')");
    db.raw.run("INSERT INTO notes (id, deck_id, hanzi, pinyin, english, updated_at) VALUES ('n3', 'd2', '扔', 'rēng', 'throw', '2026-10-01 00:00:00')");
    const row = (id: string, note: string, pos: number, hanzi: string, pinyin: string, extra: { explanation?: string; is_card?: number } = {}) =>
      db.raw.run(
        'INSERT INTO note_sentences (id, note_id, position, hanzi, pinyin, explanation, is_card, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, note, pos, hanzi, pinyin, extra.explanation ?? null, extra.is_card ?? 0, OLD, OLD],
      );
    row('n1-card', 'n1', -1, '把破烂扔掉。', 'Bǎ pòlàn zhuāngdiào.', {
      is_card: 1,
      explanation: JSON.stringify({ words: [{ hanzi: '把', pinyin: 'bǎ', gloss: 'BA' }, { hanzi: '破烂', pinyin: 'pòlàn', gloss: 'junk' }, { hanzi: '扔掉', pinyin: 'zhuāngdiào', gloss: 'throw away' }], construction: '' }),
    });
    row('s1', 'n1', 0, JEROME, WRONG, { explanation: JSON.stringify(WRONG_BREAKDOWN) });
    row('s2', 'n1', 1, '破烂很多。', 'Pòlàn hěn duō.');
    row('s3', 'n2', 0, '大人在家。', 'Dàrén zài jiā.');
    row('s4', 'n3', 0, '别扔掉。', 'Bié zhuāngdiào.');
  });

  const get = (id: string) =>
    db.rows<{ pinyin: string; explanation: string | null; pinyin_checked: number | null; updated_at: string }>(
      'SELECT pinyin, explanation, pinyin_checked, updated_at FROM note_sentences WHERE id = ?',
      [id],
    )[0];

  it("corrects Jerome's row and its breakdown, bumps the note's rows, leaves the card row's pinyin", async () => {
    const now = '2026-11-20T10:00:00.000Z';
    const r = await repairSentencePinyin(D1(), {}, { userId: 'jer', now: () => now });
    expect(r).toMatchObject({ checked: 4, fixed: 2, more: false });
    expect(r.note_ids).toEqual(['n1']);

    const s1 = get('s1');
    expect(s1.pinyin).toBe(RIGHT);
    expect(JSON.parse(s1.explanation!).words[4].pinyin).toBe('rēngdiào');
    expect(s1.pinyin_checked).toBe(SENTENCE_PINYIN_CHECK_VERSION);
    // The card row: its breakdown corrected, its pinyin (the note's sentence_clue_pinyin mirror) not.
    const card = get('n1-card');
    expect(card.pinyin).toBe('Bǎ pòlàn zhuāngdiào.');
    expect(JSON.parse(card.explanation!).words[2].pinyin).toBe('rēngdiào');
    // Every row of the corrected note travels with the next sync; the other note's rows don't move.
    expect(get('s2').updated_at).toBe(now);
    expect(get('s2').pinyin_checked).toBe(SENTENCE_PINYIN_CHECK_VERSION);
    expect(get('s3')).toMatchObject({ pinyin: 'Dàrén zài jiā.', updated_at: OLD, pinyin_checked: SENTENCE_PINYIN_CHECK_VERSION });
    // Another user's row is not touched by Jerome's pass.
    expect(get('s4')).toMatchObject({ pinyin: 'Bié zhuāngdiào.', pinyin_checked: null });

    // /api/sentences/changes since an older cursor hands n1 out whole, with the fix.
    const { sentences, noteIds } = await q.getNoteSentencesForUser(D1(), 'jer', '2026-11-01T00:00:00.000Z');
    expect(noteIds).toEqual(['n1']);
    expect(sentences.map((s) => s.id).sort()).toEqual(['n1-card', 's1', 's2']);
    expect(sentences.find((s) => s.id === 's1')!.pinyin).toBe(RIGHT);
  });

  it('is idempotent: a second pass finds nothing and moves nothing', async () => {
    await repairSentencePinyin(D1(), {}, { now: () => '2026-11-20T10:00:00.000Z' });
    const before = db.rows('SELECT id, pinyin, explanation, pinyin_checked, updated_at FROM note_sentences ORDER BY id');
    const again = await repairSentencePinyin(D1(), {}, { now: () => '2026-11-21T10:00:00.000Z' });
    expect(again).toMatchObject({ checked: 0, fixed: 0, more: false });
    expect(db.rows('SELECT id, pinyin, explanation, pinyin_checked, updated_at FROM note_sentences ORDER BY id')).toEqual(before);
    // The global pass covered the other user too.
    expect(get('s4').pinyin).toBe('Bié rēngdiào.');
  });

  it('works through a backlog in bounded passes', async () => {
    const first = await repairSentencePinyin(D1(), {}, { limit: 2 });
    expect(first).toMatchObject({ checked: 2, more: true });
    let total = first.checked;
    for (let i = 0; i < 5; i++) {
      const r = await repairSentencePinyin(D1(), {}, { limit: 2 });
      total += r.checked;
      if (!r.more) break;
    }
    expect(total).toBe(5);
    expect(db.rows('SELECT id FROM note_sentences WHERE pinyin_checked IS NULL')).toEqual([]);
  });

  it('never overwrites a row changed since it was read', async () => {
    // Simulate a concurrent regeneration: the row's pinyin changed between read and write.
    const realBatch = db.batch.bind(db);
    db.batch = (async (stmts: D1PreparedStatement[]) => {
      db.raw.run("UPDATE note_sentences SET pinyin = 'Zhèxiē pòlàn dōngxi kěyǐ rēngdiào le.' WHERE id = 's1'");
      return realBatch(stmts);
    }) as typeof db.batch;
    await repairSentencePinyin(D1(), {}, { userId: 'jer' });
    expect(get('s1')).toMatchObject({ pinyin: 'Zhèxiē pòlàn dōngxi kěyǐ rēngdiào le.', pinyin_checked: null });
  });

  it('new rows are written checked (replace / append carry pinyinChecked)', async () => {
    await q.replaceNoteSentences(D1(), 'n2', [
      { hanzi: '大人们来了。', pinyin: 'Dàrénmen lái le.', translation: null, audioUrl: null, focus: 'core', focusNote: null, pinyinChecked: SENTENCE_PINYIN_CHECK_VERSION },
    ]);
    await q.appendNoteSentences(D1(), 'n2', [
      { hanzi: '大人很忙。', pinyin: 'Dàrén hěn máng.', translation: null, audioUrl: null, focus: 'core', focusNote: null, pinyinChecked: SENTENCE_PINYIN_CHECK_VERSION },
    ]);
    expect(db.rows<{ pinyin_checked: number }>("SELECT pinyin_checked FROM note_sentences WHERE note_id = 'n2'").map((r) => r.pinyin_checked)).toEqual([
      SENTENCE_PINYIN_CHECK_VERSION,
      SENTENCE_PINYIN_CHECK_VERSION,
    ]);
  });

  it('the per-user pass before a sync is throttled per isolate', async () => {
    const t0 = Date.parse('2026-11-20T10:00:00Z');
    expect((await repairUserSentencePinyinSoon(D1(), 'jer', {}, t0))?.fixed).toBe(2);
    // Done: nothing more for a while.
    expect(await repairUserSentencePinyinSoon(D1(), 'jer', {}, t0 + 60_000)).toBeNull();
  });
});
