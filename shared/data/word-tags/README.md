# Word-tag lexicon

`word-tags.txt` is the data behind the small tags on a card's answer side and in the language
explorer's Word view — part of speech, separable verb, register (polite / colloquial / literary…),
measure word, HSK level, traditional form (docs/STUDY_SESSION.md "Word tags"). The tagger that
reads it is `shared/cards/word-tags.ts` (Lab: `core/…/cards/WordTags.kt`, parity-tested). No AI
is involved: every tag comes from the open data below.

- **Contents:** ~45,000 words and characters — the word dictionary's headwords (CC-CEDICT ∩
  wordfreq, ranked within the top 60,000), the frequency list's words and 8,000 characters, every
  HSK 3.0 word and the curated lists. About 580 kB, 250 kB gzipped. Format: header comments, then
  `#words` (`hanzi<TAB>pos<TAB>register<TAB>measures<TAB>hsk<TAB>traditional<TAB>separable example`,
  trailing blanks trimmed) and `#markers` (`text<TAB>register`, looked for inside sentence cards).
- **Rebuild:** `npm run build:word-tags` (downloads the sources into `scripts/.cache`; rules in
  `shared/cards/word-tags-build.ts`, curated lists in `shared/cards/word-tags-curated.ts`).

## Sources and licences

| Data | Used for | Licence |
|---|---|---|
| [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cedict) | register labels in the first sense — `(coll.)`, `(literary)`, `(formal)`, `(polite)` / `(honorific)` / `(courteous)`, `(derog.)`, `(vulgar)` / `(taboo …)`, `(slang)`, `(dialect)`, `(Tw)`, `(Cantonese)` / `(HK)`, `(old)` / `(archaic)`, `(humorous)`, `(euphemism)` — on words of 2+ characters; measure words (`CL:`); `(idiom)`; "classifier for …"; traditional forms | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| [HanLP 1.x](https://github.com/hankcs/HanLP/tree/1.x) `data/dictionary/CoreNatureDictionary.txt` | part of speech (tag counts from an annotated corpus; `vi` = intransitive verb) | [Apache-2.0](https://github.com/hankcs/HanLP/blob/1.x/LICENSE) |
| [jieba](https://github.com/fxsjy/jieba) `jieba/dict.txt` | part of speech when HanLP has none | [MIT](https://github.com/fxsjy/jieba/blob/master/LICENSE) |
| [complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) `complete.json` | HSK 3.0 (2021) level, `new-1` … `new-7` (= 7–9) | [MIT](https://github.com/drkameleon/complete-hsk-vocabulary/blob/main/LICENSE) |
| Curated in this repo (`shared/cards/word-tags-curated.ts`) | separable verbs (离合词) with a split example; register of everyday polite / informal / slang / rude words the dictionaries don't mark; the sentence markers | this repository |

The derived file is shared under CC BY-SA 4.0 (the CC-CEDICT share-alike terms); credited on the
app's Licences page with the character dictionary. The web app imports it lazily as a precached
chunk (`frontend/src/services/wordTags.ts`); the Lab app reads the same file as a core classpath
resource (`/word-tags/word-tags.txt`). Nothing is fetched during study.
