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

**Is the character itself a card?** (Oct 2026 — "it's hard to tell if I already have a card for a
single character"). Right under the glyph, before anything else: **📚 You have 性 as a card in
<deck>** (or **✓ Known — you have 性 as a card in <deck>** when a card of it is mature) with
**Open card →** (the card hub) and **⚡ Study it today**; else **+ Add 性 as a card** (the add-card
sheet, the character's first reading and meaning filled in); "📚 Checking your cards…" while the
device is read. The rule is `charOwnCards` (`shared/chars/status.ts`, Lab `CharWords.ownCards`,
parity-tested in `parity/fixtures/char-words.ts`): a note whose spelling (`noteKey`: punctuation /
spaces ignored) is exactly that ONE Han character — 性, not 人性 — in a live deck; known = a mature
card (Review, stability > 21 d), like the "Words with 字" rows. Copy: `ownCardLine`,
`addOwnCardLabel`. Web: the Word view's card tie-in, extracted as `components/explorer/CardTieIn.tsx`,
used by both views; data `ownCardsFor` (`services/charDict.ts`). Lab: `ui/explorer/OwnCardBlock.kt`
(`CharacterSheetContent(afterHead = …)`), `CharDict.ownCards` → `ExplorerEnv.ownCards`. Icon +
words; the tint only repeats them.

## Word view (`shared/explorer/word.ts`, `related.ts`)

- **Head**: hanzi, ▶ (the practice TTS path, cached on the device — `getTTSWithCache` / Lab
  `PracticeTts`; offline and never heard → the device voice), pinyin, English, frequency
  (`wordFrequencyLabel`: "#570 most common word" up to rank 30,000 — tiers top ≤ 1,000, common ≤
  5,000, uncommon —, else "Rare word"; from the shipped word-freq list, `shared/decks/frequency.ts`).
- **Word tags** under the head: the same pills as the card's answer side (part of speech, separable
  verb, register, measure word, HSK level, traditional form — docs/STUDY_SESSION.md "Word tags"),
  minus how common (the chip above already says it). Web `components/wordTags/WordTagPills.tsx`
  (`exclude={['frequency']}`), Lab `WordTagsFor(…, exclude = {"frequency"})`.
- **Pinyin per character** (`shared/pinyin/wordSyllables.ts`, Lab `core/…/WordSyllables.kt`,
  parity-tested in the `explorer` fixture). The head's pinyin comes, in order, from: the word
  dictionary (trusted) → the character records' word lists (trusted, only cut into syllables) → the
  learner's card or the place it was tapped in (a reader chip's pinyin — Claude's —, CHECKED) → the
  device's own reading. The check (`checkWordPinyin`, through `resolveWord(…, { device })`): the
  pinyin is cut into exactly one syllable per Han character (`alignWordSyllables` — every possible
  cut, the one with the fewest syllables its character can never have, then the fewest syllables
  starting with a vowel inside a word without an apostrophe; a syllable ending in r may also cover a
  following 儿, nǎr); a syllable no reading of its character allows is replaced by the device's
  reading of that character, only that syllable changing ("wúnóngkuǎnyǔ" → "wúnóngruǎnyǔ": 软 is
  never kuǎn); pinyin that can't be lined up at all (wrong count, tone numbers, not pinyin), or more
  than half wrong, gives way to the device's reading of the whole word, written as one word
  ("xī'ān"). A real reading is never replaced (银行 "yínxíng" stays: 行 can be xíng). The device's
  readings: web `devicePinyin(charRecords)` (`utils/autoPinyin.ts`: pinyin-pro's `polyphonic` + the
  character records on the device; the auto-pinyin = pinyin-pro + the 一 / 不 rule), Lab
  `Pinyin.readings` + the character records, `ToneChange.autoPinyin`. Jerome's bug (Nov 2026):
  a reader chip 吴侬软语 (not in the 60k word dictionary) carried Haiku's "wúnóngkuǎnyǔ", and the
  old greedy split gave wún | óng | kuǎn | yǔ. The server now checks the chips' pinyin too
  (docs/READERS.md "Reader word chips").
- **Characters**: one chip per character with its syllable, coloured by tone (`wordChars`, which
  cuts the pinyin per character the same way even without the device's readings) → the
  Character view. A character that is a card of its own carries a small badge in the chip's corner —
  **📚** (in your decks) or **✓** (known), `OWN_CARD_BADGE` — and says it in the chip's label
  (`charChipLabel`: "The character 学, xué — you have it as a card, known"); same rule as the
  Character view's line.
- **Your card**: "📚 You have this in <deck>" → Open card (the card hub) and ⚡ Study it today; else
  **+ Add as card**: ONE tap, no deck picker. The card goes straight into the source deck of where the
  explorer was opened: a reader → "From readers", a chat → "From chats", the Coach / a Claude chat →
  "From Claude", sentence breakdowns and the Sentence round → "From example sentences", practice screens → "From lessons &
  practice", anywhere else → "From the explorer" (`sourceDeckForExplorer`; docs/STUDY_SESSION.md
  "Source decks"). The footer says "✓ Added to From readers · Change", and Change moves the note. The
  "More about" explanation's fun facts and sentence go with it when they were loaded. **Right after an add** the
  footer says "✓ Added to <deck>" with ⚡ Study it today (web: + Open card →) at once — the new note
  reaches the device only with the sync the add starts (web `AddChunkModal` → `onAdded(AddedCard)` +
  `syncService.syncInBackground()`, `CardTieIn`; Lab `AddChunkSheet.onAddedTo` → `ExplorerHost`'s
  `justAdded`, Room read again every 1.5 s until the card is there); the bump goes by the new note's
  id (web) / the word + that deck (Lab), which the server already has. Same on the Character view's
  "+ Add 性 as a card". Analytics `explorer.bump { just_added: true }`. (Before: "+ Add" again, or
  "✓ Added — after the next sync", until the explorer was closed and reopened.)
- **Adding before the meaning has loaded** (`shared/explorer/addCard.ts`, Lab core
  `explorer/ExplorerAdd.kt`, parity-tested `parity/fixtures/explorer-add.ts`; Nov 2026 — a fast tap from
  the ＋ Add tab failed with the server's "english is required"): the tap first WAITS for the view's
  in-flight lookups (the word dictionary and the character records, ≤ 8 s, `EXPLORER_ADD_WAIT_MS`) with
  the button saying **Adding…**, resolves the word again, then `explorerAddStep`: a meaning → add; none
  (a word outside the 60k list) → the gloss path (`POST /api/ai/gloss-words`, Haiku) fills it; still none,
  or **offline** → the **fill sheet**: "What does 吴侬软语 mean?", why it asks ("You're offline, so the
  meaning can't be looked up…" / "The dictionary doesn't have this word…"), the pinyin and the meaning to
  type; Add waits for a meaning and a connection ("Waiting for a connection…"). Missing pinyin is always
  the device's reading (auto-pinyin + the 一 / 不 rule), never the gloss's. Web: `CardTieIn`'s
  `MeaningFill` in the explorer's footer; Lab: `ExplorerAddFlow.kt` → `AddChunkSheet(fill = …)`. The
  Character view's "+ Add 性 as a card" does the same. Analytics `explorer.add_gloss { kind, found }`,
  `explorer.add_fill { kind, reason }`.
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

## Card variants — where each card of the word stands

Jerome (Nov 2026): "If I've already got a card, in this lookup view, from anywhere really, I'd love three little
buttons that show me where I'm at with each variation of the card, like the answer card ⋯ menu." Under "📚 You have
this in <deck>" (Word view) and the Character view's "📚 You have 性 as a card…" line, ONE compact row of the study
card ⋯ menu's tiles (`shared/decks/sibling-status.ts`, the same rule and words — never forked): **读 Read · 写 Write ·
听 Listen**, each with its status (Not started · New · in today's queue · Learning · Due today · Review · next in 12d ·
Known · next in 3mo · Suspended · Snoozed until … · Leech · missed 9×) and the 3-step strength bar; a dashed tile for a
type the word lacks ("No listening card (no audio)"). Here EVERY card of the note shows (`siblingTiles(cards, '', …)` —
no card is on screen), for the note the banner points at (its Open card →); "in today" = the cards the ⚡ pocket holds
for that note (`bumpedCardsForNote`). Computed on the device from the replayed card state + holds, so it works offline.

A tap opens that card's panel in place (a second tap closes it): **⚡ Study it today** — the ⋯ menu's card-level bump
(`bumpCardTypes(note, [type], 'explorer')`; "(review early)" for a started card; greyed with the reason when it is
already due / in today / held) — and **Unsuspend / Wake now** for a held card. After ⚡ the line under the row says
"⚡ English → 汉字 added to today" and the tile turns "New · in today's queue". During a study session the bumped card
is taken in like any explorer bump (`takeSessionBumps`: an unstarted word's card next, a started word's into the ⚡
mix, never right after its sibling). The footer's one-tap ⚡ Study it today (`studyTodayPlan`) is unchanged. Snooze /
Suspend / Forget stay on the card hub (Open card →) and the ⋯ menu.

Web `components/explorer/CardVariants.tsx` (in `CardTieIn`, so every opener has it), Lab `ui/explorer/CardVariants.kt`
(`ExplorerEnv.wordCards` / `bumpCardType` / `releaseCard`; `WordViewActions.cardExtras`, `OwnCardBlock(extras)`).
Analytics `explorer.card_variant_open` (kind, card_type, status), `explorer.card_variant_action` (kind, card_type,
action = bump | unsuspend | wake).

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
| grey ("rare") | beyond the cutoff, or not in the list — **never for an HSK word** |

`frequencyTier(rank, kind, hsk)` — words rank against the 30,000-word list, rare beyond **10,000**
(`RARE_WORD_RANK`); characters against the 8,000-character list, rare beyond **3,500**
(`RARE_CHAR_RANK`, the size of 现代汉语常用字表). **An HSK-listed word or character is never grey**:
the list is built from mostly written text, so it ranks ~3,800 HSK words (一块儿, 一下儿, 打包…)
and a few HSK characters (拎, 涮, 遛…) as rare; they get no outline instead. `hsk` is the level from
the word-tag lexicon (`hskLevel(lexicon, text)`, `shared/cards/word-tags.ts`; a character = its
level as a one-character word) — the same rule as the card's frequency pill (docs/STUDY_SESSION.md
"Word tags"), so a tile and a card never disagree. The rank is one map lookup in the list the app
already loads (web `services/wordFrequency.ts`, Lab `WordFrequency.shipped`), the level one in the
lexicon (web `useDecalIndex` waits for both; Lab `shippedDecals`, the lexicon warmed at app start);
while they load there are no decals (never a flash of grey). Port: `core/…/explorer/FrequencyDecal.kt`
+ `WordTags.hskLevel`, parity-tested. A note's AI "Everyday speech" verdict also drops its card's
Rare pill, but explorer tiles aren't notes, so decals don't use it.

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

**The card tie-in never shows nothing.** While the learner's own cards are still being read the
footer says "📚 Checking your cards…" (web `explorer-checking-cards`; Lab `EXPLORER_MINE_LOADING_TAG`
row + a disabled footer pill) — never "+ Add as card" for a word they have — and the right
section (📚 You have this · Open card · ⚡ Study it today, or + Add as card) replaces it as soon as
the lookup answers. Each of the Word view's loads (dictionary, characters, cards, idiom, More
about) applies its result to the state as it is when it lands: in the Lab app the dictionary
lookup used to write back a copy of the state taken before its (network) call, wiping the card
that had arrived meanwhile — the first open of a word showed no card section, a second one did
(Oct 2026, podcast player). The Lab app keeps the learner's notes as a warm in-memory index
(`ExplorerData.index`, rebuilt when Room's `notes` / `decks` change; read fresh after an add),
built when a screen with tappable Chinese shows (`rememberExplorerTap`) so the first tap opens
with its card. One tap = one open and one haptic: `ExplorerController.open` ticks itself (hosts
don't tick too) and ignores the same word opened again within 600 ms.

## Explorable text (`shared/explorer/segments.ts`)

`<ExplorableText text segments? />` (web, `components/explorer/ExplorableText.tsx`) and
`ExplorableText` (Lab) make Chinese tappable: **by word** when the place has word segments that
line up with the text exactly (reader words, chat words — Claude's or the device's deterministic ones, see "Word chips
without an LLM" —, a breakdown), **by character** otherwise.
Inside a view it pushes; elsewhere it opens a fresh stack. Used on:

- the study card's answer side (the hanzi, the typed / multiple-choice answer diff),
- the homework pass answer side (word list hanzi),
- graded reader pages (word chips → Word view with the chip's pinyin / gloss / sentence),
- chat word chips (→ Word view),
- the coach / example-sentence breakdown rows (→ Word view; Add is inside it).
- the study card's Sentence round, once an exercise is answered (by word, source `sentence_round`; docs/STUDY_SESSION.md "Sentence round").
- the words of Claude's "✓ Added 2 cards" line in any Claude chat (source `claude_card` → "From Claude"; docs/CHAT.md
  "Cards Claude added"): opened with the line's cards as **just added** (`ExplorerOpenOptions.justAdded`, Lab
  `ExplorerController.open(…, justAdded)`), so the card tie-in shows "✓ Added to From Claude" + Open card + ⚡ Study it today
  before the sync brings the note to the device — never "+ Add as card".

Not inside places where a tap already means something (answer inputs, the call board, games
where tapping is the answer, example-sentence rows that reveal line by line).

## Word chips without an LLM (`shared/chinese/segment.ts`)

Word chips everywhere (Ask Claude, chat, reader pages) need text split into WORDS. Claude used to do it
(`segmentReaderText`, Haiku) after the text arrived; for Ask Claude that took 2–31 s and sometimes failed (Oct 2026:
one of three Chinese answers came back with "covered only 9%" then an empty reply), and meanwhile every character
was its own chip — you couldn't see which characters belong together. Now the device segments deterministically:

- **Dictionary**: `shared/data/frequency/word-freq.txt` (wordfreq large_zh, top 30,000 tokens, rank = line) plus
  `segment-words.txt` — the word dictionary's CC-CEDICT headwords that aren't in that list, with their wordfreq rank
  (`#ranked`, written as rank steps), and the list's words that are NOT dictionary headwords (`#compounds`: jieba's
  glued tokens like 这是 / 我要, +3500 so they rarely win). Built by `npm run build:segment-words`
  (`scripts/build-segment-words.ts`) from `worker/char-dict/words`; ~220 kB gzipped. CC BY-SA 4.0 like its sources.
- **Algorithm** (jieba's): for each run of Han characters, a DAG of every dictionary word starting at each position
  (≤ 8 characters) + rule edges, then DP from the end for the cheapest path. A word costs `3300 + round(1000 · ln rank)`
  milli-nats (Zipf: −ln p); an unknown character costs rank 100,000; equal totals prefer the longer word.
- **Rules** (modest, tested): numbers + a measure word / date unit (三本, 两个, 第一次, 十二月, 二十五号); AA (看看,
  慢慢), AABB (高高兴兴), A一A / A不A (看一看, 去不去 — not inside 不用不用); a word + 儿 (聊天儿). Function words are
  never doubled. No name rule (小明 is in the list; other names fall back to characters).
- **Everything else** (punctuation, Latin letters / digits, spaces, line breaks) is a plain segment grouped like
  `fallbackReaderWords`; the segments concatenate back to the text exactly.
- **Pinyin** per word: the app's auto-pinyin (pinyin-pro + 一 / 不 tone changes; Lab `ToneChange.autoPinyin`) over the
  whole run, its syllables handed out to the words ("wǒmen"). **Gloss** is empty: the Word view looks the word up
  (`/api/words`, cached), so the explorer opens with the dictionary's meaning.
- **Where**: Ask Claude's answer and question bubbles always (the Claude splitter is no longer called — it saved
  nothing that the dictionary + Word view don't give); chat messages and reader pages keep Claude's words (they carry
  contextual glosses) and use the device's words while those are missing or failed. Web
  `frontend/src/services/chineseSegmenter.ts` (`loadSegmenter` lazy-imports the two lists once, precached;
  `preloadSegmenter` at idle; `useSegmentedWords`), used by `ChatWordsText` and `ReaderWordsText`; Lab
  `core/…/chinese/Segmenter.kt` + `data/text/DeviceWords.kt` (loaded at app start, Compose state).
- **Parity**: `android-lab/parity/fixtures/segment.ts` runs the TypeScript over `shared/chinese/__fixtures__/corpus.txt`
  (480+ texts: Ask Claude-style explanations, chat lines, reader pages, the repo's sentences) + edge cases; Kotlin
  `SegmenterParityTest` matches segments AND pinyin exactly. ICU / `Intl.Segmenter` was considered and rejected — its
  dictionary differs between Node (CI), browsers and Android versions, so the two apps would drift.
- **Speed**: ~0.05 ms per line, a long reply well under a few ms; loading the lists ~100–300 ms once.

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

`explorer.open` (source, kind — source `word_tag` from a word tag's sheet), `explorer.push` (kind, from), `explorer.more` (kind),
`explorer.add_card` (kind = word | char), `explorer.add_gloss` (kind, found), `explorer.add_fill` (kind, reason), `explorer.bump` (kind = word | char), `explorer.card_variant_open` / `explorer.card_variant_action` (the card tiles), `study.word_tag_word` (a tap on Chinese in a word tag's sheet), `explorer.write`, `explorer.drill_start` (kind, items), `explorer.drill_finish` (kind, items, correct, duration_ms). Ids / enums / counts only.

## Code map & API (moved from CLAUDE.md, Nov 2026)

The agent-facing detail that used to live in CLAUDE.md: where the code is, the endpoints, the rules each
part follows. CLAUDE.md keeps only the cross-cutting rules and points here.

### Word chips without an LLM (`shared/chinese/segment.ts`; docs/LANGUAGE_EXPLORER.md "Word chips without an LLM")
A deterministic segmenter on the device (jieba's algorithm: DAG of every dictionary word in a Han run, DP for the cheapest
path; cost = 3300 + 1000·ln(rank) milli-nats, integer so both apps tie-break alike) over `shared/data/frequency/word-freq.txt`
+ `segment-words.txt` (CC-CEDICT headwords outside the list with their wordfreq rank, and the list's jieba "compounds" such as
这是 that get +3500; `npm run build:segment-words` from `worker/char-dict/words`). Rules: numbers + measure word (三本, 第一次,
十二月), AA / AABB, A一A / A不A, word + 儿; punctuation / Latin / spaces are plain segments (concatenation invariant). Pinyin per
word from the app's auto-pinyin on each run; gloss '' (the Word view looks the word up). Web `services/chineseSegmenter.ts`
(lists lazily imported + precached, preloaded at idle; `useSegmentedWords`; `ChatWordsText` / `ReaderWordsText` fall back to
it), Lab `core/…/chinese/Segmenter.kt` + `data/text/DeviceWords.kt` (preloaded at app start; tests opt in with `setForTests`),
parity-tested over `shared/chinese/__fixtures__/corpus.txt` (`parity/fixtures/segment.ts` → `SegmenterParityTest`, segments AND
pinyin). **Ask Claude and the audio-lesson transcript always use it** (the transcript: web `components/audioLessons/TranscriptLine.tsx`, Lab `TranscriptRowView`; a word → the explorer, the rest of the row still seeks) (Claude's `/note-questions/:id/words` was slow — 2–31 s — and sometimes failed, leaving
single characters); the chat and reader pages keep Claude's contextual words as primary and use it while those load / fail.
ICU / `Intl.Segmenter` deliberately not used (dictionaries differ across Node, browsers and Android → parity drift). ~0.05 ms per
line; the lists load in ~100–300 ms once.

### Language explorer (docs/LANGUAGE_EXPLORER.md)
ONE reusable bottom sheet holding a STACK of views — the Character view (the character sheet below) and a Word view
(hanzi · ▶ cached practice TTS · pinyin · meaning · "#N most common word" from the shipped frequency list · a chip per
character coloured by tone · "📚 You have this card in <deck>" → Open card / ⚡ Study it today, else + Add as card
(AddChunkModal) · dictionary senses · the sentence it was tapped in + the learner's own cards with it · ✨ More about this
word (the cached `/api/reader-words/explain`, online only) · related words sharing a character with ✓ Known / 📚 badges).
Every Chinese character / word inside a view pushes another view; ← / the breadcrumb pop, ✕ closes. Rules in
`shared/explorer` (Lab `core/…/explorer`, parity-tested). Web: `components/explorer/` — `ExplorerProvider` (App.tsx,
`useExplorer().open(item, { source })`), `LanguageExplorer`, `CharacterView`, `WordView`, and **`<ExplorableText text
segments? source />`**: makes any Chinese tappable, by word when segments match the text, by character otherwise. Used on
the study card answer side, the homework pass answer side, reader word chips, chat word chips, sentence breakdown rows
(study / homework / chat Explain / Coach) and lesson note sentences — never where a tap already means something (answer
inputs, call board, games, the sentence rows' reveal). Word data: **`GET /api/words?w=银行,学生`** (≤ 50) → `{ version,
records: { hanzi: WordRecord }, missing }` from `worker/char-dict/words/NNN.dat` (60,000 most frequent CC-CEDICT words,
`npm run build:word-dict`, `buildWordDict` in `shared/chars/build.ts`, sharded by `wordShard`), cached on the device
(IndexedDB `wordDict`, Dexie v30, `services/wordDict.ts`); offline the Word view builds from the character records + cards.
**Pinyin per character** (`shared/pinyin/wordSyllables.ts`, Lab `core/…/WordSyllables.kt`, parity-tested in the `explorer`
fixture; docs/LANGUAGE_EXPLORER.md): the header's pinyin is dictionary → the card's / the tapped text's pinyin CHECKED against
its characters → the device's own reading. `wordChars` cuts a word's pinyin into exactly one syllable per character
(`alignWordSyllables`: the cut with the fewest syllables its character can't have, then the fewest vowel-initial cuts inside a
word — wú | nóng, never the greedy wún | óng; nǎr covers 哪儿); `resolveWord(…, { device })` (web `devicePinyin(charRecords)` in
`utils/autoPinyin.ts` = pinyin-pro's `polyphonic` + the character records + `autoPinyin`; Lab `Pinyin.readings` +
`ToneChange.autoPinyin`) replaces a syllable no reading allows by the device's reading of that character (软 kuǎn → ruǎn),
and pinyin that can't be lined up (or none) gives way to the device's reading of the word; the word dictionary's is never
touched, the character lists' only cut.
**A character's own card**: the Character view says first whether the character ITSELF is a note (`charOwnCards` in
`shared/chars/status.ts`, Lab `CharWords.ownCards`, parity-tested) — "📚 You have 性 as a card in <deck>" / "✓ Known — …"
→ Open card / ⚡, else "+ Add 性 as a card" (web `components/explorer/CardTieIn.tsx`, shared with the Word view's footer;
Lab `ui/explorer/OwnCardBlock.kt`) — and the Word view's character chips carry 📚 / ✓. **Word tag sheets** ("Word tags on the
answer side") render their Chinese through ExplorableText by word (device segmenter): a tap opens the explorer (source
`word_tag`), the sheet returns when it closes (`ExplorerOpenOptions.onClosed`). **Card variants** (docs/LANGUAGE_EXPLORER.md "Card variants"): under "📚 You have this" (both views) the study card ⋯ menu's tiles for EVERY card of the word — 读 Read · 写 Write · 听 Listen, status + strength from `shared/decks/sibling-status.ts` (`siblingTiles(cards, '', …)`, the ⚡ pocket's cards as in today), offline; a tap → ⚡ Study it today = a card-level bump of that type (source `explorer`) / Unsuspend / Wake now (web `components/explorer/CardVariants.tsx` in `CardTieIn`, Lab `ui/explorer/CardVariants.kt`; `explorer.card_variant_open` / `_action`). **🎯 Quick drill** on both views (`shared/explorer/drill.ts` `buildDrill`: meaning / listen / tone / reverse / write, seeded so the Lab port is parity-tested) — practice only, never review events. Analytics `explorer.open / push / more / add_card / bump / write / drill_start / drill_finish`.

### Character sheet (tap a character on the card back; docs/STUDY_SESSION.md "Character sheet")
Card-INDEPENDENT dictionary data — readings, meaning, radical / components, strokes, frequency rank and
the ~20 most frequent words with the character, each marked **✓ Known** (mature card) / **📚 In your decks**
from the learner's own cards on the device (`shared/chars/status.ts`, Lab `CharWords.kt`, parity-tested);
a row → the explorer's Word view (⚡ Study it today / Open card → / + Add as card there); the radical and components are tappable too. Replaces the per-card Claude
popup (`WordDefinitionPopup`, `/api/vocabulary/define` — both retired Nov 2026: the endpoint answers 410, docs/CHAT.md "Practice with Claude"). Data: built by
`npm run build:char-dict` (`scripts/build-char-dict.ts`, rules in `shared/chars/build.ts`) from **CC-CEDICT**
(CC BY-SA 4.0), **Make Me a Hanzi** `dictionary.txt` (LGPL-3.0) and **wordfreq** `large_zh` (CC BY-SA 4.0
data) → ~10,200 characters in 128 gzipped JSON shards `worker/char-dict/NNN.dat` (committed, 2.3 MB), the
worker's static assets (`[assets]` binding `CHAR_DICT`, `run_worker_first = true`; `services/char-dict.ts`
keeps shards in memory per isolate) — chosen over D1 (no 10k-row data load path in CI) and R2 (no
separate upload step): immutable, versioned with the code, deployed with the worker. Bump `CHAR_DICT_VERSION`
(`shared/chars/types.ts`) when the shape or rules change so devices refetch. Device: IndexedDB `charDict` /
`charExplanations` (Dexie v28, `services/charDict.ts`), the upcoming queue's characters prefetched hourly in
sync. Licences: `/about/licences` (Settings → About · Licences).
- `GET /api/chars/:char` → `{ version, record }` (404 not in the dictionary, 400 not one Han character)
- `GET /api/chars?c=` → `{ version, records, missing }` (distinct Han characters of `c`, ≤ 100)
- `POST /api/chars/:char/explain` → `{ char, explanation, cached }` — "More about 字", Haiku from the dictionary record only (never the card), cached globally in `char_explanations`; 503 without a key and no cached answer
