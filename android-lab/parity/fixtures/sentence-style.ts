/**
 * Golden vectors for "Example sentence style" (shared/study/sentenceStyle.ts): the choices, the default, the
 * Settings words and how a stored value is read. Writes sentence-style.json; core SentenceStyleParityTest
 * asserts SentenceStyle.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_SENTENCE_STYLE,
  SENTENCE_STYLES,
  SENTENCE_STYLE_COPY,
  SENTENCE_STYLE_NOTE,
  isSentenceStyle,
  sentenceStyleOf,
} from '../../../shared/study/sentenceStyle';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: sentence-style <out-dir>');
mkdirSync(OUT, { recursive: true });

const values: Array<string | null> = [null, '', 'standard', 'everyday', 'casual', 'Casual', 'formal', 'slang', ' casual'];

writeFileSync(
  join(OUT, 'sentence-style.json'),
  JSON.stringify(
    {
      styles: SENTENCE_STYLES,
      default: DEFAULT_SENTENCE_STYLE,
      note: SENTENCE_STYLE_NOTE,
      copy: SENTENCE_STYLES.map((s) => ({ style: s, label: SENTENCE_STYLE_COPY[s].label, description: SENTENCE_STYLE_COPY[s].description })),
      read: values.map((v) => ({ v, is: isSentenceStyle(v), style: sentenceStyleOf(v) })),
    },
    null,
    2
  )
);
