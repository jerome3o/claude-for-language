# AI: calling models, the Claude agent harness, Ask Claude, text checks

The full rules for every model call in the worker and the language-quality pipeline (pinyin check,
word checks, word tags). CLAUDE.md keeps a short version of the rules; this is the detail.

### AI Features
Uses Anthropic Claude API for several features:

1. **Deck generation**: "Generate cards about zoo vocabulary" → creates full deck with 8-12 cards
2. **Card suggestions**: While editing, suggest related vocabulary
3. **Ask Claude**: During study, ask questions about a card (grammar, usage, cultural context)
   - **Immersion** (docs/STUDY_SESSION.md "Ask Claude"): answers in simple graded Chinese by default
     (`users.ask_claude_language` 'zh' | 'en', NULL = Chinese; Settings + the sheet's 中文 | EN;
     `PUT /api/profile/ask-claude-language`; prompt = the `card` context of the Claude agent harness (`claude-agent/persona.ts`, `contexts/card.ts`) with a sample of the
     learner's started words; "in English please" answers one turn in English — `shared/study/askClaude.ts`).
     **The sheet IS the card's Claude thread** (Nov 2026; docs/STUDY_SESSION.md "Ask Claude"): web
     `components/claude/CardClaudeSheet.tsx` = `ClaudeThreadView variant="sheet"` (stays mounted, hidden, while
     closed), Lab `ui/study/CardClaudeSheet.kt` = `ClaudeThreadContent` (`sheet`; `CardClaudeEffects` keeps the
     ViewModel listening): resumes the card's thread from the last 30 min (`resumeThreadFor`), "🕘 Earlier about
     银行 · N chats" / ＋ New chat, the card's chips, Ask only, the reply streamed, the typed answer sent as `typed`
     with each question, a chip as `quick` (not checked); my Chinese question is checked in the background
     (`checkCardQuestion` in `routes/claude-threads.ts` → `auto_check` on the message; E2E stand-in
     `claude-agent/check-fake.ts`). Claude's card tools are applied by the server; the device follows ONCE per reply
     (`shared/claude/cardTools.ts` `cardToolEffects` / `cardToolLines` / `undoEditFields`, Lab core
     `claude/CardTools.kt`, parity-tested; web `StudyPage.processToolResults`, Lab `StudyViewModel.claudeToolResults`):
     "✓ Claude edited this card · Undo" replaces Approve / Reject. Offline a question waits in the outbox ("Will send
     when you're online"). The card hub / History modal list the card's threads (`components/claude/CardClaudeThreads.tsx`).
     Every thread's bubbles have the chat's long-press menu subset (`askClaudeMenu`) and the auto-check marks (✎, How
     to say it better, Open in Coach). The old route `worker/src/routes/ask-claude.ts` (`POST /api/notes/:id/ask`,
     dual-writing into the card's thread) stays for older app builds; the old web / Lab sheets are gone.
   - **Speed** (docs/STUDY_SESSION.md "Ask Claude"): a chat turn of the Claude agent harness (`services/claude-agent/`, also used by the Coach's
     follow-ups, the Coach's Ask chat and Discuss with Claude) = `SONNET_MODEL` (`services/models.ts`) with thinking OFF + prompt caching
     (the tool definitions — card-independent, the card's fields ride in the first user message —, the static rules,
     the learner's known-words block — deterministic per user and UTC day —, the conversation's tail); the context is
     ONE `db.batch` (`loadAskNoteContext`, `claude-agent/contexts/card.ts`); the answer never waits for the 🎧 clip and waits ≤ `CHECK_GRACE_MS`
     (0.8 s) for the question's check. Each reply records `server.claude_turn` (surface, model tier, ms, tokens,
     cache reads / writes, rounds).
   - **🎧 Listen first** (Jerome: "toggled to audio first, in the same way the messages are"): the chat's
     Listening mode REUSED in the sheet — 🎧 beside 中文 | EN + Settings (`users.ask_claude_listening`,
     migration 0117, `PUT /api/profile/ask-claude-listening`, on `/api/auth/me`; every ask sends `listening`).
     Claude's Chinese answers show as the chat's `ListeningBubble` / Lab `ListeningContent` (tap plays with the
     0.75× chip, long press / 👁 reveals, then chips + menu); my questions and English answers never hide; a new
     answer plays once by itself unless audio is playing (`askAutoPlayId`); revealed ids per device. Audio = the
     Read-aloud clip in Claude's voice (`ASK_CLAUDE_VOICE` = the app voice Radio Host at 0.6, one clip per answer
     — no length split needed), pre-generated in waitUntil (`pregenerateAskClip`; the answer returns at once with
     `answer_clip_ready: false`, a tap before it is done makes / finds it through `/api/practice/tts`). Rules `shared/study/askClaude.ts` (Lab core `AskClaude.kt`, parity-tested); Lab
     `ui/study/AskListening.kt`.
   - Questions and answers live in the card's Claude thread (the one store; `note_questions` is frozen)
   - Listed (each opening the thread) in the card hub, the deck page's History modal and More → Claude conversations

### Calling Gemini (read before adding a Gemini call)
Every Gemini call goes through `geminiGenerateContent` (`worker/src/services/gemini.ts`) with a model LIST —
`GEMINI_FLASH_MODELS` (text / vision / audio: picture-hunt detection, call + take transcription) or
`GEMINI_IMAGE_MODELS` (reader / lesson illustrations, picture-hunt scenes). Google retires models and limits old
families to keys that already used them (a plain 404 — that broke picture hunts with `gemini-2.5-flash`), so a 404
(or a 400 / 403 about the model or thinking) moves on to the next model, the one that answered is remembered per
isolate, and errors carry Google's message (the key goes in `x-goog-api-key`, never the URL). A rename is a one-line
change there. `leastThinking(model)` gives the right thinking setting per family (2.5 budget 0, 3.x level).

### Calling Claude reliably (read before adding a Claude call)
- **Sonnet 5 and Opus 5 think by default** when `thinking` is omitted, and thinking tokens count against
  `max_tokens`. A small `max_tokens` then truncates or empties the answer — this is what broke the
  Sentence Coach (PR #392 set 900). With forced `tool_choice`, set `thinking: { type: 'disabled' }`
  (as `lesson-editor.ts`, `sentence-set.ts`, `enrich-words.ts`, `calls/report.ts` do).
- **Opus = `OPUS_MODEL` (`worker/src/services/models.ts`, `claude-opus-5-5`)**: thinking is always on
  (`{ type: 'disabled' }` is a 400) and counts against `max_tokens`, forced `tool_choice` and `temperature`
  are 400s; wrap the params in `withEffort(params, 'low' | 'medium' | …)` (default effort is medium) and use
  `tool_choice: auto` + an instruction naming the tool.
- **Chat replies** (Ask Claude, Coach follow-ups, the Coach's "💬 Ask Claude" chat `services/claude-chat.ts`,
  Discuss with Claude) go through the Claude agent harness (below); its `model.ts` (was `services/chat-turn.ts`, now a
  re-export) = `MODEL_POLICY.chat`: `SONNET_MODEL` with thinking disabled (`CHAT_TURN_MAX_TOKENS` 12000 is all answer), `cachedTools` /
  `cachedSystem` / `withCachedTail` (≤ 4 cache breakpoints: last tool, static rules, per-user block, the tail —
  so nothing per-card or per-request may go in the tools or the static system block), `CHAT_TOOL_RULE` in the
  prompt, and `ChatTurnMeter` → `server.claude_turn`. The usage capture (`services/analytics/ai-usage.ts`)
  prices cache writes at 1.25× and reads at 0.1× input (`server.ai_call` carries `cache_write_tokens`).
- For a short user-facing structured reply, use `structuredCall` (`worker/src/services/structured-call.ts`):
  forced tool + thinking off, `stop_reason` checked (`max_tokens` → retried with double the budget),
  `validate()` on the shape, every non-4xx failure retried with the last attempt on Haiku, 45 s timeout;
  it throws `StructuredCallError` with `retryable`. Routes return 503 (retryable, the client retries
  once) or 502 (declined) with a human reason. The coach's first reply (`sentence-coach.ts`,
  `sentence-translate.ts`) uses it; unit tests in `services/__tests__/structured-call.test.ts`.

### Claude agent harness (read before adding or changing a Claude chat)
`worker/src/services/claude-agent/` is THE one place every Claude chat turn goes through — `runClaudeTurn(env, ctx, input)`
(`index.ts`). Today: Ask Claude on a card (`routes/ask-claude.ts`), Sentence Coach follow-ups (`services/coach-replies.ts`
`defaultChat`, its checkpoint via `applyCheckpointed`), the Coach's "💬 Ask Claude" chat (`claude-chat.ts`
`defaultCoachAskReply`), Discuss with Claude (both apps: the message's `chat_message` thread in a sheet — `components/claude/DiscussClaudeSheet.tsx`, Lab
`ui/claude/DiscussClaudeSheet.kt`; old builds: `POST /api/messages/:id/discuss` in index.ts) and Practice with Claude (role-play threads,
`contexts/practice.ts`). Design + later PRs:
the unified-Claude-chats plan (thread store, streaming, memory) builds on this.
- `types.ts` — `ClaudeContext` (`general` · `card` {note_id, typed?} · `coach` · `practice` {scenario?, ai_role?, user_role?, level?, note_id?} · `chat_message` {message_id} · `reader`
  {reader_id, page_id?, looked_up?, said_wrong?} · `exercise` {lesson_id, exercise_key, answer?}), `TurnInput`
  (userId, the whole conversation `turns` — the last is the learner's —, language), `TurnResult` (answer, `toolActions`
  for the caller to apply, `readOnlyToolCalls`, rounds), `ContextProvider`, and the **seam** `AgentRuntime.runTurn(prepared)`.
- `contexts/<kind>.ts` — one provider per context: `load` (ownership check → `ClaudeContextError` 404 / 403, data in one
  D1 batch), `persona` (static, cached), `learner` (cached), `systemBlock`, `frameFirstTurn` (the card's facts / the
  discussed message ride in the FIRST user message, so the cached prefix is the same for every card), `tools` (names, in
  order), `deferredAck`, `finish`. **A new context = one provider file + a line in `contexts/index.ts` + its tools'
  `contexts` in the registry** (and a kind in `types.ts`). **`reader`** (`contexts/reader.ts`, "📖 Ask Claude about this page"):
  the reader (owner only: 404 / 403), the page in full + a budgeted window of ±2 pages (≤ 1,600 chars), the words he
  tapped / read aloud wrong on that page (the device's word recap run sends them, `readerPageWords`), his decks — all in
  the uncached context block; **`exercise`** (`contexts/exercise.ts`, a mini lesson's "💬 Ask Claude"): the lesson (owner
  only) and the exercise by key (`s<section>e<index>`, its fields as JSON, media keys dropped, ≤ 2,500 chars), his answer +
  the answer check when sent. Both: read-only look-ups + `create_flashcards` (the Coach's wording — a deck from the listed
  ones, applied by the thread turn with the Coach's applier) + `bump_cards` + memory; persona `buildContextChatSystemBlocks`.
- `persona.ts` — the static rules of every context (the old Ask / coach / Ask-chat / discuss prompts, byte-identical),
  `CHAT_TOOL_RULE`, `BUMP_PROMPT_RULE`, the immersion rules. `learner.ts` — the known-words sample (deterministic per user
  and day). `prompt.ts` — assembly order: tools → persona → learner → context block → messages (≤ 4 cache breakpoints).
- `tools/registry.ts` — every tool declared ONCE: schema, `kind` (`read` run inline · `write` collected for the caller ·
  `lesson` validated inline) and the contexts allowed to use it (`bindTools` throws on any other; `wording` keeps a
  context's old description where it differed). Executors in `tools/read.ts`. A tool a context doesn't offer is never run.
- `model.ts` — `MODEL_POLICY` (the only place a chat's model / thinking is chosen), `chatTurnParams`, cache helpers,
  `ChatTurnMeter` → `server.claude_turn`, `createAnthropicClient` (the client seam tests mock). `run.ts` — `WorkerRuntime`
  (the tool loop, round cap per context, `onRound` hook) and `applyCheckpointed`.
- **Swapping the harness** (Agent SDK, streaming, a per-thread Durable Object): implement `AgentRuntime` and make it the
  default in `index.ts` (or pass `runtime`); contexts, prompts and tools stay.
- **Threads** (docs/CHAT.md "Claude threads"): `store.ts` (ALL SQL on the thread store), `thread-turn.ts` (`startThreadTurn` = watchdog +
  inline run; `runThreadTurn` = lease claim → streamed `runClaudeTurn` → checkpoint → actions → finish; 'busy' / 'retry' / 'failed'),
  `live.ts` (`claude_turn` pushes + partial writes, throttled), `apply.ts` (a card turn's write actions, shared with the old Ask route),
  `backfill.ts` (the lazy per-user copy + the dual-writes), `fake.ts` (the E2E streaming stand-in). Streaming = `TurnOptions.stream`
  (`messages.stream` in run.ts; unset = the old non-streamed calls); `server.claude_turn` carries `first_token_ms` + `inline`.
  `tool-record.ts`: an earlier reply is replayed to Claude as its text + `⟦app record … ⟧` built from its stored `tool_results`
  (the same JSON the apps' "✓ Added 1 card" lines come from), so Claude never denies a card it made; every history builder
  (`coachAskTurns` / `threadTextTurns`, `buildCoachHistory`) and the memory text use it (docs/CHAT.md "Claude remembers what its tools did").
- **Memory** (docs/CHAT.md "Claude threads" → "Memory"; `memory.ts`, `tools/memory.ts`, SQL in `store.ts`): the same Claude
  in every chat. A thread's rolling **summary** (≤ ~80 words, `coach_conversations.summary` / `summary_upto` / `summary_at`)
  rewritten in the background after a reply when ≥ 2 messages are new (`rememberThread` / `rememberInBackground`:
  `startThreadTurn`, the coach-reply-queue deliveries, the Ask route's and Discuss's thread writes — never in the reply's way);
  the learner **digest** + 20-row recent-chats index (`claude_learner_memory`, ≤ ~600 tokens) rebuilt by the daily
  03:17 cron (`runClaudeMemoryCron`, bounded) and after 5 new summaries; `memoryBlock` (≤ 800 tokens) joined to the cached
  learner block of EVERY context (`prompt.ts` `assembleSystem({ memory })`, still ≤ 4 breakpoints); read tools
  `search_my_chats` (≤ 1.5k tokens) / `read_chat` (≤ 3k) in every context but `practice`, the caller's own threads only; **compaction**
  (`compactMessages`): history over ~12k tokens → first message + the last 6 turns, the summary in the context block
  (`TurnInput.threadId` = the thread whose summary it reads). Models: `MODEL_POLICY.summary` / `.digest` (`HAIKU_MODEL`
  via `structuredCall`). `server.claude_memory`. E2E stand-in first. Tests: `__tests__/memory.test.ts`.
- **Practice — role-plays** (`contexts/practice.ts`, docs/CHAT.md "Practice with Claude", rules `shared/claude/practice.ts`): Claude
  plays someone in a situation; `MODEL_POLICY.practice` (Sonnet, thinking off, 1.5k), NO tools (one round — in character, fast;
  cards come afterwards from the thread), the situation / roles / level / a card's word in the context block, the opener when the
  thread starts with no message (`store.appendOpener`, `PRACTICE_OPENER`), help chips 💡 / 🆘 / ✏️ answered as a tutor then back
  in character, the persona voice (`practiceVoiceFor`, kept on the thread) and its clip made after the reply (waitUntil). Tests:
  `__tests__/practice.test.ts`.
- **Privacy (tested, `__tests__/privacy.test.ts`)**: no context or tool reads `student_profiles` (the tutor's private
  note) — the learner's agent sees the learner's own rows only (Claude memory included: summaries, digest, look-ups). Tests: `__tests__/harness.test.ts` (fake model: tool loop,
  round cap, cache breakpoints per context, allow-lists, access checks).

### Pinyin check on lessons and readers (`worker/src/services/pinyin-check.ts`, `services/pinyin-scan.ts`)
Deterministic, no model / network: every hanzi + pinyin pair a mini lesson, library lesson, reader or audio-lesson
plan carries (`hanzi`/`pinyin`, `reference_*`, `content_chinese`/`content_pinyin`, vocabulary — `fixSpecPinyin` walks
any JSON) is lined up syllable by syllable (儿 folded in) and checked against the readings each character can have
(pinyin-pro, then CC-CEDICT via `CHAR_DICT`). **Only the impossible is corrected, on write**: a syllable its character
never has (扶梯 "fúqī" → "fútī", 休息 "xiūxí" → "xiūxi"; only that syllable changes, the author's capitals / spacing /
punctuation / line breaks kept; the word dictionary or pinyin-pro in context picks the replacement). A syllable that IS a
reading of its character is never touched, whatever the word dictionary says (大人 dàrén, 还 hái/huán, 得, 长; a word is
cut into syllables the way that fits its characters — dà|rén, not dàr|én), nor 一 / 不 tones, 一 yāo, 喂 wéi, colloquial
reduplication (好好 hǎohāo, 慢慢 mànmān), interjections (嗯 ǹg), lines mixing Latin letters / digits, or a
multiple-choice exercise's WRONG options (deliberate tone distractors: 押金 "yàjǐn"). Alternatives listed on purpose
("piāo / piào", "zhè ge / zhèi ge", "xuě; xiě") are checked one by one, never collapsed. **A line is never rebuilt**:
when the syllables don't line up with the characters, ONE missing syllable is put back only when clearly safe (one
clause short by one, the gap fits one place only, the character has one reading: "Wǒ xǐhuan nǐ." → "Wǒ hěn xǐhuan
nǐ."); anything else stays as written and comes back as a warning ("one syllable missing for 得 in “说得真好” …",
"an extra syllable “le” …") — `checkSpecPinyin` → `{ fixes, warnings }` (`PinyinWarning`), the scan's "Needs a look
(not changed)"; so does a line where most syllables don't fit (out of step, not misspelled). Runs in `createCustomLessonFromSpec`
/ `updateCustomLessonFromSpec` (REST, Ask Claude, coach, MCP, companion lessons), the lesson editor / library routes,
the session-notes agent's `create_mini_lesson` / `create_reader`, reader import / PUT spec / page edits / story
generation, and audio-lesson `submit_lesson`; copies (assign, push, share) inherit the checked spec. Replies carry
`pinyin_fixes: [{ path, where, hanzi, before, after, reason, words }]` (`shared/pinyin/fixes.ts`); the MCP create /
update tools repeat them. TTS clips are keyed by the Chinese text + voice, so a pinyin fix never invalidates audio.
Stored content: `POST /api/me/pinyin-scan { apply?, kinds? }` (dry run by default; `apply: true` writes in place — lesson
ids / completions / FSRS kept, `updated_at` touched; library version not bumped; reader page ids kept) = MCP
`scan_content_pinyin` (`dry_run` default true; `needs_a_look` per item); the scan covers readers' word chips too (one fix per
chip, `pages[i].words[j].pinyin`). **Reader word chips** (Haiku's segments, the chat's word chips) go through the same check when
they are made (`fixReaderWordsPinyin` in `services/reader-words.ts`: each chip by `checkAuthoredPinyin`, then the 一 / 不 rule
over the whole page — 吴侬软语 "wúnóngkuǎnyǔ" → "wúnóngruǎnyǔ"), when a shared reader is copied, and lazily for words stored
before (Nov 2026) — see "Reader word chips". The call board's tab-complete uses the same aligner
(`services/calls/gloss-pinyin.ts`, which also replaces whole words, rebuilds its own short gloss when the count is off, and
applies the 一 / 不 rule).
**Example sentences + breakdowns** (`services/sentence-pinyin.ts`, Nov 2026 — the set row 这些破烂东西可以扔掉。 came back
"… zhuāngdiào" and its breakdown said 扔掉 zhuāngdiào): every sentence-set row Claude writes (generate route, the queue's first set
and top-ups — `generateSentenceSet` returns checked pinyin) goes through `checkAuthoredPinyin` + the 一 / 不 rule and is stored with
`note_sentences.pinyin_checked` (migration 0156); every "What's going on here?" breakdown (`explainSentenceBriefly`: the row's
`/explain`, `/explain-text`, `/translate`, the Coach's Explain — and a breakdown the device sends to the Coach) has each word's
pinyin checked like a reader word chip (`fixReaderWordsPinyin`). Stored rows: `repairSentencePinyin` — the hourly cron (≤ 5 × 1,000
rows a run, anyone's) and a throttled per-user pass before `GET /api/sentences/changes` — corrects a row only while it is unchanged,
bumps every row of its note (both apps replace a note's rows whole from that sync) and stamps the version (idempotent). The card's
own row (`<note>-card`) keeps its pinyin (it mirrors `notes.sentence_clue_pinyin`, a note field: the word check proposes fixes, notes
are never mass-rewritten); its cached breakdown IS corrected. Device caches of breakdowns by text are versioned (web
`sentenceTextExplanations.v` / `TEXT_EXPLANATION_VERSION` 2, Lab `study/explain/v2/<id>` + `study/explain-text/v2/<hanzi>`): an
older one is used only offline or when the fetch fails. Also checked with `fixSpecPinyin` (hanzi + pinyin pairs) on write / before
answering: the Coach's check + translation (and `/api/sentence/coach`), `/api/sentence/analyze`, `/api/sentence/explain`, a chat
message's auto-check, new idiom entries, the reader word sheet's "More about this word" (word + card sentence). NOT checked
(note fields — the word check's job): Generate / gloss / enrich / add-words / create_flashcards / chat & call flashcards / picture
hunts (一 / 不 only).

### Word checks — "⚠ Possible issue" (`worker/src/services/card-check.ts`, `routes/card-checks.ts`, `shared/cards/check.ts`)
A cheap batched Haiku check (`structuredCall`, `CHECK_BATCH_SIZE` 40 words per call, forced `report_issues`
tool) for likely-wrong pinyin (wrong tones, a missing 一/不 tone change, the wrong reading of a multi-reading
character) or a wrong / misleading English gloss, plus the deterministic 一/不 rule (`mergeCheckIssues`).
**Never applied automatically**: results are stored, shown, and only an explicit Apply goes through
`content.updateNote` (`{ check: false }`, so a fix doesn't re-check itself).
- New / edited words: the content service calls `queueNoteCheck` (create / batch / an edit of hanzi, pinyin or
  english) when the account's switch is on — `users.card_check`, NULL = default ON for tutors (role tutor or
  tutoring someone), Settings → Cards "Check new words for mistakes" (`PUT /api/profile/card-check`, `card_check` /
  `card_check_setting` on `/api/auth/me`). Runs on **`card-check-queue`**; issues land in `notes.check_issues`
  (JSON `NoteCheckIssue[]`) with `notes.check_at` (migration 0104) — `/api/sync/changes` also returns notes by
  `check_at`, so `updated_at` (which the tutor→student copy rules compare) is never touched by a check. Deck page
  note rows show each live issue (`liveCheckIssues`: stale once the field changed) with Apply fix / Dismiss
  (`components/cardCheck/NoteCheckIssues.tsx`; Lab deck detail). Copies, the starter deck and `?check=none` skip it.
- Paste a list: the preview calls `POST /api/ai/check-words` (≤ 60 rows, nothing stored) and shows ⚠ per row;
  checked rows are saved with `?check=none`.
- **Per-deck "Check for errors"** (deck ⋯ menu; the tutor's student page → homework row menu, on the STUDENT's
  copy): `components/cardCheck/DeckCheckSheet.tsx` (Lab: same sheet) — cost estimate first (`estimateCheckCost`,
  "~319 words · about $0.02"), then a `deck_check_jobs` row run on the queue in batches with progress saved per
  batch (a redelivery resumes), then the review list (current → proposed, reason, checkboxes) and **Apply selected**
  (`applyDeckCheck`: a word edited since is skipped; "Also fix my source deck" when the tutor owns the source,
  matched by hanzi). Real token usage → `cost_usd` (`structuredCall`'s `onUsage`).
- E2E_TEST_MODE uses a fake model (`services/card-check-fake.ts`: 银行 yínxíng, 苹果 "banana", 长大, 妈妈).
- MCP: `check_deck_for_errors`, `apply_note_fixes` (`mcp-server/src/tools/checks.ts`); `add_note`, `batch_add_notes`,
  `create_homework_deck`, `add_words_to_student_deck` create with `?check=sync` and return `check_warnings`.

### Word tags on the answer side (`shared/cards/word-tags.ts`, docs/STUDY_SESSION.md "Word tags")
Deterministic pills under the meaning (and in the explorer's Word view): part of speech, separable verb,
register, measure word, HSK level, how common, traditional form — from `shared/data/word-tags/word-tags.txt`
(CC-CEDICT + HanLP + jieba + complete-hsk-vocabulary + the curated lists in `shared/cards/word-tags-curated.ts`;
README there has sources and licences). Rebuild with `npm run build:word-tags`. Lab: `core/…/cards/WordTags.kt`
over the same file, parity-tested. Settings → Study → "Word tags on the answer" (on by default, per device).
No transitivity from the lexicon: HanLP's `vi` is wrong too often (喜欢). **An HSK word is never "Rare"**
(`frequencyTier(rank, kind, hsk)`, `hskLevel(lexicon, text)`): the word-freq list counts mostly written text; the same
rule drives the explorer's grey decals (web `useDecalIndex`, Lab `shippedDecals`), so a card and a tile agree.

**AI word tags** (`shared/cards/word-tags-ai.ts`, `worker/src/services/word-tags-ai.ts`, `routes/word-tags.ts`): a cheap
batched Haiku `structuredCall` (forced `tag_words` tool, thinking off, `WORD_TAGS_BATCH_SIZE` 40 words per call) gives each
note `{ v, transitivity?, separable?, register?, register_note? (≤ 60), spoken?: 'everyday', spoken_confidence?, confidence }`, stored as `notes.word_tags` with
`word_tags_at` (migration 0120; `/api/sync/changes` returns notes by it — `updated_at` is never touched). The apps merge it
under the lexicon's pills (`wordTagsWithAi` / Lab `core/…/cards/WordTagsAi.kt`, parity-tested): the lexicon always wins
(an AI register only when it has none), transitivity ("Takes an object" / "No object" / "Object optional") only for a verb
and never a sentence, low confidence never shown, AI pills marked ✨ and their sheet says "Suggested by AI — may be wrong" +
the register note. **✨ Everyday speech** (v2, `isEverydaySpeech`: high `spoken_confidence` only, never a sentence) drops the
"Rare" frequency pill (written text undercounts 结账) and shows only where no Top 100 / 1,000 / 2,000 pill is. Bumping
`WORD_TAGS_AI_VERSION` re-tags every note through the same backfill (`needsWordTagsSql`: no verdict or an older `v`; untagged
first, then outdated; progress `outdated`). Runs on **`card-check-queue`** (`{ kind: 'word_tags' }`): a created note, or an edit of hanzi / English
(tags cleared + re-tagged), at the word check's trigger points with its skips (`check: false`, copies — which carry the
source's tags —, the starter deck) but for every account; plus the backfill: every `/api/sync/changes` queues up to
`WORD_TAGS_BACKFILL_PER_HOUR` (200) untagged notes an hour per user (looks at most every 15 min; `word_tag_runs`). A note the
model skips is stored as `{ v: <version>, confidence: 'low' }`; a failed call writes nothing (the next hour retries). Token use per
user in `word_tag_runs`; events `server.word_tags_batch` / `server.word_tags_backfill`. E2E: `fakeWordTagsClient`
(`services/card-check-fake.ts`: 告诉, 休息, 告知, 搞定, 结账 / 买单 = Everyday speech). MCP `backfill_word_tags` (`tools/checks.ts`).
