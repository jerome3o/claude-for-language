/**
 * The built-in "Starter Chinese" deck a tutor can send with an invite.
 *
 * It is created in the TUTOR's account on first use (so it behaves like any
 * deck they own — editable, shareable, re-sendable) and is idempotent: the
 * deck is found by name, so calling it twice never makes a second copy. The
 * invite then shares it to the student the same way as any other deck.
 *
 * Audio is generated after the response, one note at a time, exactly as a
 * note created through the app gets it (word clip, then the sentence clip).
 */
import { Env, Deck } from '../types';
import { createDeck, createNote, updateNote } from '../db/queries';
import { generateTTS } from './audio';

export const STARTER_DECK_NAME = 'Starter Chinese';
export const STARTER_DECK_DESCRIPTION =
  'Fifteen words to say hello, thank you and sorry, and to answer yes or no. Built-in starter deck.';

export interface StarterWord {
  hanzi: string;
  pinyin: string;
  english: string;
  sentence: string;
  sentence_pinyin: string;
  sentence_translation: string;
}

export const STARTER_WORDS: readonly StarterWord[] = [
  { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello', sentence: '你好！我叫李华。', sentence_pinyin: 'Nǐ hǎo! Wǒ jiào Lǐ Huá.', sentence_translation: 'Hello! My name is Li Hua.' },
  { hanzi: '谢谢', pinyin: 'xièxie', english: 'thank you', sentence: '谢谢你的帮助。', sentence_pinyin: 'Xièxie nǐ de bāngzhù.', sentence_translation: 'Thank you for your help.' },
  { hanzi: '再见', pinyin: 'zàijiàn', english: 'goodbye', sentence: '明天见，再见！', sentence_pinyin: 'Míngtiān jiàn, zàijiàn!', sentence_translation: 'See you tomorrow, goodbye!' },
  { hanzi: '不好意思', pinyin: 'bù hǎoyìsi', english: 'excuse me; sorry (mild)', sentence: '不好意思，请问洗手间在哪里？', sentence_pinyin: 'Bù hǎoyìsi, qǐngwèn xǐshǒujiān zài nǎlǐ?', sentence_translation: 'Excuse me, where is the restroom?' },
  { hanzi: '请', pinyin: 'qǐng', english: 'please', sentence: '请坐。', sentence_pinyin: 'Qǐng zuò.', sentence_translation: 'Please sit down.' },
  { hanzi: '对不起', pinyin: 'duìbuqǐ', english: 'sorry', sentence: '对不起，我来晚了。', sentence_pinyin: 'Duìbuqǐ, wǒ lái wǎn le.', sentence_translation: "Sorry, I'm late." },
  { hanzi: '没关系', pinyin: 'méi guānxi', english: "it doesn't matter; no problem", sentence: '没关系，不用担心。', sentence_pinyin: 'Méi guānxi, bùyòng dānxīn.', sentence_translation: "No problem, don't worry." },
  { hanzi: '我', pinyin: 'wǒ', english: 'I; me', sentence: '我是学生。', sentence_pinyin: 'Wǒ shì xuésheng.', sentence_translation: 'I am a student.' },
  { hanzi: '你', pinyin: 'nǐ', english: 'you', sentence: '你是老师吗？', sentence_pinyin: 'Nǐ shì lǎoshī ma?', sentence_translation: 'Are you a teacher?' },
  { hanzi: '是', pinyin: 'shì', english: 'to be; yes', sentence: '我是中国人。', sentence_pinyin: 'Wǒ shì Zhōngguórén.', sentence_translation: 'I am Chinese.' },
  { hanzi: '不是', pinyin: 'bú shì', english: 'is not; no', sentence: '他不是我的老师。', sentence_pinyin: 'Tā bú shì wǒ de lǎoshī.', sentence_translation: 'He is not my teacher.' },
  { hanzi: '好', pinyin: 'hǎo', english: 'good; okay', sentence: '今天天气很好。', sentence_pinyin: 'Jīntiān tiānqì hěn hǎo.', sentence_translation: 'The weather is very good today.' },
  { hanzi: '不好', pinyin: 'bù hǎo', english: 'not good; bad', sentence: '我今天心情不好。', sentence_pinyin: 'Wǒ jīntiān xīnqíng bù hǎo.', sentence_translation: "I'm in a bad mood today." },
  { hanzi: '老师', pinyin: 'lǎoshī', english: 'teacher', sentence: '王老师很好。', sentence_pinyin: 'Wáng lǎoshī hěn hǎo.', sentence_translation: 'Teacher Wang is very nice.' },
  { hanzi: '明天见', pinyin: 'míngtiān jiàn', english: 'see you tomorrow', sentence: '老师，明天见！', sentence_pinyin: 'Lǎoshī, míngtiān jiàn!', sentence_translation: 'Teacher, see you tomorrow!' },
];

export interface EnsureStarterDeckResult {
  deck: Deck;
  /** True when this call created the deck (and its notes). */
  created: boolean;
  /** Ids of the notes created by this call (empty when the deck already existed). */
  noteIds: string[];
}

/** Find the user's starter deck, or build it. Idempotent by deck name. */
export async function ensureStarterDeck(db: D1Database, userId: string): Promise<EnsureStarterDeckResult> {
  const existing = await db
    .prepare('SELECT * FROM decks WHERE user_id = ? AND name = ? ORDER BY created_at ASC LIMIT 1')
    .bind(userId, STARTER_DECK_NAME)
    .first<Deck>();
  if (existing) {
    return { deck: existing, created: false, noteIds: [] };
  }

  const deck = await createDeck(db, userId, STARTER_DECK_NAME, STARTER_DECK_DESCRIPTION);
  const noteIds: string[] = [];
  for (const word of STARTER_WORDS) {
    const note = await createNote(db, deck.id, word.hanzi, word.pinyin, word.english);
    await updateNote(db, note.id, {
      sentenceClue: word.sentence,
      sentenceCluePinyin: word.sentence_pinyin,
      sentenceClueTranslation: word.sentence_translation,
    });
    noteIds.push(note.id);
  }
  return { deck, created: true, noteIds };
}

/**
 * Word + sentence audio for freshly created starter notes, one at a time.
 * Runs after the response (waitUntil); each failure is logged and skipped so
 * one bad clip never blocks the rest.
 */
export async function generateStarterDeckAudio(env: Env, noteIds: string[]): Promise<void> {
  if (!env.GOOGLE_TTS_API_KEY && !env.MINIMAX_API_KEY) return;

  for (const noteId of noteIds) {
    try {
      const note = await env.DB
        .prepare('SELECT id, hanzi, sentence_clue FROM notes WHERE id = ?')
        .bind(noteId)
        .first<{ id: string; hanzi: string; sentence_clue: string | null }>();
      if (!note) continue;
      const word = await generateTTS(env, note.hanzi, note.id);
      if (word) {
        await updateNote(env.DB, note.id, { audioUrl: word.audioKey, audioProvider: word.provider });
      }
      if (note.sentence_clue) {
        const clue = await generateTTS(env, note.sentence_clue, `${note.id}-sentence`);
        if (clue) {
          await updateNote(env.DB, note.id, { sentenceClueAudioUrl: clue.audioKey, sentenceClueAudioProvider: clue.provider });
        }
      }
    } catch (err) {
      console.error('[starter-deck] Audio failed for note', noteId, err instanceof Error ? err.message : err);
    }
  }
}
