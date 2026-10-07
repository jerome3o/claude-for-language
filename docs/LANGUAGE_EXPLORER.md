# Language explorer

Tap any Chinese character or word where the app shows Chinese to read — and keep going. The
explorer is ONE reusable bottom sheet holding a **stack of views**: a **Character view** (the
character sheet from #527) and a **Word view**. Every character or word shown inside a view is
tappable and pushes another view, so a learner can walk 银行 › 银 › 银子 › 子 › 孩子 and back.

Web: `frontend/src/components/explorer/` · Lab: `ui/explorer/` · pure rules: `shared/explorer/`
(ported to `android-lab/core/…/explorer/`, parity-tested by `android-lab/parity/fixtures/explorer.ts`).

## Navigation (`shared/explorer/stack.ts`)

- `open(item)` starts a fresh stack (a tap on a card, a reader page, a chat bubble…).
- `push(item)` adds a view — a tap inside a view. Pushing the view already on top does nothing;
  pushing one already further down the trail goes back to it (no loops). Depth ≤ 24.
- `pop` = **←**, `popTo(i)` = a breadcrumb, `close` = **✕** / the backdrop / Escape / Android back
  on the first view.
- The header shows **←** (from the second view on), a compact breadcrumb (`breadcrumbTrail`: every
  view while 4 fit, else first … last two) and **✕**. The sheet never goes under the status bar
  and the footer action stays visible (`.sheet-footer` / Lab `SheetScaffold`).
- An item is `{ kind: 'char', char }` or `{ kind: 'word', hanzi, pinyin?, gloss?, sentence? }` —
  the optional fields are what the tapped place already knew (a reader chip's gloss, the sentence
  it sits in). `itemForText` maps a tapped piece of text: 1 Han character → Character view,
  more → Word view, none → nothing.

## Character view

Today's character sheet: readings, meaning, radical, strokes, "#N most common", "Built from …",
✍️ Write it, ✨ More about 字 (online), and "Words with 字" with ✓ Known / 📚 In your decks
(`shared/chars/status.ts`). New: the radical and components are tappable (→ Character view), and
a word row opens the **Word view** (which has Add / ⚡ Study it today) instead of the add sheet.

## Word view (`shared/explorer/word.ts`, `related.ts`)

- **Head**: hanzi, ▶ (the practice TTS path, cached on the device — `getTTSWithCache` / Lab
  `PracticeTts`; offline and never heard → the device voice), pinyin, English, frequency
  (`wordFrequencyLabel`: "#570 most common word" up to rank 30,000 — tiers top ≤ 1,000, common ≤
  5,000, uncommon —, else "Rare word"; from the shipped word-freq list, `shared/decks/frequency.ts`).
- **Characters**: one chip per character with its syllable, coloured by tone (`wordChars`) → the
  Character view.
- **Your card**: "📚 You have this in <deck>" → Open card (the card hub) and ⚡ Study it today; else
  **+ Add as card** (`AddChunkModal`, the top deck of the queue preselected; the "More about"
  explanation's fun facts / sentence go with it when it was loaded).
- **Meaning**: the dictionary senses.
- **Sentence**: the sentence it was tapped in, and up to three of the learner's own cards that
  use the word — each itself explorable.
- **✨ More about this word**: the reader word explanation (`POST /api/reader-words/explain`,
  Haiku, cached on the server and the device) for the word in its sentence (or in the word alone).
  Online only: offline it says "Needs internet".
- **Related words**: other words sharing a character, most common first (`relatedWords`, from the
  characters' "Words with 字" lists), with ✓ Known / 📚 In your decks → the Word view.

Pinyin and meaning are resolved dictionary-first (`resolveWord`): the word dictionary, else a
character record's word list, else the learner's own card, else what the tapped place said.

## Data and offline

| Data | Where | Offline |
| --- | --- | --- |
| Character records | `GET /api/chars?c=` (static shards, #527) → IndexedDB `charDict` / Lab JsonCache; the upcoming queue's characters prefetched hourly | yes once looked up / prefetched |
| Word records | `GET /api/words?w=银行,学生` (≤ 50; `worker/char-dict/words/NNN.dat`, 60,000 most frequent CC-CEDICT words, built by `npm run build:word-dict`) → IndexedDB `wordDict` / Lab JsonCache | yes once looked up; else the character records + cards |
| Frequency ranks | shipped list (`shared/data/frequency/word-freq.txt`) | yes |
| Known / in your decks, examples | the device's notes + cards | yes |
| Word audio | practice TTS, cached per text | once heard |
| More about 字 / this word | Haiku, cached | needs internet the first time |

A Word view opening looks up all its characters in ONE batched call (`prefetchChars`) and the
word in one `GET /api/words`; everything already on the device renders at once.

## Explorable text (`shared/explorer/segments.ts`)

`<ExplorableText text segments? />` (web, `components/explorer/ExplorableText.tsx`) and
`ExplorableText` (Lab) make Chinese tappable: **by word** when the place has word segments that
line up with the text exactly (reader words, chat words, a breakdown), **by character** otherwise.
Inside a view it pushes; elsewhere it opens a fresh stack. Used on:

- the study card's answer side (the hanzi, the typed / multiple-choice answer diff),
- the homework pass answer side (word list hanzi),
- graded reader pages (word chips → Word view with the chip's pinyin / gloss / sentence),
- chat word chips (→ Word view),
- the coach / example-sentence breakdown rows (→ Word view; Add is inside it).

Not inside places where a tap already means something (answer inputs, the call board, games
where tapping is the answer, example-sentence rows that reveal line by line).

## Analytics (`shared/analytics/events.ts`)

`explorer.open` (source, kind), `explorer.push` (kind, from), `explorer.more` (kind),
`explorer.add_card`, `explorer.bump`, `explorer.write`. Ids / enums / counts only.
