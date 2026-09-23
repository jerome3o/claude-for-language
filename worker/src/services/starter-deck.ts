/**
 * The built-in "Starter Chinese" deck a tutor can send with an invite.
 *
 * It is created in the TUTOR's account on first use (so it behaves like any
 * deck they own — editable, shareable, re-sendable) and is idempotent: the
 * deck is found by name, so calling it twice never makes a second copy. The
 * invite then shares it to the student the same way as any other deck.
 *
 * Audio is generated after the response exactly as a note created through
 * the app gets it (word clip, then the sentence clip), via services/content.
 */
import { Env, Deck } from '../types';
import { createDeck, createNotes, type Background } from './content';

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

/**
 * Find the user's starter deck, or build it. Idempotent by deck name. Notes go
 * through the content service like any other, so word + sentence audio run
 * after the response (`bg`) and the sentence sets are queued.
 */
export async function ensureStarterDeck(env: Env, userId: string, bg?: Background): Promise<EnsureStarterDeckResult> {
  const existing = await env.DB
    .prepare('SELECT * FROM decks WHERE user_id = ? AND name = ? ORDER BY created_at ASC LIMIT 1')
    .bind(userId, STARTER_DECK_NAME)
    .first<Deck>();
  if (existing) {
    return { deck: existing, created: false, noteIds: [] };
  }

  const deck = await createDeck(env.DB, userId, { name: STARTER_DECK_NAME, description: STARTER_DECK_DESCRIPTION });
  const made = await createNotes(
    env,
    userId,
    deck.id,
    STARTER_WORDS.map(word => ({
      hanzi: word.hanzi,
      pinyin: word.pinyin,
      english: word.english,
      sentence_clue: word.sentence,
      sentence_clue_pinyin: word.sentence_pinyin,
      sentence_clue_translation: word.sentence_translation,
    })),
    { audio: 'background', sentences: true, bg }
  );
  if (made.failed.length) console.error('[starter-deck] Some words were not created:', made.failed);
  return { deck, created: true, noteIds: made.created.map(n => n.id) };
}
