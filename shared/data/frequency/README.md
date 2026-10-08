# Word frequency list

`word-freq.txt` is the word and character frequency list behind **Most common first**
(Settings → New cards → Order new cards by; `shared/decks/new-card-order.ts`,
format and ranking in `shared/decks/frequency.ts`).

- **Source:** [wordfreq](https://github.com/rspeer/wordfreq) `large_zh` by Robyn Speer and contributors.
- **Licence:** the wordfreq data is licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/);
  this derived list is shared under the same licence. Credited on the app's Licences page.
- **Contents:** the 30,000 most frequent all-Han words (one per line, most frequent first) and the
  8,000 most frequent characters (ranked by summed word frequency). About 250 kB, 150 kB gzipped.
- **Rebuild:** `npm run build:word-freq` (downloads `large_zh.msgpack.gz` into `scripts/.cache`).

`segment-words.txt` sits beside it for the word segmenter (`shared/chinese/segment.ts`, word chips without an LLM):
the word dictionary's CC-CEDICT headwords that aren't in `word-freq.txt`, with their wordfreq rank, and the list's
jieba compounds. Same sources and licence (CC-CEDICT and wordfreq, CC BY-SA 4.0). Rebuild: `npm run build:segment-words`.

The web app loads it as a lazily imported, precached chunk (`frontend/src/services/wordFrequency.ts`);
the Lab app reads the same file as a core classpath resource (`android-lab/core/build.gradle.kts`,
`WordFrequency.shipped`). No network is used during study.
