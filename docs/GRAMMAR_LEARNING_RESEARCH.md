# Grammar Learning Research & Daily Exercise Proposals

**Date:** April 2026
**Context:** Jerome has solid vocab via FSRS flashcards but needs to learn grammatical structures. Graded readers exist but aren't sticking. Goal: design a separate daily exercise session (alongside flashcards, not replacing them) that builds grammar across all four skills — speaking, listening, reading, typing.

---

## TL;DR — What to Build

A **"Daily Practice"** session (separate page from `/study`) that runs 10–15 min and mixes 3–4 exercise types, all generated from your mastered FSRS vocab + a curriculum of grammar points. The highest-leverage exercises, in build order:

1. **Constrained Translation** — English prompt → you type Chinese → Claude checks grammar, flags if you dodged the target structure
2. **Pattern Cloze** — fill-in-the-blank sentences targeting one grammar point, with scramble/reorder variants
3. **Dictogloss** — TTS plays 2–3 sentences twice → you reconstruct from memory → Claude diffs what you missed
4. **Shadowing** — TTS plays → you record yourself repeating → side-by-side playback
5. **Active Reader** — graded reader pages with comprehension questions + "retell in your own words" at the end
6. **Error Journal** *(AI-native, cross-cutting)* — Claude tracks every grammar mistake across all exercises and surfaces your weak patterns

Backed by a **Grammar Point curriculum** (AllSet Wiki A1→B2, ~280 points) tracked with its own FSRS-like progress, independent of vocab cards.

---

## Part 1: Why You're Plateauing (Diagnosis)

### The input/output asymmetry

The single most relevant research finding is **Swain's Comprehensible Output Hypothesis** ([Wikipedia](https://en.wikipedia.org/wiki/Comprehensible_output), [Migaku](https://migaku.com/blog/language-fun/output-hypothesis-language-learning)). Swain studied Canadian French-immersion students who, after *years* of comprehensible input, had near-native listening/reading but **persistently weak grammar in production**. Her conclusion:

> Comprehension lets you take semantic shortcuts. You can understand "我把书放在桌子上" without ever processing *why* 把 is there. **Only production forces syntactic processing** — you have to actually build the structure, notice you can't, and fix it.

Your current setup is input-heavy:
- **Flashcards** → recognition + isolated recall (great for vocab, doesn't touch syntax)
- **Graded readers** → pure input, passive (and you've noticed yourself not using them — this matches the research; input alone feels low-yield once vocab isn't the bottleneck)
- **AI Conversation** → this *is* output practice and is your best existing tool, but it's unconstrained (AI uses vocab you don't know) and unstructured (no grammar curriculum, no error tracking)

### What's missing

1. **No grammar curriculum.** Vocab has decks; grammar has nothing. There's no list of "grammar points I know / am learning / haven't seen."
2. **No forced production at sentence level.** Flashcards are word-level; conversations are discourse-level. The middle — *building one correct sentence with a target structure* — is where grammar is actually acquired.
3. **No error memory.** You make the same 了/过 mistake twenty times across conversations and nothing aggregates it.
4. **Readers are passive.** No comprehension check, no retell, no reason to engage deeply.

---

## Part 2: Techniques That Work (Research Summary)

| Technique | What it is | Evidence | Skills | AI upgrade |
|---|---|---|---|---|
| **Constrained translation** (L1→L2) | English prompt designed to require a target structure; learner produces Chinese | Direct application of Output Hypothesis — forces noticing the gap | Writing, grammar | Claude checks not just correctness but *whether you used the target structure or worked around it* — impossible pre-LLM |
| **Cloze / sentence mining** | Fill-in-blank on i+1 sentences (one unknown per sentence) | "Moderately effective for grammar pattern recognition" ([Mandarin Mosaic](https://mandarinmosaic.com/blog/cloze-tests-for-learning-chinese), [Chinese Boost](https://www.chineseboost.com/blog/cloze-deletion-learning-chinese/)); core of Clozemaster/Migaku | Reading, grammar | Generate infinite cloze sentences using *only your mastered vocab* + target grammar |
| **Dictogloss** | Listen to a short passage 2×, then reconstruct it from memory in writing | Forces attention to grammatical structures; outperforms comprehension questions on immediate post-test ([Yu, Boers & Tremblay 2025](https://journals.sagepub.com/doi/10.1177/13621688221117242)) | Listening, writing, grammar | Claude diffs your reconstruction vs. original, highlights *which grammar particles you dropped* |
| **Shadowing** | Listen and repeat aloud in real-time, matching prosody/tones | "Superior to dictation, repetition drills, and translation" for fluency/pronunciation ([ERIC](https://files.eric.ed.gov/fulltext/EJ1479870.pdf), [FluentU](https://www.fluentu.com/blog/chinese/shadowing-chinese/)) | Speaking, listening, pronunciation | Generate level-appropriate sentences; record + side-by-side playback; (future: ASR scoring) |
| **Task-based scenarios** | Goal-directed conversation ("get the waiter to split the bill") | Standard in TBLT; meaning-focused output | Speaking, listening | Already exists as ChatPage — needs vocab constraint + post-hoc grammar review |
| **Retell / summarize** | Read/hear a story, retell in own words | Forces re-encoding through your own grammar; standard comprehension-to-production bridge | All four | Claude evaluates retell for target-structure usage + accuracy |
| **Error-driven review** | Aggregate mistakes, drill weak patterns | "Memory-augmented LLM agents can retain repeated grammar mistakes for consistent scaffolding" ([arXiv 2502.05467](https://arxiv.org/abs/2502.05467)); RCT shows LLM feedback improves outcomes when learners engage ([arXiv 2506.17006](https://arxiv.org/abs/2506.17006)) | Grammar | **Only possible with AI** — a tutor who remembers every mistake you've ever made |

### What the research says NOT to do

- **Grammar explanation without production** — reading *about* 把 doesn't help you use 把. Explanation should follow a failed attempt, not precede it.
- **Unconstrained input** — readers/podcasts way above your level produce noise, not i+1 acquisition.
- **Isolated drills without meaning** — pattern drills work better when sentences are meaningful and use vocab you care about (your decks).
- **Passive correction** — being shown the right answer is weaker than being asked to self-correct first ([LLM feedback research](https://arxiv.org/abs/2506.17006) — engagement is the moderating variable).

---

## Part 3: The Grammar Curriculum Backbone

Everything below hangs off a **grammar point database** — a new table parallel to `notes`:

```
grammar_points
  id, level (A1/A2/B1/B2), name, structure, explanation,
  example_hanzi, example_pinyin, example_english,
  allset_url
```

Seed from the [AllSet Chinese Grammar Wiki](https://resources.allsetlearning.com/chinese/grammar/Grammar_points_by_level): ~40 A1, **99 A2**, **143 B1**, ~150 B2 points. Organized by CEFR level and part of speech. Examples at A2: change-of-state 了, experiential 过, 把 disposal, durative 着, 比 comparisons, 在 progressive.

Each grammar point gets FSRS-like tracking (or simpler: new/learning/known) so the daily session knows what to introduce vs. reinforce.

**Key constraint for ALL generated content:** use only hanzi from notes where the user has ≥1 card in REVIEW queue (mastered vocab). This is the i+1 guarantee — the *only* new thing in any exercise is the grammar.

---

## Part 4: Concrete Exercise Designs

### 1. Constrained Translation ⭐ *build first*

**UX:**
- Screen shows: target grammar point badge (e.g., "把 — disposal construction") + English sentence: *"Put the book on the table."*
- You type Chinese. Submit.
- Claude evaluates:
  - ✅ Grammatical? ✅ Means the right thing? ✅ **Used 把?**
  - If you wrote 书在桌子上 (avoided 把): "Correct meaning, but you sidestepped 把. Try again using 把 to show what you *did to* the book."
  - If wrong: highlight the error span, ask "what's wrong here?" before revealing
- 5–6 prompts per grammar point per session.

**Why it works:** Pure Output Hypothesis. The English is designed so the natural Chinese *requires* the structure. You either produce it or notice you can't.

**Tech:** Claude generates prompts (system: "only use these hanzi: [...mastered list...], target structure: 把 + obj + verb + complement"). Claude checks answers via tool-use returning `{grammatical, meaning_match, used_target_structure, feedback, corrected}`.

**Trains:** typing/writing, grammar, reading.

---

### 2. Pattern Cloze & Scramble

**UX, three variants rotated:**
- **Cloze:** 我＿＿书放在桌子上了。 → type the missing word(s)
- **Scramble:** drag-to-reorder: [桌子上] [我] [书] [把] [了] [放在]
- **Particle choice:** 我吃＿＿饭了 with buttons [了 / 过 / 着] → tests discrimination between confusable grammar

**Why it works:** Cloze is the proven SRS-compatible grammar format ([Migaku guide](https://migaku.com/blog/language-fun/cloze-deletion-language-learning-guide), [Clozemaster](https://www.clozemaster.com/blog/best-ways-to-learn-chinese-vocabulary/)). Scramble specifically targets word order — Chinese grammar is largely word order. Particle choice targets the hardest discrimination problem (了 vs 过 vs 着).

**Tech:** Same generation constraint. Answers are deterministic (no Claude needed to check) → **works offline** once generated.

**Trains:** reading, grammar. Fast, low-friction, good for train commute.

---

### 3. Dictogloss (Listening Reconstruction)

**UX:**
- "Listen carefully. This will play twice." → TTS plays a 2–3 sentence passage (your vocab + 1–2 target grammar points)
- After second play: text box appears. "Write what you heard, as accurately as you can."
- Submit → Claude shows diff: your version vs. original, with missed/wrong segments highlighted
- "You dropped 了 in sentence 2 and wrote 在 instead of 着 — both change the aspect. Here's why..."
- Replay button always available.

**Why it works:** Dictogloss outperforms passive comprehension questions for noticing grammar ([Yu, Boers & Tremblay 2025](https://journals.sagepub.com/doi/10.1177/13621688221117242)). The reconstruction step forces you to commit to a grammatical form. The diff makes the gap visible — you literally see which particles your ear is skipping.

**Tech:** `generateTTS()` already handles sentence-length Chinese. Diff can be character-level. Claude annotates *why* each diff matters.

**Trains:** listening, typing, grammar. **This is the listening-comprehension exercise.**

---

### 4. Shadowing

**UX:**
- TTS plays a sentence (looped, controllable speed — start at your 0.6× default, ramp to 1.0×)
- Record button: you speak along/immediately after
- Playback: original | yours | overlaid
- Self-rate: "tones felt right / shaky / lost it"
- Optional: send to tutor (reuses homework recording infra)

**Why it works:** Shadowing is the best-evidenced technique for pronunciation + prosody + listening-speaking link ([ERIC review](https://files.eric.ed.gov/fulltext/EJ1479870.pdf)). It builds the motor patterns for grammar — saying 把书放在桌子上 fifty times makes the structure automatic.

**Tech:** `useAudioRecorder` + `generateTTS` already exist. Side-by-side playback is new but simple. (Future: pitch-contour visualization for tones; ASR scoring via Whisper.)

**Trains:** speaking, listening, pronunciation.

---

### 5. Active Reader (upgrade existing graded readers)

**UX additions to `ReaderPage`:**
- After each page: 1–2 comprehension questions (multiple choice or short answer). "Why did 小明 go to the store?" Answers checked by Claude.
- After last page: **"Retell the story in your own words"** — typed or recorded. Claude evaluates: covered key events? used the target grammar from the story? grammatical?
- Reader generation already constrains vocab; add "feature these grammar points: [...]" to the generation prompt.

**Why it works:** Converts passive input (which you're not using) into input→output loop. Retell is a standard comprehension-to-production bridge. Fixes the "I have readers but don't use them" problem by adding a reason to engage.

**Tech:** Mostly extends existing `graded-reader.ts`. Comprehension Qs generated alongside pages. Retell evaluation = Claude with rubric.

**Trains:** reading, writing/speaking, grammar in context.

---

### 6. Constrained Micro-Conversation (upgrade existing ChatPage)

**UX changes:**
- Scenario specifies **target grammar** ("Practice: 把 construction") and **turn limit** (5 exchanges)
- AI system prompt: "Only use hanzi from this list: [...]. Naturally create opportunities for the user to use 把."
- After conversation ends: **automatic review screen** — Claude lists each of your messages with grammar feedback, offers to create flashcards from errors (this hook already exists via `discussMessage`)

**Why it works:** ChatPage is already your best output tool; this makes it *targeted* and *bounded* so it fits a daily session instead of being open-ended.

**Tech:** Small changes to `conversations.ts` — add vocab allowlist + grammar target to system prompt, add post-conversation review endpoint.

**Trains:** all four skills (if voice input added).

---

### 7. Error Journal ⭐ *AI-native, cross-cutting*

**Not an exercise — a system that feeds all the others.**

Every time Claude corrects you (in translation, dictogloss, conversation, retell), log:
```
grammar_errors
  id, user_id, grammar_point_id, exercise_type,
  user_wrote, should_be, error_category, created_at
```

**Daily Practice opens with:** "Your weak spots: you've confused 了/过 6× this week, and dropped 的 in attributive position 4×. Today's session will target these."

**Weekly:** "Error trend" chart. Grammar points where error rate is dropping → graduate to "known."

**Why it works:** This is the thing only AI enables. A human tutor sees you 1hr/week and forgets. This tutor sees *every* sentence you produce and never forgets. The [LLM-tutor research](https://arxiv.org/abs/2502.05467) specifically calls out memory-augmented agents tracking repeated mistakes as the key personalization unlock.

**Tech:** New table + aggregation queries. Claude classifies each error into a grammar_point_id during feedback generation (tool-use output already structured).

---

## Part 5: The Daily Practice Session

**New page: `/practice`** (alongside `/study`, never touches StudyPage code)

```
┌─────────────────────────────────────┐
│  Daily Practice      ~12 min        │
│                                     │
│  Today's grammar:  把 (review)      │
│                    V+过 (new)        │
│                                     │
│  ▸ Warm-up cloze        4 items     │
│  ▸ Translation          5 items     │
│  ▸ Dictogloss           2 passages  │
│  ▸ Shadowing            3 sentences │
│                                     │
│  Weak spots from this week:         │
│    了 vs 过 (6 errors)              │
│                          [Start]    │
└─────────────────────────────────────┘
```

**Session flow:**
1. **Generate** the day's content on session start (or pre-generate overnight): pick 1 new + 1–2 review grammar points from curriculum, generate all exercise items using mastered-vocab constraint
2. **Warm-up** (cloze/scramble) — fast, builds confidence, works offline
3. **Production** (translation) — the core grammar work
4. **Listening** (dictogloss) — one or two passages
5. **Speaking** (shadowing) — end on speaking so you leave having *said* the structures
6. **Wrap** — error summary, grammar points progress, confetti

**Progress tracking (separate from flashcard stats):**
- Grammar points: new / learning / known (with error-rate threshold for graduation)
- Exercises completed per day (streak)
- Error rate trend per grammar category

---

## Part 6: Build Order Recommendation

| Phase | What | Why first | Effort |
|---|---|---|---|
| **1** | Grammar point DB + seed A1/A2 from AllSet | Everything depends on it | S |
| **1** | Mastered-vocab query (`cards in REVIEW queue → hanzi set`) | Constraint for all generation | S |
| **2** | Constrained Translation exercise + Claude checker | Highest learning value, pure Output Hypothesis, validates the generation+checking pipeline | M |
| **2** | Pattern Cloze (offline-checkable) | Cheap once generation works, gives offline-capable exercise | S |
| **2** | `/practice` page shell with session flow | Ties exercises together | M |
| **3** | Error Journal table + "weak spots" surfacing | Makes everything compound | M |
| **3** | Dictogloss | Listening skill, reuses TTS | M |
| **4** | Shadowing | Speaking skill, reuses recording | S–M |
| **4** | Active Reader upgrades | Makes existing feature useful | M |
| **5** | Constrained Micro-Conversation | Polish on existing ChatPage | S |

Phases 1–2 give you a working daily grammar session. Phase 3 makes it personalized. Phases 4–5 round out the four skills.

---

## Part 7: Open Questions for You

1. **Level calibration:** I couldn't read your production DB (no Cloudflare token in this env). Roughly how many vocab notes do you have mastered, and have you studied any grammar formally (HSK level / textbook)? This determines whether to seed at A2 or B1.
2. **Voice input:** For translation/retell, do you want to *type* Chinese or *speak* it (→ ASR → Claude checks)? Speaking is higher value but adds Whisper/ASR dependency.
3. **Session length:** Is ~12 min right, or do you want it shorter (one exercise type per day, rotating) vs. longer (all types every day)?
4. **Grammar source:** OK to seed from AllSet Grammar Wiki (CC-BY-NC), or prefer Claude-generated grammar point explanations?

---

## Sources

- [Comprehensible Output Hypothesis — Wikipedia](https://en.wikipedia.org/wiki/Comprehensible_output)
- [Output Hypothesis for language learning — Migaku](https://migaku.com/blog/language-fun/output-hypothesis-language-learning)
- [LLMs Can be Good Tutors in Foreign Language Education — arXiv 2502.05467](https://arxiv.org/abs/2502.05467)
- [LLM-Generated Feedback Supports Learning If Learners Choose to Use It — arXiv 2506.17006](https://arxiv.org/abs/2506.17006)
- [Learning multiword items through dictation and dictogloss — Yu, Boers & Tremblay 2025](https://journals.sagepub.com/doi/10.1177/13621688221117242)
- [Shadowing technique effectiveness — ERIC EJ1479870](https://files.eric.ed.gov/fulltext/EJ1479870.pdf)
- [Cloze deletion for learning Chinese — Chinese Boost](https://www.chineseboost.com/blog/cloze-deletion-learning-chinese/)
- [Cloze tests for Chinese — Mandarin Mosaic](https://mandarinmosaic.com/blog/cloze-tests-for-learning-chinese)
- [Cloze deletion guide — Migaku](https://migaku.com/blog/language-fun/cloze-deletion-language-learning-guide)
- [Shadowing Chinese — FluentU](https://www.fluentu.com/blog/chinese/shadowing-chinese/)
- [AllSet Chinese Grammar Wiki — by level](https://resources.allsetlearning.com/chinese/grammar/Grammar_points_by_level)
- [AllSet A2 grammar points (99)](https://resources.allsetlearning.com/chinese/grammar/A2_grammar_points)
- [Duolingo alternative for intermediate plateau — Clozemaster](https://www.clozemaster.com/blog/duolingo-alternative-for-intermediate-learners/)
