# 成语 Idioms (beta)

Asked for by Minghui (Oct 2026): a place where a learner reads, on their own, what a 成语 means,
the story behind it (典故) and how to use it. Experimental — More → Practice → **📜 成语 Idioms
(beta)** (tutors: More → Tools), web `/idioms`, `/idioms/:hanzi`; the Lab app has the same paths.

## One entry per idiom, for everyone

An entry (`IdiomEntry`, `shared/idioms/types.ts`) is generated ONCE by Claude and shared by every
account: D1 `idioms` (migration 0115), keyed by `normalizeIdiomHanzi` (NFKC, punctuation / spaces
stripped, traditional → simplified). No user ids are stored, so account deletion has nothing to do.

| Part | What it holds |
| --- | --- |
| Head | hanzi, pinyin (card standard: 一 / 不 tone changes via `applyYiBuToneChanges`), figurative meaning, a one-line explanation in simple Chinese |
| Character by character | per character: hanzi, its syllable in the idiom, gloss; the literal phrase — each character opens the language explorer |
| 典故 | `origin.kind` classical / folk / modern / uncertain, `source` (《书名·篇名》) and `era` only when certain, a one-line English summary, the story in 3–6 short HSK 3–4 paragraphs (pinyin + English each), an honesty `note` |
| 用法 | roles (谓语 / 定语 / 状语 / 补语 / 宾语 / 主语 / 分句), register (书面 / 口语 / both), sentiment (褒义 / 贬义 / 中性), a usage note, collocations, 3–4 examples easiest → hardest (each contains the idiom exactly, no brackets), the common mistake |
| 近义 / 反义 | up to 4 real idioms each (tappable → their own entry) |
| Try it | 2–3 multiple-choice questions (meaning / which sentence fits). Practice only — nothing recorded beyond `idioms.quiz` |
| Confidence | high / medium / low + note; anything but high shows a quiet "Claude wasn't fully sure…" line |

**Facts first.** The prompt (`IDIOM_SYSTEM`, `worker/src/services/idioms.ts`) forbids inventing a
book, chapter, person or event; an uncertain or modern origin is labelled as such (the validator
adds a note when the model gives none); "not a 成语" is an answer (`not_idiom`, with `did_you_mean`
for a typo: 画蛇添脚 → 画蛇添足). No Haiku fallback: a wrong 典故 is worse than "try again".

## Generation

`POST /api/idioms { hanzi, retry? }` is get-or-generate: a missing / failed row (or `not_idiom` with
`retry`) becomes `generating` and goes on **`idiom-queue`** (one long `structuredCall`: forced
`write_idiom_entry` tool, thinking off, 6,000 tokens doubled on a cut-off, 150 s timeout, 3
attempts; `validateIdiomGeneration` cleans the pinyin, drops examples that break the card standard
or lack the idiom, and refuses a broken entry so it is retried). Clients poll
`GET /api/idioms/:hanzi` every 2.5 s; a row generating for over 10 min is reported failed (Retry).
E2E_TEST_MODE uses `services/idioms-fake.ts` (画蛇添足 = `SAMPLE_IDIOM_ENTRY`, 画蛇添脚 = not an
idiom) and runs inline. Opening a page generates it when missing; the starter list (~46 idioms,
`shared/idioms/starter.ts`, grouped "With a story" / "Everyday") is generated lazily the first time
each is opened — or by an admin with `POST /api/admin/idioms/backfill { limit? }`.

## Offline

An opened entry is cached on the device (web IndexedDB `idioms`, Dexie v31; Lab JsonCache
`idioms/entry/<hanzi>`), so it reads offline afterwards; the narration (headword + story
paragraphs) is prefetched through the practice TTS path (`getTTSWithCache` / `QuestSpeech`, the
shared MiniMax limiter + R2 `tts-cache/`), examples are cached once played. The list shows the last
server list (or the shipped starter list) with ✓ on entries on the device; others are dimmed
offline. Generating offline → "You're offline and this idiom isn't on the device yet."

## Card, explorer, MCP

- **+ Add as card** = `idiomCardFields`: fun_facts = literal breakdown, meaning, origin in one line,
  usage + register, common mistake; sentence_clue = the easiest example. Through
  `POST /api/decks/:id/notes`; already a card → Open card / ⚡ Study it today (bump source `idioms`).
- **Language explorer**: the Word view shows **📜 Story & usage** when the word is four Han
  characters and is a starter idiom, has an entry on the device, or the dictionary says "(idiom)"
  (`showIdiomLink`).
- **MCP**: `get_idiom` (generates and waits up to 90 s) and `list_idioms` — read / generate only.
- **Analytics**: `idioms.open` (source, cached), `idioms.generate` (server), `idioms.add_card`,
  `idioms.quiz` (correct, total).

Lab: `core/…/idioms/Idioms.kt` (shape, starter list, key, link rule, card fields, score line —
parity-tested by `parity/fixtures/idioms.ts`), `data/idioms/IdiomStore.kt`, `ui/idioms/`.
