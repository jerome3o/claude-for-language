import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { buildApkg, readApkg, templateApplies, ankiDeckId, type ApkgInput } from './apkg';
import { MODELS, VOCABULARY_MODEL, SENTENCE_MODEL } from './models';
import { guidFor, stableId, sha1Hex, fieldChecksum, stripHtmlMedia } from './hash';

let sql: SqlJsStatic;
beforeAll(async () => {
  sql = await initSqlJs();
});

const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);

function fixture(): ApkgInput {
  return {
    deckName: 'HSK 1 Test',
    deckDescription: 'fixture',
    notes: [
      {
        model: 'vocabulary',
        guid: guidFor('note', 'n1'),
        fields: {
          Hanzi: '你好', Pinyin: 'nǐ hǎo', English: 'hello', Audio: '[sound:aaa.mp3]',
          Sentence: '你好吗？', SentencePinyin: 'nǐ hǎo ma', SentenceEnglish: 'How are you?', SentenceAudio: '[sound:bbb.mp3]',
          Notes: 'The most common greeting', SourceId: 'note:n1',
        },
        tags: ['chinese-learning', 'deck'],
      },
      {
        // No audio: must produce only two cards.
        model: 'vocabulary',
        guid: guidFor('note', 'n2'),
        fields: { Hanzi: '谢谢', Pinyin: 'xiè xie', English: 'thanks', SourceId: 'note:n2' },
        progress: {
          0: { state: 'review', intervalDays: 12, ease: 2.5, reps: 5, lapses: 1, dueInDays: 3 },
          1: { state: 'learning', intervalDays: 0, ease: 2.5, reps: 1, lapses: 0, dueInDays: 0 },
        },
      },
      {
        model: 'sentence',
        guid: guidFor('sentence', '我很好'),
        fields: { Chinese: '我很好', Pinyin: 'wǒ hěn hǎo', English: 'I am fine', Audio: '[sound:aaa.mp3]', SourceId: 'lesson:x:我很好' },
      },
    ],
    media: [
      { filename: 'aaa.mp3', data: new Uint8Array([1, 2, 3]) },
      { filename: 'bbb.mp3', data: new Uint8Array([4, 5, 6, 7]) },
    ],
  };
}

describe('hash helpers', () => {
  it('produces stable ids in the genanki range', () => {
    const id = stableId('ns', 'name');
    expect(id).toBe(stableId('ns', 'name'));
    expect(id).toBeGreaterThanOrEqual(1 << 30);
    expect(id).toBeLessThan(2 ** 31);
    expect(stableId('ns', 'other')).not.toBe(id);
  });

  it('produces stable 10-char GUIDs', () => {
    expect(guidFor('note', 'abc')).toHaveLength(10);
    expect(guidFor('note', 'abc')).toBe(guidFor('note', 'abc'));
    expect(guidFor('note', 'abc')).not.toBe(guidFor('note', 'abd'));
  });

  it('computes SHA-1 and Anki field checksums', () => {
    expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(sha1Hex(new Uint8Array(100).fill(0x61))).toBe(sha1Hex('a'.repeat(100)));
    expect(fieldChecksum('<b>abc</b>[sound:x.mp3]')).toBe(parseInt('a9993e36', 16));
    expect(stripHtmlMedia('a &amp; b<br>')).toBe('a & b');
  });
});

describe('models', () => {
  it('only generates the audio card when Audio is filled, via req and a template conditional', () => {
    expect(templateApplies(VOCABULARY_MODEL, 2, { Hanzi: '你', Audio: '' })).toBe(false);
    expect(templateApplies(VOCABULARY_MODEL, 2, { Hanzi: '你', Audio: '[sound:a.mp3]' })).toBe(true);
    expect(VOCABULARY_MODEL.templates[2].qfmt).toMatch(/^\{\{#Audio\}\}[\s\S]*\{\{\/Audio\}\}$/);
    expect(VOCABULARY_MODEL.templates[2].requires).toEqual(['Audio']);
  });

  it('has the documented field lists', () => {
    expect(VOCABULARY_MODEL.fields).toEqual(['Hanzi', 'Pinyin', 'English', 'Audio', 'Sentence', 'SentencePinyin', 'SentenceEnglish', 'SentenceAudio', 'Notes', 'SourceId']);
    expect(SENTENCE_MODEL.fields).toEqual(['Chinese', 'Pinyin', 'English', 'Audio', 'SourceId']);
    expect(MODELS.vocabulary.id).not.toBe(MODELS.sentence.id);
  });
});

describe('buildApkg', () => {
  it('writes a collection Anki can read back: notes, cards, media', async () => {
    const built = await buildApkg(fixture(), { sql, now: NOW });
    expect(built.noteCount).toBe(3);
    // n1: 3 cards, n2: 2 cards (no audio), sentence: 1 card
    expect(built.cardCount).toBe(6);
    expect(built.mediaCount).toBe(2);

    const { db, media, files } = await readApkg(built.bytes, sql);
    try {
      expect(media).toEqual({ '0': 'aaa.mp3', '1': 'bbb.mp3' });
      expect(Array.from(files['bbb.mp3'])).toEqual([4, 5, 6, 7]);

      const col = db.exec('SELECT ver, crt, models, decks, conf FROM col')[0].values[0];
      expect(col[0]).toBe(11);
      const models = JSON.parse(col[2] as string);
      const vocab = models[String(VOCABULARY_MODEL.id)];
      expect(vocab.name).toBe('汉语学习 Vocabulary');
      expect(vocab.tmpls.map((t: { name: string }) => t.name)).toEqual(['Hanzi → Meaning', 'Meaning → Hanzi', 'Audio → Hanzi']);
      expect(vocab.req).toEqual([[0, 'all', [0]], [1, 'all', [2]], [2, 'all', [3]]]);
      expect(vocab.css).toContain('PingFang SC');
      expect(models[String(SENTENCE_MODEL.id)].tmpls).toHaveLength(1);

      const decks = JSON.parse(col[3] as string);
      const deckId = ankiDeckId('HSK 1 Test');
      expect(decks[String(deckId)].name).toBe('HSK 1 Test');
      expect(decks[String(deckId)].desc).toBe('fixture');
      expect(JSON.parse(col[4] as string).nextPos).toBe(4);

      const notes = db.exec('SELECT guid, mid, flds, sfld, csum, tags FROM notes ORDER BY id')[0].values;
      expect(notes).toHaveLength(3);
      expect(notes[0][0]).toBe(guidFor('note', 'n1'));
      expect(notes[0][1]).toBe(VOCABULARY_MODEL.id);
      const flds = (notes[0][2] as string).split('');
      expect(flds).toHaveLength(10);
      expect(flds[0]).toBe('你好');
      expect(flds[3]).toBe('[sound:aaa.mp3]');
      expect(flds[7]).toBe('[sound:bbb.mp3]');
      expect(notes[0][3]).toBe('你好');
      expect(notes[0][4]).toBe(fieldChecksum('你好'));
      expect(notes[0][5]).toBe(' chinese-learning deck ');
      expect(notes[2][1]).toBe(SENTENCE_MODEL.id);

      const cards = db.exec('SELECT nid, ord, did, type, queue, due, ivl, factor, reps, lapses FROM cards ORDER BY id')[0].values;
      expect(cards.map(c => c[1])).toEqual([0, 1, 2, 0, 1, 0]);
      expect(new Set(cards.map(c => c[2]))).toEqual(new Set([deckId]));
      // n1 is new: type 0, queue 0, due = position
      expect(cards[0].slice(3, 6)).toEqual([0, 0, 1]);
      // n2 card 0 is a review due in 3 days with a 12-day interval and ease 2500
      const todayDays = Math.floor((Math.floor(NOW / 1000) - 1411124400) / 86400);
      expect(cards[3].slice(3)).toEqual([2, 2, todayDays + 3, 12, 2500, 5, 1]);
      // n2 card 1 was learning: approximated as a review due today, 1-day interval
      expect(cards[4].slice(3, 7)).toEqual([2, 2, todayDays, 1]);
    } finally {
      db.close();
    }
  });

  it('is deterministic for the same source and clock', async () => {
    const a = await buildApkg(fixture(), { sql, now: NOW });
    const b = await buildApkg(fixture(), { sql, now: NOW });
    const ra = await readApkg(a.bytes, sql);
    const rb = await readApkg(b.bytes, sql);
    try {
      expect(ra.db.exec('SELECT guid, mid, flds FROM notes')).toEqual(rb.db.exec('SELECT guid, mid, flds FROM notes'));
      expect(ra.db.exec('SELECT did, ord, due FROM cards')).toEqual(rb.db.exec('SELECT did, ord, due FROM cards'));
    } finally {
      ra.db.close();
      rb.db.close();
    }
  });

  it('skips duplicate GUIDs and empty note lists still produce a valid file', async () => {
    const input = fixture();
    input.notes.push({ ...input.notes[0] });
    const built = await buildApkg(input, { sql, now: NOW });
    expect(built.noteCount).toBe(3);

    const empty = await buildApkg({ deckName: 'Empty', notes: [], media: [] }, { sql, now: NOW });
    const { db } = await readApkg(empty.bytes, sql);
    try {
      expect(db.exec('SELECT count(*) FROM notes')[0].values[0][0]).toBe(0);
      expect(db.exec('SELECT count(*) FROM col')[0].values[0][0]).toBe(1);
    } finally {
      db.close();
    }
  });
});
