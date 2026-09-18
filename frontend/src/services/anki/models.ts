/**
 * The two Anki note types this app exports.
 *
 * - "汉语学习 Vocabulary": one note per word, three card templates mirroring
 *   the app's own card types (Hanzi → Meaning, Meaning → Hanzi, Audio → Hanzi).
 *   The audio card is only generated when the note has audio — both through
 *   the `req` table (what Anki ≤ 2.1.27 and the importer consult) and the
 *   `{{#Audio}}…{{/Audio}}` conditional on its front (what newer Anki uses to
 *   decide a card would be blank).
 * - "汉语学习 Sentence": one note per sentence with a single Chinese → English
 *   card, used for reader pages and lesson example sentences.
 *
 * Field and template NAMES are part of the schema hash Anki compares on
 * import; changing them makes Anki treat the type as new and stop updating
 * existing notes. Change the HTML/CSS freely, not the names.
 */

import { stableId } from './hash';

export type AnkiModelKey = 'vocabulary' | 'sentence';

export interface AnkiTemplate {
  name: string;
  qfmt: string;
  afmt: string;
  /** Fields that must be non-empty for this card to exist (Anki's `req`). */
  requires: string[];
}

export interface AnkiModel {
  key: AnkiModelKey;
  id: number;
  name: string;
  fields: string[];
  templates: AnkiTemplate[];
  css: string;
}

const ID_NAMESPACE = 'chinese-learning-app:model';

const SHARED_CSS = `
.card {
  font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif;
  font-size: 20px;
  line-height: 1.45;
  text-align: center;
  padding: 16px 12px;
}
.hanzi { font-size: 56px; line-height: 1.25; margin: 0.2em 0; }
.pinyin { color: #888; font-size: 22px; margin: 0.15em 0; }
.english { font-size: 22px; margin: 0.15em 0; }
.prompt { font-size: 30px; margin: 0.3em 0; }
.prompt-hint { color: #888; font-size: 16px; margin-top: 0.5em; }
.sentence { margin-top: 1.1em; padding-top: 0.8em; border-top: 1px solid rgba(128,128,128,0.35); }
.sentence .zh { font-size: 26px; line-height: 1.4; }
.sentence .py { color: #888; font-size: 16px; }
.sentence .en { font-size: 17px; margin-top: 0.15em; }
.notes { color: #888; font-size: 15px; text-align: left; margin-top: 1.1em; white-space: pre-wrap; }
.sentence-zh { font-size: 30px; line-height: 1.5; margin: 0.2em 0; }
.sentence-py { color: #888; font-size: 18px; }
.sentence-en { font-size: 20px; margin-top: 0.3em; }
hr#answer { border: none; border-top: 1px solid rgba(128,128,128,0.35); margin: 0.9em 0; }
`.trim();

const SENTENCE_BLOCK = `{{#Sentence}}<div class="sentence"><div class="zh">{{Sentence}}</div>{{#SentencePinyin}}<div class="py">{{SentencePinyin}}</div>{{/SentencePinyin}}{{#SentenceEnglish}}<div class="en">{{SentenceEnglish}}</div>{{/SentenceEnglish}}{{SentenceAudio}}</div>{{/Sentence}}`;
const NOTES_BLOCK = `{{#Notes}}<div class="notes">{{Notes}}</div>{{/Notes}}`;

export const VOCABULARY_MODEL: AnkiModel = {
  key: 'vocabulary',
  id: stableId(ID_NAMESPACE, '汉语学习 Vocabulary'),
  name: '汉语学习 Vocabulary',
  fields: ['Hanzi', 'Pinyin', 'English', 'Audio', 'Sentence', 'SentencePinyin', 'SentenceEnglish', 'SentenceAudio', 'Notes', 'SourceId'],
  templates: [
    {
      name: 'Hanzi → Meaning',
      requires: ['Hanzi'],
      qfmt: `<div class="hanzi">{{Hanzi}}</div>`,
      afmt: `{{FrontSide}}<hr id=answer><div class="pinyin">{{Pinyin}}</div><div class="english">{{English}}</div>{{Audio}}${SENTENCE_BLOCK}${NOTES_BLOCK}`,
    },
    {
      name: 'Meaning → Hanzi',
      requires: ['English'],
      qfmt: `<div class="english prompt">{{English}}</div><div class="prompt-hint">Write the characters</div>`,
      afmt: `{{FrontSide}}<hr id=answer><div class="hanzi">{{Hanzi}}</div><div class="pinyin">{{Pinyin}}</div>{{Audio}}${SENTENCE_BLOCK}${NOTES_BLOCK}`,
    },
    {
      name: 'Audio → Hanzi',
      requires: ['Audio'],
      qfmt: `{{#Audio}}<div class="prompt">🔊</div>{{Audio}}<div class="prompt-hint">What did you hear? Write the characters</div>{{/Audio}}`,
      afmt: `{{FrontSide}}<hr id=answer><div class="hanzi">{{Hanzi}}</div><div class="pinyin">{{Pinyin}}</div><div class="english">{{English}}</div>${SENTENCE_BLOCK}${NOTES_BLOCK}`,
    },
  ],
  css: SHARED_CSS,
};

export const SENTENCE_MODEL: AnkiModel = {
  key: 'sentence',
  id: stableId(ID_NAMESPACE, '汉语学习 Sentence'),
  name: '汉语学习 Sentence',
  fields: ['Chinese', 'Pinyin', 'English', 'Audio', 'SourceId'],
  templates: [
    {
      name: 'Chinese → English',
      requires: ['Chinese'],
      qfmt: `<div class="sentence-zh">{{Chinese}}</div>{{Audio}}`,
      afmt: `{{FrontSide}}<hr id=answer><div class="sentence-py">{{Pinyin}}</div><div class="sentence-en">{{English}}</div>`,
    },
  ],
  css: SHARED_CSS,
};

export const MODELS: Record<AnkiModelKey, AnkiModel> = {
  vocabulary: VOCABULARY_MODEL,
  sentence: SENTENCE_MODEL,
};

/** Template ordinal for each of the app's card types (Vocabulary model). */
export const CARD_TYPE_ORD: Record<'hanzi_to_meaning' | 'meaning_to_hanzi' | 'audio_to_hanzi', number> = {
  hanzi_to_meaning: 0,
  meaning_to_hanzi: 1,
  audio_to_hanzi: 2,
};
