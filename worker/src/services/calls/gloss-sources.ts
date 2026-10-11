/**
 * The dictionaries behind the board gloss's pinyin check (gloss-pinyin.ts): the character
 * dictionary's CC-CEDICT readings and the word dictionary's word pinyin, read from the worker's
 * static assets (CHAR_DICT, services/char-dict.ts) and kept in memory per isolate. Only asked
 * about the few characters / words whose pinyin looks wrong, so a normal gloss reads nothing.
 * Without the binding (tests, local dev without assets) both answer {} and pinyin-pro alone decides.
 */

import { assetsShardLoader, getCharRecords, getWordRecords } from '../char-dict';
import type { GlossReadingSources } from './gloss-pinyin';

export function glossReadingSources(assets: Fetcher | undefined): GlossReadingSources {
  if (!assets) return {};
  const loader = assetsShardLoader(assets);
  return {
    charReadings: async (chars) => {
      const { records } = await getCharRecords(loader, chars);
      const out: Record<string, string[]> = {};
      for (const [ch, r] of Object.entries(records)) out[ch] = r.readings.map((x) => x.pinyin);
      return out;
    },
    wordPinyin: async (words) => {
      const { records } = await getWordRecords(loader, words);
      const out: Record<string, string> = {};
      for (const [w, r] of Object.entries(records)) out[w] = r.pinyin;
      return out;
    },
  };
}
