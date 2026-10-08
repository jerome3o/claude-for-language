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
- **Android back (the edge swipe) and the browser's back take ONE level off**: a running quick
  drill first, then the top view (like ←); only on the first view does back close the explorer.
  Web: one history entry per level with the same URL (`hooks/useBackLevels.ts`, levels = views +
  1 while drilling) — back pops one entry; ✕ / ← / a crumb / Escape remove the entries again with
  `history.go(-n)`, unless something navigated on top meanwhile (Open card), so the page under
  the explorer never moves. Lab: `LabModalSheet(dismissOnBack = false)` + one `BackHandler` →
  `ExplorerController.back()`; Material3's own sheet back callback (registered on the window on
  API 33+, which wins over any BackHandler under predictive back — on by default on Android 16 at
  targetSdk 36) is off, as that is what closed the whole explorer. The scrim and a swipe down
  still close it.
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

## Frequency decals (`shared/explorer/frequency-tier.ts`)

A thin outline around each word tile ("Words with 字", "Related words") and character tile (the
Character view's glyph, the Word view's character chips, the tappable "Built from" components —
not the radical, often a radical form like 钅) says at a glance how common it is:

| Outline | Rank in the shipped word-freq list |
| --- | --- |
| purple | top 100 |
| green | 101 – 1,000 |
| yellow | 1,001 – 2,000 |
| none | 2,001 – the rare cutoff |
| grey ("rare") | beyond the cutoff, or not in the list |

`frequencyTier(rank, kind)` — words rank against the 30,000-word list, rare beyond **10,000**
(`RARE_WORD_RANK`); characters against the 8,000-character list, rare beyond **3,500**
(`RARE_CHAR_RANK`, the size of 现代汉语常用字表). The rank is one map lookup in the list the app
already loads (web `services/wordFrequency.ts`, Lab `WordFrequency.shipped`); while it loads there
are no decals (never a flash of grey). Port: `core/…/explorer/FrequencyDecal.kt`, parity-tested.

Look: 1.5px (web: `box-shadow: inset`, or the chip's own border + 0.5px; Lab: `Modifier.border`)
so a decal never changes a tile's size. Tokens (web `--freq-*` in `explorer.css`, Lab
`DecalColors`):

| Tier | Light (sheet `#ffffff` / Lab card `#fffdf8`) | Dark (Lab card `#1c1c20`) |
|---|---|---|
| purple · top 100 | `#8b5cf6` 1.5px (4.2:1) | `#a78bfa` 1.5px (6.2:1) |
| green · top 1,000 | `#16a34a` 1.5px (3.3:1) | `#4ade80` 1.5px (9.7:1) |
| yellow · top 2,000 | `#948c00` 2px (3.5:1 on white, 3.4:1 on the Lab card, 3.25:1 on its fill) around a `#fef9c3` fill | `#fde047` 2px (12.9:1), no fill |
| grey · rare | `#9ca3af` 1.5px (2.5:1, the quietest on purpose) | `#71717a` 1.5px (3.5:1) |

**Yellow = common, and it is lemon yellow**: it was orange (`#ea580c`) until Oct 2026, which read
as gold / "rare", then `#a89000` on `#fef08a` (light) / `#facc15` (dark), which still read
orange on the Lab's dark card. A pure yellow line can't reach 3:1 on white (anything bright
enough to read yellow is under 2:1, and darkening it turns it gold), so on light the yellow tier
is a 2px lemon-olive outline around a pale lemon fill — the fill is what reads yellow (web: a
`background-image` layer over the tile's own background; Lab: `DecalStyle.fill`). On dark
`#fde047` (yellow-300) is lemon on its own; no fill there, because any yellow tint over the dark
card comes out khaki and pulls it back towards gold. The web app is light-only, so the dark set
applies only under an explicit `data-theme="dark"`. An **ⓘ** next
to the list header opens the one-line key: "purple top 100 · green top 1,000 · yellow top 2,000 · grey rare".

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

## Mini drills (`shared/explorer/drill.ts`)

**🎯 Quick drill** on a Character view (target = the character, pool = its words) and a Word view
(target = the word, pool = its related words) — shown only when `buildDrill(target, pool, 1)` makes
one. 3–5 questions from what is on screen, in order: **meaning** (hanzi → pick the English),
**listen** (hear it → pick the word; cached practice TTS), **tone** of the character(s) in the word
(5 buttons), **reverse** (English → pick the word, when room) and **✍️ write** it on the stroke-order
pad (perfect / good counts; Skip allowed). Options: the answer + up to 3 distractors from the pool,
shuffled with a seeded mulberry32 (`seededRandom`) so the Lab port (`core/…/explorer/Drill.kt`) is
parity-tested. Instant right / wrong feedback, pinyin after answering, a score line
(`drillScoreLine`) with confetti at ≥ 60 %. The drill replaces the sheet's body; moving in the stack
ends it. **Practice only**: no review events, no scheduling — results are analytics
(`explorer.drill_start` / `drill_finish`). Works offline whenever the view itself does (audio /
stroke data once cached).

## Analytics (`shared/analytics/events.ts`)

`explorer.open` (source, kind), `explorer.push` (kind, from), `explorer.more` (kind),
`explorer.add_card`, `explorer.bump`, `explorer.write`, `explorer.drill_start` (kind, items), `explorer.drill_finish` (kind, items, correct, duration_ms). Ids / enums / counts only.
