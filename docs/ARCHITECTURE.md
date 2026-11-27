# Technical Architecture

> Parts of this file above the "Code map" heading predate FSRS, Google sign-in and the MiniMax TTS
> pipeline (they still say SM-2 / gTTS in places). The current rules are in CLAUDE.md and in the
> sections from "Code map" on at the end of this file.

## System Overview

```
┌─────────────────────────────────────┐
│            Browser                   │
│  ┌─────────────────────────────┐    │
│  │        React App            │    │
│  │  ┌───────────────────────┐  │    │
│  │  │  IndexedDB (Dexie)    │  │    │     ┌──────────────────────────────────────┐
│  │  │  - Decks, Notes, Cards│  │    │     │         Cloudflare Edge              │
│  │  │  - Pending Reviews    │  │    │     │  ┌─────────────────────────────┐    │
│  │  │  - Cached Audio       │  │────┼────▶│  │     Cloudflare Worker       │    │
│  │  └───────────────────────┘  │    │     │  │       (API Server)          │    │
│  │                             │◀───┼─────│  └──────────┬──────────────────┘    │
│  │  Study: 100% Local-First    │    │     │             │                        │
│  │  Other: Online with fallback│    │     │    ┌────────┴────────┐              │
│  └─────────────────────────────┘    │     │    │                 │              │
└─────────────────────────────────────┘     │    ▼                 ▼              │
                                            │  ┌─────┐         ┌─────┐           │
                                            │  │ D1  │         │ R2  │           │
                                            │  │(SQL)│         │(Blob)│          │
                                            │  └─────┘         └─────┘           │
                                            └──────────────────────────────────────┘
                                                          │
                                                          │ API calls
                                                          ▼
                                            ┌─────────────────────────┐
                                            │    Anthropic Claude     │
                                            │    (Card Generation)    │
                                            └─────────────────────────┘
```

## Offline-First Architecture (CRITICAL)

**Study mode must work 100% offline.** Users study on subways, planes, and in areas with poor connectivity.

### Local Database (IndexedDB via Dexie)

```
ChineseLearningDB
├── decks            # Cached deck data
├── notes            # Cached notes with audio URLs
├── cards            # Card state (queue, interval, ease, due dates)
├── reviewEvents     # Review events (source of truth for card state)
├── cardCheckpoints  # Cached card state for performance
├── cachedAudio      # Blob storage for audio files
├── syncMeta         # Last sync timestamps
├── eventSyncMeta    # Event sync cursors
└── studySessions    # Local session tracking
```

### Data Flow

**Study Session (Offline-First, Event-Sourced):**
```
1. User starts study
   └─▶ Read cards from IndexedDB (instant)
   └─▶ Compute card state from reviewEvents + cardCheckpoints

2. User rates card
   └─▶ Create review event in reviewEvents
   └─▶ Compute new card state from events (instant)
   └─▶ Update cardCheckpoints cache
   └─▶ Show next card (instant)

3. Background sync (when online)
   └─▶ POST unsynced review events to API
   └─▶ Mark events as synced
   └─▶ Pull new events from server (for multi-device sync)
```

**Other Features (Online with Graceful Fallback):**
```
1. AI Generation, Ask Claude, TTS
   └─▶ Check online status
   └─▶ If offline: Show clear error message
   └─▶ If online: Make API request
   └─▶ On failure: Show error, don't block UI
```

### Key Files

| File | Purpose |
|------|---------|
| `frontend/src/db/database.ts` | IndexedDB schema, queries, daily limit logic |
| `frontend/src/hooks/useOfflineData.ts` | Offline-first React hooks with Dexie live queries |
| `frontend/src/services/sync.ts` | Background sync of review events |
| `frontend/src/services/review-events.ts` | Review event creation and state computation |
| `frontend/src/services/anki-scheduler.ts` | Local SRS calculations |
| `frontend/src/contexts/NetworkContext.tsx` | Online/offline detection |
| `shared/scheduler/compute-state.ts` | Pure function to compute card state from events |

### Daily Limit Tracking

New card limits are enforced locally:
- `dailyStats` caches, per deck and day, how many primary / secondary new cards
  were introduced. `ensureDailyStatsInitialized()` seeds today's rows once per
  app load (single-flight: concurrent callers share one run) by recomputing from
  today's review events — the first-review time of each card involved is fetched
  with one pipelined `getAll(range, 1)` per card in a single read transaction,
  not a cursor walk over every event.
- `getNewCardsStudiedToday()` reads the cache, recomputing only for uncached decks
- `getDueCards(deckId, bonusNewCards)` applies the limit (+ bonus; `Infinity` bypasses)

### Study Session Load Path

Tapping Study calls `getStudyQueue(deckId, bonus)` once: one load of decks, cards
and today's counters produces the due cards, the queue counts and the set of
reviewed notes together. `getDueCards`, `getQueueCounts` and `getReviewedNoteIds`
still exist for other callers and share the same pure selection code, but each
of them scans the cards table on its own — never call all three for one screen
(at ~8k cards each scan was a few hundred ms on a phone, and the loading screen
showed all of them).

### Sync Status UI

The `OfflineBanner` component (bottom of screen) shows:
- **Offline**: Yellow banner with pending review count
- **Syncing**: Blue banner with spinner
- **Pending**: Yellow banner, tappable to trigger sync
- **Synced**: Brief green confirmation (auto-hides after 2s)

The `SyncStatusIndicator` component (small dot for header) shows:
- Gray circle: offline
- Blue spinning: syncing
- Yellow dot: pending reviews
- Green dot: synced (with tooltip showing last sync time)

## Database Schema (D1)

### users
For future tutor feature. Single implicit user for MVP.
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  role TEXT DEFAULT 'student', -- 'student' | 'tutor'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### decks
```sql
CREATE TABLE decks (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### notes
```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL,
  hanzi TEXT NOT NULL,
  pinyin TEXT NOT NULL,
  english TEXT NOT NULL,
  audio_url TEXT,
  fun_facts TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
);
```

### cards
```sql
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  card_type TEXT NOT NULL, -- 'hanzi_to_meaning' | 'meaning_to_hanzi' | 'audio_to_hanzi'
  -- SM-2 fields
  ease_factor REAL DEFAULT 2.5,
  interval INTEGER DEFAULT 0,
  repetitions INTEGER DEFAULT 0,
  next_review_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);
```

### study_sessions
```sql
CREATE TABLE study_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  deck_id TEXT, -- NULL means all decks
  started_at TEXT DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  cards_studied INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (deck_id) REFERENCES decks(id)
);
```

### review_events (Event-Sourced)
```sql
CREATE TABLE review_events (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 0 AND rating <= 3),
  time_spent_ms INTEGER,
  user_answer TEXT,
  recording_url TEXT,
  reviewed_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  -- Debug snapshot (NOT used for state computation)
  snapshot_queue INTEGER,
  snapshot_ease REAL,
  snapshot_interval INTEGER,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);
```

Card state is computed from review events using `computeCardState()`, not stored. Checkpoints cache computed state for performance.

### card_checkpoints (Performance Cache)
```sql
CREATE TABLE card_checkpoints (
  card_id TEXT PRIMARY KEY,
  checkpoint_at TEXT NOT NULL,
  event_count INTEGER NOT NULL,
  queue INTEGER NOT NULL,
  learning_step INTEGER NOT NULL,
  ease_factor REAL NOT NULL,
  interval INTEGER NOT NULL,
  repetitions INTEGER NOT NULL,
  next_review_at TEXT,
  due_timestamp INTEGER,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);
```

## R2 Bucket Structure

```
chinese-learning-audio/
├── generated/           # TTS-generated audio
│   └── {note_id}.mp3
└── recordings/          # User recordings
    └── {review_id}.webm
```

## SM-2 Algorithm Implementation

```typescript
interface SM2Result {
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewAt: Date;
}

function calculateSM2(
  rating: 0 | 1 | 2 | 3,
  currentEaseFactor: number,
  currentInterval: number,
  currentRepetitions: number
): SM2Result {
  let easeFactor = currentEaseFactor;
  let interval: number;
  let repetitions: number;

  if (rating < 2) {
    // Failed - reset
    repetitions = 0;
    interval = 1;
  } else {
    // Passed
    repetitions = currentRepetitions + 1;

    if (repetitions === 1) {
      interval = 1;
    } else if (repetitions === 2) {
      interval = 6;
    } else {
      interval = Math.round(currentInterval * easeFactor);
    }
  }

  // Adjust ease factor based on rating
  easeFactor = easeFactor + (0.1 - (3 - rating) * (0.08 + (3 - rating) * 0.02));
  easeFactor = Math.max(1.3, easeFactor); // Minimum 1.3

  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + interval);

  return { easeFactor, interval, repetitions, nextReviewAt };
}
```

## Audio Generation Flow

### TTS Generation (gTTS)
Since Cloudflare Workers can't run Python/gTTS directly, we have options:

**Option A: External TTS Service (Recommended)**
Use a TTS API like:
- Google Cloud Text-to-Speech
- Amazon Polly
- Azure Speech Service

**Option B: Browser-based TTS**
Use Web Speech API on client side, but quality varies.

**Current Implementation**: Use Google Cloud TTS API (or similar) called from the Worker.

```typescript
async function generateAudio(text: string, language: string = 'zh-CN'): Promise<Blob> {
  // Call TTS API
  // Upload to R2
  // Return URL
}
```

### User Recording Flow
1. Browser MediaRecorder API captures audio
2. Audio blob uploaded to `/api/audio/upload`
3. Worker stores in R2, returns URL
4. URL saved with card_review

## AI Card Generation

### Prompt Structure
```typescript
const systemPrompt = `You are a Chinese language learning expert. Generate vocabulary cards for Mandarin Chinese learners.

For each vocabulary item, provide:
- hanzi: Chinese characters
- pinyin: Romanized pronunciation with tone numbers (e.g., "ni3 hao3")
- english: Clear English translation
- fun_facts: Optional cultural context, usage notes, or memory aids

Return as JSON array.`;

const userPrompt = `Generate 10 vocabulary items about: ${topic}

Focus on practical, commonly-used words and phrases.
Include a mix of single characters and multi-character words/phrases.`;
```

### Response Format
```json
{
  "deck_name": "Zoo Animals",
  "deck_description": "Common animals you might see at a zoo",
  "notes": [
    {
      "hanzi": "熊猫",
      "pinyin": "xiong2 mao1",
      "english": "panda",
      "fun_facts": "China's national treasure. The name literally means 'bear cat'."
    }
  ]
}
```

## Frontend Architecture

### Page Structure
```
/                     # Home - dashboard with due cards, recent activity
/decks                # List all decks
/decks/new            # Create new deck
/decks/:id            # View/edit deck and its notes
/decks/:id/notes/new  # Add note to deck
/notes/:id/edit       # Edit note
/study                # Study session (select deck or all)
/study/session/:id    # Active study session
/study/review/:id     # Review completed session
/stats                # Statistics dashboard
/generate             # AI deck generation
```

### State Management
Using React Query for server state:
- Automatic caching and invalidation
- Optimistic updates for smooth UX
- Background refetching

### Audio Handling
```typescript
// Recording
const useAudioRecorder = () => {
  const [recording, setRecording] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder.current = new MediaRecorder(stream);
    // ...
  };

  return { recording, startRecording, stopRecording, audioBlob };
};

// Playback
const useAudioPlayer = (url: string) => {
  const audio = useRef(new Audio(url));
  const play = () => audio.current.play();
  return { play, pause, isPlaying };
};
```

## Deployment

### GitHub Actions Workflow
```yaml
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4

      - name: Install dependencies
        run: npm ci

      - name: Build frontend
        run: npm run build:frontend

      - name: Deploy Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT }}
```

### Environment Configuration
Worker environment variables (in wrangler.toml or Cloudflare dashboard):
- `ANTHROPIC_API_KEY`: For AI generation
- D1 binding: `DB`
- R2 binding: `AUDIO_BUCKET`

## Security Considerations

### Current (MVP)
- No authentication (single user assumed)
- CORS configured for frontend origin only

### Future (with Auth)
- Cloudflare Zero Trust for authentication
- JWT validation in Worker
- Role-based route protection
- User data isolation

## Performance Optimizations

1. **Edge Computing**: Worker runs at edge, low latency globally
2. **D1 Caching**: D1 has automatic query caching
3. **R2 CDN**: Audio served from Cloudflare CDN
4. **React Query**: Client-side caching reduces API calls
5. **Lazy Loading**: Audio loaded on demand, not upfront

## Code map (moved from CLAUDE.md, Nov 2026)

The detailed project tree: one entry per module with what lives where.

## Project Structure

```
/
├── worker/                 # Cloudflare Worker (API backend)
│   ├── src/
│   │   ├── index.ts       # Main entry point, routes
│   │   ├── routes/        # Hono sub-routers mounted from index.ts (insights, lesson-editor, tutor-notes, test-auth, calls)
│   │   ├── durable/       # Durable Objects (call-room.ts — video-call signalling / whiteboard / chat)
│   │   ├── services/      # Business logic (FSRS scheduler, AI, TTS); services/content = the ONE write path for decks / notes / cards; services/claude-agent = the ONE harness every Claude chat turn goes through
│   │   ├── db/            # Database queries and migrations (lesson-library-queries.ts for the library/editor)
│   │   └── types.ts       # TypeScript types
│   ├── wrangler.toml      # Cloudflare Worker config
│   └── package.json
│
├── shared/                # Shared code between worker and frontend
│   ├── scheduler/         # FSRS spaced repetition algorithm
│   │   ├── compute-state.ts    # Core FSRS logic, state computation from events
│   │   ├── compute-state.test.ts # Tests for scheduler
│   │   └── index.ts       # Re-exports
│   ├── audio-lesson/      # Audio lessons (docs/AUDIO_LESSONS.md): plan types (DialoguePlan / SleepPlan / StoryPlan), compile.ts (plan → speech/pause script, RATES / PAUSES), dialogue-tones.ts (a dialogue word's tone lines from its pinyin: "打, dǎ, third tone."), story.ts (the story splitter, compileStoryLesson, the 60-min cap), validate.ts, timeline.ts (chapters / transcript in ms, player helpers), input.ts
│   ├── watch/             # 📺 Watch (docs/WATCH.md): YouTube link parser + the five shows (video.ts), the player's line rules — line on screen, focus, seek / pause points, Pause after each line, listen-first reveal, speeds (lines.ts; Lab core watch/Watch.kt, parity-tested), the transcript plan / Gemini line parsing / tidying (transcript.ts, worker only)
│   ├── idioms/            # 成语 Idioms (beta, docs/IDIOMS.md): the entry shape (types.ts), starter list (~46), cache key + explorer link rule (normalize.ts), validator (validate.ts), "+ Add as card" fields (card.ts), sample entry — parity-tested by the Lab app
│   ├── clips/             # 🎬 Clips (EXPERIMENTAL, docs/CLIPS.md): the clip spec v1 (types.ts; CLIP_SPEC_DOC in doc.ts = what every clip-writing Claude reads; interactive layouts quiz / listen / order / reveal / speak), validateClipSpec, the scene timeline + what each scene says and in which voice (timeline.ts: sceneUtterances, sceneRevealUtterances, storyCast), the clip clock (playback.ts: clipTick — scenes hold for their audio, an interactive scene waits for the learner, Skip after 6 s; clipOrderShuffle), karaoke caption timing (karaoke.ts), the lo-fi music + ducking (music.ts; loops by scripts/audio/generate-clip-music.mjs), the feed order + Learn more offers (feed.ts), samples — parity-tested by the Lab app
│   ├── meme-review/       # 梗 Meme review (PROTOTYPE, docs/MEME_REVIEW.md): the monthly issue shape (types.ts), the validator — URLs must come from the agent's search results, pinyin re-derived (validate.ts) —, labels / card fields / URL rules (rules.ts), the sample submission — app-side rules parity-tested by the Lab app
│   ├── phone/             # 📱 Phone practice (docs/PHONE_PRACTICE.md; Lab port android-lab/core/…/phone, parity-tested): simulated Chinese phone apps with real-life tasks — the scenario spec (types.ts) + validateScenarioSpec, the engine (event log → latest records, declarative goal / mistake conditions, hints, results), each fictional app's rules (rail.ts 选座 / 退票 fees / 改签, ride.ts, food.ts 起送 / 满减 / 红包, movie.ts seat-map rules, dine.ts, wallet.ts), persona.ts (Claude role-play prompt, limits, reply cleaning, the E2E stand-in), 18 bundled scenarios (scenarios/) — pure TS for the Lab port
│   ├── cards/             # Card standard, word checks, answer checking (answer.ts; spoken-result.ts = the spoken answer's compact "You said" row; answer-diff.ts = the slim answer feedback every "how your answer differs" surface uses — the verdict line + his answer lined up with the expected one, COLOUR ONLY — no box / tint / underline (wrong rose · extra violet · missing = the expected character in grey · tone off amber; tokens `--mark-*` in index.css / Lab `LabColors.mark*`, each ≥ 4.5:1, tested) + ONE short line "Tone off on 都" / "2 wrong characters, 1 missing" + ONE "why" sentence from the check ("Correct — 一个 is optional here.", a homophone's "Same sounds — written differently: 由 vs 油") and a small "Explain more ›" that opens the check's tips / fix in place (answer-why.ts `answerWhy` / `answerMore`, web components/study/AnswerWhy.tsx, Lab ui/study/AnswerWhyLine.kt + core AnswerWhy.kt, parity-tested); Lab core AnswerDiff.kt parity-tested; web components/study/AnswerDiff.tsx, Lab ui/study/AnswerDiffView.kt; docs/STUDY_SESSION.md "Answer feedback: one line and a diff"), word tags (word-tags.ts = the tagger; word-tags-build.ts + word-tags-curated.ts = the lexicon build), pictures on cards (note-image.ts: which side shows the picture, the prompt, the estimate — parity-tested by the Lab app)
│   ├── picture-hunt/      # Picture hunt (看图找词): types (normalised boxes / outlines), answer matching (match.ts), hit-testing (geometry.ts), feedback copy, validation — parity-tested by the Lab app
│   ├── quest/             # Quests: the tile-map mini-game framework
│   │   ├── types.ts       # World schema (terrain, objects, verbs, goal conditions)
│   │   ├── engine.ts      # Pure game engine — movement, verbs, goal checking
│   │   ├── validate.ts    # Playability checks for generated worlds
│   │   └── index.ts       # Re-exports
│   ├── lesson/            # Custom mini lessons: agent-authored lesson schema
│   │   ├── types.ts       # Lesson spec (sections of exercises, 17 exercise types)
│   │   ├── registry.ts    # One entry per exercise type (name, icon, skill, how it's checked) — every type list reads it
│   │   ├── doc.ts         # LESSON_SPEC_DOC: the spec text every lesson-authoring Claude reads (worker + MCP)
│   │   ├── pattern.ts     # Structure cards (docs/STUDY_SESSION.md "Structure cards"): a note's `patterns` (fixed words + slots, meaning, examples mapped by `parts`), the parser that reads older free-text structures ("① 除了 + 名词 +（以外），主语 + 还 + 动词") into the same cards + matches / aligns their sentences, colour roles (`pieceTones`), ✗ / ✓ text blocks — Lab core LessonPatterns.kt, parity-tested
│   │   ├── patternIntro.ts # "▶ Watch the intro" on a structure card (docs/STUDY_SESSION.md "Structure intro"): the card as a 🎬 clip (`pattern` layout), the simple-Chinese voice-over (`patterns[].intro`, else a template), its prefetch texts, the lit part — Lab core LessonPatternIntro.kt, parity-tested
│   │   ├── learnerStructures.ts # The grammar structures of the lessons a learner has DONE (patterns / parsed free text): builder, the prompt mix (recent + practised), `structureUsedBy` — the sentence generator uses them (worker cache `learner_structures`, docs/STUDY_SESSION.md "Fresh sentences every showing")
│   │   ├── samples.ts     # Bundled sample lesson per type (tutor catalogue)
│   │   ├── voices.ts      # Conversation voices: curated MiniMax catalogue (default_on), enabled pools, per-dialogue rotation (conversationVoicesFor), 0.9× speed + 200 ms turn gap
│   │   ├── conversationAudio.ts # Conversation audio prefs (speed / delivery / voices per provider, per-conversation choices), resolveConversationAudio — docs/AUDIO.md "Conversation audio"
│   │   ├── introWarnings.ts # Soft warning: a note before a conversation that quotes its dialogue (spoiler intro)
│   │   ├── answer-check.ts # Typed-hanzi checking + character diff (diffHanzi)
│   │   ├── choiceMistake.ts # "Which sentence is wrong?" choices never speak the mistake: detection (`correction` or the question, EN / 中文), the correction spoken / shown instead, `POST /api/lessons/choice-correction` for older lessons (cached for everyone) — Lab `ChoiceMistake.kt`, parity-tested; docs/STUDY_SESSION.md "Which sentence is wrong?"
│   │   ├── scrambleOrder.ts # Word order rearranged by hand: drop slot over wrapped rows (`scrambleDropSlot`), zone, preview / drop (moved · inserted · removed), nudge (arrow keys / Lab Move left · right) — web `components/lessons/useScrambleDrag.tsx`, Lab `ScrambleOrder.kt` + `ui/lessons/ScrambleBoard.kt`, parity-tested (docs/STUDY_SESSION.md "Word order — rearrange by dragging")
│   │   ├── scrambleCheck.ts # Word order: an order the lesson didn't list (every tile, online) → Claude's answer check (`exercise_type: 'scramble'`): Checking… in place → ✓ Also right (scored right) / ✗ Not quite + Claude's line; offline = ✗ (Lab `ScrambleCheck.kt`, parity-tested); doc.ts `SCRAMBLE_ALT_ORDERS_RULE` = list every natural order in alt_orders
│   │   ├── attempt.ts     # Per-exercise attempt data (answers, time, recordings) + server sanitizer
│   │   ├── feedback.ts    # The answer screen's feedback for every exercise type (docs/STUDY_SESSION.md "Feedback"): which moments are felt (StudyFeel + a small confetti burst), "Claude is checking…" placed below the buttons (no layout jump), 🎤 Say it again targets (practice only) + Claude's fix, "Another way to say it:" (Lab LessonFeedback.kt, parity-tested)
│   │   ├── handwriting.ts # "Skip handwriting exercises": which exercises the switch leaves out, typed dictation, the attempt's "skipped (handwriting off)" rows (Lab Handwriting.kt, parity-tested)
│   │   ├── validate.ts    # Structural validation for agent-authored specs
│   │   ├── diff.ts        # Structural diff of two specs (editor chat proposals, "what changed")
│   │   ├── export.ts      # Markdown / JSON / CSV exporters (pure; used by worker and offline frontend)
│   │   ├── audioClips.ts  # Every clip a lesson plays (lessonAudioClips), prefetch order, lessonsToPrefetch — device prefetch + server pre-generation (docs/AUDIO.md "Lesson audio prefetch")
│   │   └── index.ts       # Re-exports
│   ├── calls/             # Video calls: whiteboard ops, WebSocket protocol, transcript merge, video fit / PiP (videoFit.ts), the shared text board CRDT (textDoc.ts), board pages across lessons (pages.ts), call alerts (alerts.ts), drawing on a shared screen (annotate.ts), board tab-complete rules (gloss.ts), Same view — one shared stage for both, My own view, Bring to my view (view.ts), Stop their share (follow.ts), camera on at join (devices.ts), the call timer (timer.ts), join / leave chimes + call sounds (chime.ts) (see docs/VIDEO_CALLS.md)
│   ├── group/             # 🧪 Group classes — EXPERIMENTAL web-only prototype (docs/GROUP_CLASSES.md): room rules (mute / spotlight / hands, room.ts), quick quiz (quiz.ts), gallery / active speaker (layout.ts), the GroupRoom protocol; worker durable/group-room.ts + routes/group-classes.ts, web pages/group/
│   ├── call-activities/   # In-call activities: two-person mini lessons (describe & guess, info gap, role-play, sentence building, quick quiz, dictation) — spec types, the state machine the CallRoom runs (engine.ts), the sample catalogue; parity-tested by the Lab app; prepared.ts = activities prepared for one student from their previous lessons (prepared:<id> ids, parseGeneratedActivity, ordering, preview)
│   ├── materials/         # Lesson materials: kinds, limits, page text, `material:<id>:<page>` annotation targets, presented-material shape, PPTX_RENDER_NOTE
│   ├── claude/            # Claude threads (docs/CHAT.md "Claude threads"): context.ts = the thread context descriptor (general · card · practice · chat_message), intents (ask · check · explain · translate), parseClaudeContext, contextRef, contextBadge ("📇 Asked on card · 银行"), titleFor, previewOf; api.ts = the `/api/claude/threads*` row shapes + the live `claude_turn` event; threadCache.ts = how a device merges what the server sends over its cached threads (`sortMessages`, `mergeMessage` — a streamed reply keeps its longer text —, `mergeThreadMessages`, `applyTurnFrame`, `mergeThreadList`; a thread started offline is titled by `titleFor` / `previewOf` in context.ts) — web `services/claudeThreads.ts` / `claudeInbox.ts`, Lab core `claude/ClaudeThreadCache.kt` + `ClaudeChats.titleFor`, parity-tested; contexts.ts = what the thread screen offers per context (docs/CHAT.md "Claude thread view"): `chipsFor` (card = `cardChips`, was askQuickActions), `composerFor` (Ask; a new general chat + Check / Explain / Translate), `headerChipFor`, `resumeThreadFor`, `claudeReplyPollMs` (400 ms × 10 s → 1.5 s), `turnStatusLine` — Lab core `claude/ClaudeChats.kt`, parity-tested; cardTools.ts = Claude's card tools in a card thread (`cardToolEffects` — what the device does once per reply —, `cardToolLines` "✓ Claude edited this card · Undo", `toolResultLink` — every line opens what it made: 🎓 → the lesson player, ✓ cards → the card / deck, ⚡ → the card / Up next; back returns to the thread / the study card's sheet, docs/CHAT.md "Tool lines you can tap" —, `undoEditFields`, `earlierCardThreads` / `earlierCardThreadsLabel`) — Lab core `claude/CardTools.kt`, parity-tested; inbox.ts = the unified Chats tab (docs/CHAT.md "Chats tab — one list for people and Claude"): `mergeInbox` (people + Claude threads in one list, kinds tutor / student / claude, a learner's unread tutor chats pinned, an old `is_ai` practice chat shown once, archived out), `inboxSections` (people · a thin divider · Claude), `inboxRowLabel` (the kind in words for screen readers), `claudeRowStatus` (Writing… / Failed / Waiting where the time goes), `contextOpenLabel` (the context emoji's "Open card ›"), `filterInbox` — Lab core `claude/ClaudeInbox.kt`, parity-tested; practice.ts = Practice with Claude (docs/CHAT.md "Practice with Claude"): the situations / levels of the "🎭 Practice a situation" sheet, `practiceContext`, `practiceFromCard` (🎭 Roleplay this word), `practiceVoiceFor` (the persona's read-aloud voice), `isPracticeHelpRequest` / `practiceReplyLanguage` — Lab core `claude/ClaudePractice.kt`, parity-tested; visibility.ts = what the tutor can read of the learner's Claude chats (docs/CHAT.md "What your tutor sees"): `tutorCanSee(thread, setting)` (card_only default · all · none; a thread's `tutor_visible` wins), `nextTutorVisible` (the ⋯ toggle), the Settings / menu / tutor-view words — Lab core `claude/TutorVisibility.kt`, parity-tested
│   ├── add/               # ＋ Add tab (docs/ADD_TAB.md): add.ts = the content tiles + result lines, the word input's kind, photo → OCR rules (ocrChineseText: a busy line cut to its Chinese; orderOcrLines: the big central line first; ocrSpan: ✂ Pick; the 1280 px resize) — Lab core add/AddTab.kt, parity-tested
│   ├── chats/             # system.ts = system messages (the platform's lines on someone's behalf, third person per viewer); threads.ts = `THREAD_GAP_MS` (30 min, one card thread) + `sqliteToIso`; inbox.ts = the Chats tab rules (sort, preview, relative time, search, badge, live updates); personLinks.ts = the chat as the way in to the person (header → their page, the ⋯ menu's links, Home's connection-request line) — parity-tested by the Lab app
│   ├── study/             # "New day starts at" — the study day (studyDay.ts: `studyDayAt` / `studyDayKey` / edges in a zone, java.time gap / overlap rules, rollover 0–6 default 4, `studyCutoffMs`, the fixed-offset day + SQL shift for the server; web services/studyDay.ts, Lab data/StudyDayClock.kt, core StudyDayRule.kt (object StudyDay) parity-tested incl. DST; docs/STUDY_SESSION.md "When does a new day start"), Hard mode (hardMode.ts: Off · Red cards only · All — reading, meaning AND listening cards; the question's own answer checked first, ✗ Try again, 👁 Show answer = the answer in place then "Continue to the sentences ›"; Good / Easy GREYED never locked — `goodEasyGate` + `overrideTap`: a second tap within 3 s rates, Hard suggested, `study.hard_mode_override`; a right answer you can feel — `StudyFeel` haptic + sound per moment, web services/studyFeel.ts, Lab fx/StudyFeel.kt; then the Sentence round; docs/STUDY_SESSION.md "Hard mode"), a meaning → hanzi SENTENCE the device didn't accept checked by Claude on Hard mode's question — the lesson answer check, correct / acceptable = right, almost = ≈ Nearly, the card's answer + "You said" vs it shown AT ONCE with the verdict loading in under them (`sentenceCheckView`; since Nov 2026 the slim answer feedback — Claude's verdict is the chip of ONE line over the diff + ONE why sentence, its tips / fix only behind "Explain more ›"; 🎤 Read it again under "You said" until Claude says right, practice only), 🔁 Try again / ✏️ Type it (sentenceAnswerCheck.ts; docs/STUDY_SESSION.md "Sentence answers checked by Claude"), a read card's take the device judged ✗ (2+ characters, online) checked by Claude as a read-aloud check — Checking… → ✓ Right / ≈ Close / ✗ with ONE line from the diff + ONE why sentence (Claude's reason), the tip behind "Explain more ›" (readTakeCheck.ts; docs/STUDY_SESSION.md "Read takes checked by Claude"), "Today is the session": active study time per day (activeTime.ts), resume the card left on screen (resume.ts), celebrate-once rule (celebration.ts), Home's numbers right after a session — the newest of the session's own and Home's recount (homeCounts.ts; web services/sessionCounts.ts + the ONE shared live count services/queueCountsStore.ts, Lab data/study/SessionCountsBus.kt; docs/STUDY_SESSION.md "Back on Home"), mini lesson runs — saved, the retry round (lessonRun.ts) — and revise until right first time (lessonRevision.ts), graded readers read once / one a day / ▶ Play whole story (daily-reader.ts), never-seen characters shimmer on the card (newCharacters.ts; docs/STUDY_SESSION.md "New characters shimmer"), 🎤 on the sentence rows + the Good / Easy gate (sentencePractise.ts) and the Sentence round between question and answer — 4 exercises, any 2 right, FRESH sentences first (never practised in either mode) then the least known, a buffer of fresh ones refilled in the background (`moreSentencesWanted`, sentenceHistory.ts); **Sentences by ear** (Settings → Study, per device, ON by default): a read slot is a 👂 listen exercise when the sentence has a clip — autoplay, no text, the meaning in English voice-first, checked by the lesson answer check as a meaning check (`listenCheckInput`, `isMeaningCheck` in shared/lesson/answerCheck.ts) online / self-check offline — never faulting what the ear can't tell (he / she / it = tā, an unmarked tense or number: `forgiveUnheard` in shared/lesson/heardCheck.ts, Lab `HeardCheck.kt`, parity-tested; docs/STUDY_SESSION.md "What the ear can't tell") —, the reveal at once with the verdict below; history mode `listen` (sentenceRound.ts `canListenTo` / `listenActiveId` / `exerciseAsRead`; docs/STUDY_SESSION.md "Sentences by ear"); the listening card's round = up to 3 "Say it in Chinese" over the English sentences carrying the word, offline self-check (sentenceRound.ts `pickListenRoundExercises`); stopping a 🎤 take is intentional — no tap-anywhere, a pinned "■ Stop recording" (sentencePractise.ts `sentenceStopBar`), practice per sentence + hidden sentences (sentenceHistory.ts), the listening card's "Listen in context" question — audio-only sentence rows, the word last, "Try the sentences first?", auto-play, top-up (listenContext.ts), 🎤 on the example sentence rows + "Get two sentences right before Good / Easy" (sentencePractise.ts), the reader word recap — words tapped while reading → "📝 Recap N words" one-off pass + 🎤 Say it, switches OFF by default → "From my readers" + Up next or ⚡ (wordRecap.ts; docs/STUDY_SESSION.md "Reader word recap") — parity-tested by the Lab app
│   ├── progress/          # Progress numbers (daily 30-day summary, day cards, streak, mastery): the definition the server's /api/progress SQL follows (worker my-progress-parity test) and the Lab app ports; cardSql.ts = THE server SQL for "mastered" (`MASTERED_CARD_SQL`: Review + stability > 21 d = `masteryLevel`) and "reviews due" (`reviewDueSql`) — never `interval > 21` (guard test `worker/src/services/__tests__/card-sql-guard.test.ts`)
│   ├── folders/           # Folders for decks / library lessons / readers: groupIntoFolders (any depth), nesting rule (parentProblem: ≤ MAX_FOLDER_DEPTH = 5 levels, no cycles), folderPath / findFolderByPath, name rules, spliceGroupOrder, collapsed keys, copy (deleteFolderMessage, movedMessage) — parity-tested by the Lab app
│   ├── explorer/          # The language explorer (docs/LANGUAGE_EXPLORER.md): the view stack (stack.ts: open / push / pop / popTo / close, breadcrumbTrail, itemForText), Word view facts (word.ts: wordChars + tones, wordFrequencyLabel, resolveWord dictionary-first), related words (related.ts), ExplorableText's segments (segments.ts), quick drills (drill.ts), "+ Add as card" before the meaning has loaded — wait, gloss, else the fill sheet (addCard.ts) — parity-tested by the Lab app
│   ├── chars/             # The character dictionary (card-independent): CharRecord, build rules from CC-CEDICT / Make Me a Hanzi / wordfreq (build.ts, msgpack.ts; scripts/build-char-dict.ts), the sheet's word statuses known / in_decks / none (status.ts — parity-tested by the Lab app)
│   ├── chinese/           # Deterministic word segmentation (segment.ts, jieba-style DAG + DP over the shipped word-freq.txt + segment-words.txt, a few rules: numbers + measure words, AA / AABB, A一A / A不A, word + 儿): word chips without an LLM for Ask Claude (always), chat + reader pages (while Claude's words are missing / failed) — Lab chinese/Segmenter.kt, parity-tested over __fixtures__/corpus.txt
│   ├── feedback/          # In-app feedback (docs/FEEDBACK.md): the context filter (pickFeedbackContext — diagnostics only), routePattern, the context line, copy, limits; shake.ts = the ONE "shake the phone" rule (shakeStep) — Lab core feedback/Feedback.kt, parity-tested
│   ├── voice/             # dictation.ts: the voice-first text box rules (say it, or type it — voice default, review row, typing fallback with a reason, what Submit sends); web components/voice/VoiceTextInput.tsx, Lab ui/kit/VoiceTextField.kt — parity-tested; takeLock.ts = the take lock: while a voice take records, a screen's primary action is "■ Stop recording" and never advances, back / ✕ stop the take first (web components/voice/TakeLock.tsx `TakeLockProvider` / `useReportTake` / `TakeLockActions` — every useVoiceDictation / useSpeakingTake reports itself; Lab core TakeLock.kt + ui/kit/TakeLock.kt, parity-tested; the mini-lesson player has its own provider; everywhere else `useReportTake` lands in the APP-WIDE lock — web services/takeLock.ts (`guardTake` / `takeTap` / `useAppTakeLock`, `ownBack`) + components/voice/TakeStop.tsx (`TakeLockedActions`, `TakeBackGuard` in App.tsx), Lab `TakeLocks` / `TakeLockedActions` / `TakeBackGuard` in ShellFrame, `LabModalSheet` refuses to hide mid-take: the study card / pass, sheets, chats, clips, phone; docs/STUDY_SESSION.md "Feedback", "While a take is recording")
│   ├── pinyin/            # applyYiBuToneChanges: the 一 / 不 tone changes every automatic pinyin goes through (Lab ToneChange.kt, parity-tested)
│   ├── decks/             # source-decks.ts ("+ Add as card" goes straight into a deck per source — keys, names, the `source:<key>` ref, explorer / sheet → source; Lab SourceDecks.kt, parity-tested); open-links.ts ("Open ›" on the toasts — ✓ Added → the card / the deck, ⚡ … added to today → the card / Up next; web components/nav/ToastOpen.tsx, Lab core OpenLinks.kt + ui/kit/ToastOpen.kt, parity-tested; docs/STUDY_SESSION.md "Open ›"); lead-card.ts (which card introduces a new word: audio_to_hanzi with "Start new words by ear" (default), else meaning_to_hanzi when every character is known; the purple pool's listening-first order); DEFAULT_DECK_SETTINGS (3 new + 6 secondary a day) + pickDeckSettings validation — the one definition of a new deck; budget.ts / study-queue.ts / novelty.ts / new-card-order.ts ("Order new cards by": new characters, new words, everyday before formal, most common, sentences last) + formality.ts (a word's everyday / neutral / formal class from the word-tag lexicon + AI tags) + frequency.ts (the shipped wordfreq list, `shared/data/frequency/word-freq.txt`); the study queue ("due today", introduced today, Home counts: study-queue.ts); queue moves + drag hit-test (queue.ts), card search noteMatches (search.ts), "⚡ Study it today" bump pocket (bumps.ts), the "Up next" list of chosen notes introduced first within the budget (up-next.ts), Suspend & snooze + "don't show a word's other card types on the same day" (holds.ts) — all parity-tested by the Lab app; leeches + "Forget this card" words / leechInfo live in `shared/cards/leech.ts`, forget events in `shared/scheduler`
│   ├── recordings/        # "Needs your ear": queue rule + labels (queue.ts), transcript ↔ card comparison (transcript.ts), mix-ups (mixups.ts) — docs/RECORDING_REVIEW.md
│   ├── text/              # numberHanzi.ts: number ↔ hanzi normalisation (transcripts, typed answers); `digitsToHanzi` = digits only (3块 → 三块, 2026年 → 二〇二六年) — the lesson answer check's keys, "You said" marks, Claude's corrected line + its pinyin (Lab `AnswerKey.digitsToHanzi`, parity-tested)
│   ├── students/          # The tutor's private student profile: validation, the prompt block every tutor-side content agent reads (studentProfilePrompt), examples, chips; coverage.ts = "What <student> has covered" (coverageHeadline, coveragePrompt)
│   ├── profile/           # Editable profile: pickProfileUpdate (name / bio / about / time zone → problems), limits, localTimeLabel
│   ├── homework/          # Homework assignments (docs/HOMEWORK.md): due labels, split over days, the one-off pass, Hard mode in the pass + a second angle per word (pass-angles.ts, §3e — its own per-device setting, default All), the retry progress bar (retry-bar.ts; web components/homework/RetryProgressBar.tsx, Lab ui/kit/RetryProgressBar.kt — reusable by any pass with retries; also on every STARTED homework / lesson row), the row menu — Skip this homework / done for good / delete / skip handwriting (row-actions.ts, §3d), dedupe, load gauge, draft plan, Home's compact card rows incl. mini lesson revisions due + new tutor-sent lessons — never his own never-started or cancelled ones; /homework lists the same lesson rows (home.ts), sizes "18 exercises · ~12 min" (size.ts), the tutor's homework library + statuses (library.ts), link homework (link.ts), the one-off headline + long-term decks (summary.ts) — pure, unit-tested
│   ├── tutor-notes/       # "Notes from your tutor": new / earlier merge, Home line, the practice rule (a rating counts only when the card is due) — parity-tested by the Lab app
│   ├── debug/             # Study-state debug reports: ONE report shape (web + Lab app), eventIdHash, compareDebugReports (pure diff)
│   ├── strokes/           # Handwriting practice: pure stroke matcher (right stroke / order / direction) + per-character quiz + result shapes (docs/STROKE_ORDER.md)
│   ├── import/            # "Paste a list" word importer: pure parser (separators, column roles), planner (add / update by hanzi), pinyin helpers
│   ├── tts/               # TTS provider settings (TtsConfig: stored / live order, voices, max RPM, conversation_rate), voice catalogues, validation, speed mapping (docs/AUDIO.md "Providers"); conversation.ts = conversation rates / voices / deliveries per provider
│   ├── vr/                # 🥽 VR (beta, docs/VR.md): VrPanelSpec + validateVrPanelSpec (a window is DATA: kind + params, never code), placement maths (ring at arm's length, facing, clamping, dragging, tray) — web only
│   └── reader/            # Graded readers as one spec (reader editor, Claude co-editor, exports)
│       ├── types.ts       # ReaderSpec (titles, difficulty, topic, vocabulary_used, ordered pages)
│       ├── validate.ts    # validateReaderSpec / normalizeReaderSpec
│       ├── diff.ts        # Page-level diff (added / removed / moved / changed by id, content or similarity)
│       ├── export.ts      # Markdown / re-importable JSON / Quizlet CSV
│       ├── words.ts       # Word chips: alignReaderWords (concat invariant), parseReaderWords, sentenceAround
│       ├── queue.ts       # The reader queue ("Up next"): compareReaderQueue (unplaced newest first, then queue_priority high → low), moves, bottom priority — parity-tested by the Lab app
│       ├── audioBlocks.ts # Page narration → phrase blocks at the pauses (RMS envelope, adaptive threshold) — parity-tested by the Lab app
│       ├── blockPlayback.ts # The scrubber's restart point: advance per block, pause → this block (or the previous within 1 s) — parity-tested
│       └── readAloud.ts   # 🎤 Read it aloud on a page: the take judged character by character against the page (numbers / 两 / homophones by sound in context, tone = close, missed, extras), score + line, the page lock while recording, all-right (confetti), what it heard vs the page per word — parity-tested (web components/reader/ReadAloud.tsx, Lab ui/readers/ReadAloudViews.kt)
│
├── frontend/              # React + Vite frontend
│   ├── src/
│   │   ├── components/    # React components (components/editor/ = lesson editor shell, chat, forms; components/tutor/ = students dashboard, setup checklist, send-homework sheet)
│   │   ├── components/nav/ # Bottom tab bar (TabBar), role derivation (useNavRole), landing rule (landing.ts), maintenance actions
│   │   ├── pages/         # Page components (StudyPage, DecksPage, MorePage, DeckDetailPage, etc.; pages/editor/ = library + editor)
│   │   ├── vr/            # 🥽 /vr (beta, docs/VR.md): WebXR room (three.js + @react-three/fiber, lazy `vendor-three` chunk) — windows are canvas panels drawn from UI nodes (ui/), one trusted builder per panel kind (panels/: study = useStudySession, reader, homework pass, explorer, mini lesson, feedback), one pointer pipeline for mouse + XR rays (scene/interaction.ts), windowStore.ts (positions per device)
│   │   ├── services/anki/ # Client-side Anki .apkg export (sql.js + JSZip): builder, deck/lesson/reader adapters, audio resolution
│   │   ├── components/import/ # PasteWordsModal — paste a word list, preview add / update rows, fill gaps, save, update students' copies
│   │   ├── components/export/ # AnkiExportModal — options / progress / result UI (lazy-loads services/anki)
│   │   ├── hooks/         # Custom React hooks (useAudio, etc.)
│   │   ├── api/           # API client functions
│   │   └── types.ts       # TypeScript types
│   ├── vite.config.ts
│   └── package.json
│
├── mcp-server/            # MCP Server for AI assistant integration
│   ├── src/
│   │   └── index.ts       # MCP tools and server setup
│   ├── wrangler.toml      # Separate worker config (shares D1 database)
│   └── package.json
│
├── android-lab/           # Experimental PURE-NATIVE Android app (Kotlin + Compose), beside the hybrid app — see android-lab/README.md
│   ├── core/              # Pure Kotlin ports: FSRS (ts-fsrs), budget, study queue, answer check, Anki .apkg ids / GUIDs / rows (core/…/anki, the app writes the SQLite + zip) — parity-tested against the TS
│   ├── parity/            # generate-fixtures.ts: runs the web app's TypeScript to make the golden vectors
│   ├── app/               # Android app: Room mirror + sync (same API), Compose UI, haptics/sounds; ui/nav = web tab bar + routes by web path (FeatureGraphs registry), data/platform = JsonCache + Outbox
│   ├── docs/UI_KIT.md     # Shared Compose pieces + screenshot helper
│   └── PARITY.md          # Parity checklist, split into work packages A–J with file ownership
│
├── desktop/               # Electron desktop app (prototype, see desktop/README.md): the web app in a window + native share picker + a click-through overlay that draws call annotations on the real shared screen; bridge contract shared/desktop/bridge.ts, page side frontend/src/services/calls/desktopOverlay.ts
│
├── native/                # Capacitor Android wrapper (see native/README.md)
│   ├── capacitor.config.json  # Remote server.url points at the deployed PWA
│   ├── android/           # Native project: widget, PROCESS_TEXT, deep links
│   └── www/               # Placeholder only (app loads the live site)
│
├── docs/                  # Documentation
│   ├── SPEC.md           # Feature specification
│   ├── TUTOR_GUIDE.md    # End-user guide for tutors & students (zh-CN version alongside; screenshots in guide-images/)
│   ├── ARCHITECTURE.md   # Technical architecture
│   └── SETUP.md          # Setup and deployment guide
│
├── e2e/                   # End-to-end tests (Playwright)
│   ├── tests/
│   │   ├── fixtures/     # Test fixtures (auth, etc.)
│   │   └── *.spec.ts     # Test files
│   └── playwright.config.ts
│
├── .github/workflows/     # GitHub Actions
│   ├── deploy.yml        # Auto-deploy all services on push to main
│   ├── e2e-tests.yml     # E2E tests on PRs and main
│   ├── android-build.yml # Builds the sideloadable Android APK (native/)
│   ├── android-lab-build.yml # Tests (incl. TS parity) + builds the Lab app; pre-releases lab-v* on main
│   └── desktop-build.yml # Desktop app: typecheck + Linux smoke + macOS (.dmg/.zip) / Windows packages; pre-releases desktop-v* on main
│
└── package.json          # Root package.json (workspaces)
```

## Content service, data model, FSRS (full, from CLAUDE.md)

### Content service (decks, notes, cards) — the one write path

`worker/src/services/content/` is the semantic layer every deck / note / card write goes through:

```
route / Ask-Claude tool / coach tool / queue job / MCP (via HTTP)  →  services/content  →  db/queries  →  D1
```

- `decks.ts` — `createDeck` (fills the row from the shared `DEFAULT_DECK_SETTINGS`), `ensureSourceDeck`
  (source decks — "From readers", "From chats", …: get-or-create by `decks.source_key`, race-safe, adopts the
  old "From my readers"; `resolveNoteDeck` turns a `source:<key>` ref on the note-create routes into the deck;
  `flashcardDeckFor` = Claude's create_flashcards target, "From Claude" unless he named a deck), `updateDeck`,
  `updateDeckSettings` (validated with `pickDeckSettings`; 400 + `problems` on bad values), `deleteDeck`
  (tombstones + R2 clean-up), `copyDeckForUser` (tutor → student copies: a NEW deck with the defaults,
  notes copied with their clips and fresh cards).
- `notes.ts` — `createNote` / `createNotes` (validate, insert note + the 3 cards, then the side effects by
  `audio` mode: `background` = waitUntil, `queue` = `note_audio` job, `await`, `none`; sentence set queued),
  `updateNote` (a changed hanzi regenerates the word clip, a changed clue regenerates the sentence clip),
  `deleteNote`, `moveNotes`.
- `audio.ts` — `setNoteAudio` (store + propagate to student copies), `ensureNoteAudio`,
  `ensureSentenceClueAudio`, `enqueueSentenceSet`, `deleteUnreferencedAudio` (a tutor's note and the
  student's copy share R2 keys, so a delete only removes clips nothing else points at).
- **New-deck defaults live in `shared/decks/defaults.ts`** (`DEFAULT_DECK_SETTINGS`: 3 new + 6 secondary
  cards a day). Change them there and every creation path follows — the app, Generate with Claude, JSON
  import, the starter deck, share / invite copies, the MCP tools. Existing decks are untouched. The D1
  column DEFAULTs are legacy.
- `db/queries.ts` is the raw SQL layer (`createDeck` takes the full settings row, `createNote` takes a
  `NoteRowInput` incl. the sentence clue, `insertCardsForNote` is the single card generator,
  `insertNoteCopy`, `moveNotes`). Nothing outside `services/content` should INSERT / UPDATE / DELETE
  decks, notes or cards (exceptions: card *scheduling* writes from reviews, `routes/test-auth.ts` cleanup).
- The MCP server never writes D1 for content: its deck / note tools call the API
  (`POST /api/decks`, `PUT /api/decks/:id[/settings]`, `DELETE /api/decks/:id`, `POST /api/decks/:id/notes`,
  `POST /api/decks/:id/notes/batch`, `PUT|DELETE /api/notes/:id`, `POST /api/notes/move`).

### Data Model
- **Note**: The source of truth. Contains hanzi, pinyin, english, audio URL, fun facts.
- **Example sentences**: ONE model — `note_sentences` rows. The card's own sentence (the card standard's `sentence_clue`)
  is the row `<note id>-card` (`is_card = 1`, position −1, migration 0154; `shared/study/cardSentence.ts`, Lab core
  `CardSentence.kt`, docs/STUDY_SESSION.md "Example sentences — one model"); the generated set follows it.
  `notes.sentence_clue*` are a DEPRECATED mirror (still how the card sentence is written; the worker keeps the row
  identical — `worker/src/db/card-sentence.ts`); readers read rows.
- **Card**: Generated from Notes. Three types per note:
  1. `hanzi_to_meaning`: Show hanzi → user speaks → reveal audio/pinyin/english
  2. `meaning_to_hanzi`: Show english → user types hanzi → reveal audio/pinyin/hanzi
  3. `audio_to_hanzi`: Play audio → user types hanzi → reveal pinyin/hanzi/english
- **Deck**: Collection of Notes (and their generated Cards)
- **ReviewEvent**: Individual card review (rating, time, audio recording). Card state is computed from review history.

### Spaced Repetition (FSRS Algorithm)

The app uses **FSRS (Free Spaced Repetition Scheduler)**, a modern algorithm based on the DSR (Difficulty, Stability, Retrievability) memory model. It's more efficient than SM-2, requiring ~20-30% fewer reviews for the same retention.

#### Card State Fields (FSRS)
- `stability`: Memory stability in days (how long until recall probability drops to 90%)
- `difficulty`: Card difficulty (1-10 scale, lower = easier)
- `lapses`: Times the card was forgotten (Again pressed while in Review state)
- `reps`: Total successful reviews
- `queue`: Current state - NEW (0), LEARNING (1), REVIEW (2), RELEARNING (3)
- `next_review_at`: When to show card next

#### Legacy Fields (backward compatibility)
- `ease_factor`: Approximated from stability for display
- `interval`: Same as scheduled_days
- `repetitions`: Same as reps

#### Ratings
- `again` (0): Forgot the card → short interval, +1 lapse if in Review
- `hard` (1): Difficult recall → shorter interval
- `good` (2): Normal recall → standard interval
- `easy` (3): Easy recall → longer interval, skips learning phase for new cards

#### New Card Intervals (with short-term scheduling)
| Rating | Interval | Next State |
|--------|----------|------------|
| Again  | ~1 min   | Learning   |
| Hard   | ~6 min   | Learning   |
| Good   | ~10 min  | Learning   |
| Easy   | ~2 days  | Review (skips learning) |

#### Key Implementation Files
- `shared/scheduler/compute-state.ts` - Core FSRS algorithm using `ts-fsrs` library
- `shared/scheduler/index.ts` - Re-exports types and functions
- `frontend/src/services/anki-scheduler.ts` - Frontend wrapper
- `worker/src/services/anki-scheduler.ts` - Worker wrapper


## Offline-first & event sourcing (full, from CLAUDE.md)

## Offline-First Architecture

**Study mode MUST work fully offline.** This is a core requirement - users study on the subway, on planes, and in areas with poor connectivity.

### Offline-First Principles

1. **Study is 100% local-first**: All study functionality uses IndexedDB (via Dexie). No network requests are made during card reviews. Transitions between cards are instant.

2. **Event-sourced reviews**: Reviews are stored as immutable events in `reviewEvents` table. Card state is computed from events, never stored. Events sync to server when online.

3. **Data is cached locally**: Decks, notes, and cards are stored in IndexedDB. The app works immediately on load using cached data.

4. **Graceful degradation for other features**: Features that require internet (AI generation, Ask Claude, TTS generation) should fail gracefully with clear user feedback - not crash or hang.

### Event-Sourcing Architecture

**Review events are the SINGLE SOURCE OF TRUTH for card scheduling state.**

#### Core Principles

1. **Events are append-only**: Review events can only be added, never modified or deleted. Each event has a unique ID for deduplication.

2. **Card state is derived, not stored**: The `queue`, `stability`, `difficulty`, `lapses`, etc. on cards are COMPUTED from the review event history using FSRS. The stored values are just a cache for performance.

3. **Both client and server compute state independently**:
   - Client computes card state from local events
   - Server computes card state from server events
   - They should arrive at the same state given the same events

4. **Sync exchanges events, not state**:
   - Upload: Client sends unsynced events to server
   - Download: Server sends events client doesn't have
   - After sync, both sides recompute card state from merged events

5. **Idempotent event sync**: Events are deduplicated by ID. Syncing the same event twice is safe - it's skipped if already exists.

7. **Deletions travel as tombstones**: deleting a deck or note removes it locally at once (`removeDecksLocally` / `removeNotesLocally` in `db/database.ts`) and writes a `deleted_items` row on the server, which `/api/sync/changes` hands to every other device. A full sync additionally replaces decks/notes wholesale and drops cards the server no longer has. Syncs never write back an id this device removed during the session (`wasRemovedLocally`), a full sync's cursor is the moment its snapshot was taken (so deletions made mid-sync still arrive), and a deck page that gets a 404 removes the deck locally. A note the same /sync/changes response moves into a live deck survives its old deck's tombstone (`movedToLiveDecks`; Lab `SyncChanges`) — words merged into another deck and then the old deck deleted used to vanish from the device; every device runs one full sync (`sync-full-refresh-v1` / Lab `FULL_REFRESH_VERSION`) to bring such notes back. Decks deleted before tombstones existed (23 Sep 2026) were never announced, so `/api/sync/changes` also returns `live_deck_ids` (+ `live_deck_ids_at`, taken before the change queries) and the incremental sync drops local decks missing from it that predate the snapshot (`findGhostDecks`, `shared/decks/ghosts.ts`; the Lab app's port is parity-tested). The tutor's student page no longer lists shares whose tutor deck AND student copy are both gone (`dropGhostShares`).

6. **Checkpoints for performance**: `card_checkpoints` table stores computed state at a point in time. This avoids replaying all events from the beginning. Checkpoints are ALWAYS re-derivable from events.

#### What This Means in Practice

- **Never trust card state from sync**: When downloading cards from server, ignore the scheduling fields. Either:
  - Initialize as NEW and download events to compute real state, OR
  - Download events first, then compute state from events

- **Never store card state directly**: When a review happens, create an event and compute new state from events. Don't just update the card directly. The web study session stores the event and writes `computeCardState(all the card's events)` (`recomputeCardFromEvents`); cards a sync inserts are replayed if their events are already local (`recomputeCardsWithEvents`); `repairCardStatesIfDue` re-derives every row after a background sync whose event download succeeded (once per `CARD_STATE_REPAIR_VERSION`, then daily) — a card with no events is NEW, like the Lab's replay (v2 reset legacy rows carrying the server's old Anki state or no queue: 390 due on the web vs 119 in the Lab, 30 Sep). Events the server refuses (their card is not in the account) come back as `orphan_event_ids` from `POST /api/reviews` and are marked `_synced = -1` (rejected), never "synced".

- **The server's cache is the replay too** (`worker/src/services/card-state.ts`): the server's study queue (`services/study-queue.ts` — tutor stats, Claude's tools, MCP `get_due_cards`) reads the `cards` scheduling columns, so every server write of a review / forget / undo goes through ONE function, `recomputeCards` (replay of the card's events + live forgets, times ordered as instants whatever their stored format; the UPDATE is guarded on the card's event + forget counts so a slower concurrent recompute never overwrites a newer one; `POST /api/reviews` recomputes even when every event was already stored). `repairUserCardStates` replays EVERY card of a user (no events = NEW) and rewrites only differing rows: run once per `CARD_STATE_REPAIR_VERSION` before the user's first server queue read (`ensureCardStatesRepaired`, resumable by `users.card_state_cursor`, migration 0153) and re-checked daily from `/api/sync/changes` in the background (`checkCardStatesIfDue`; a difference is logged as drift). Admin: `GET /api/admin/users/:user/card-state` (dry run), `POST …/card-state/repair`, MCP `admin_card_state`; `compare_debug_reports` carries the server's own queue as `server_queue`. Nov 2026: cards of the Anki-import deck with no review event still held the import's "review, due Feb 2026" — the server said 199 reviews due while both apps said 0. The routes live in `routes/review-events.ts`.

- **State mismatches indicate bugs**: If computed state differs from stored state, the computed state is correct. Use `fixAllCardStates()` to repair.

- **An unusable stored state never breaks study**: `computedStateToFsrsCard` (Lab `CardScheduler.toFsrsCard`) schedules a reviewed card with stability 0 / negative / NaN / ±∞ / missing as stability 0.001 ("forgotten"), clamps difficulty to 1–10 (not finite → 5), reads an unknown queue as NEW and a garbage date as missing — valid states are untouched. Before, such a row showed "NaNy" on the web's rating buttons and threw on a rating, and froze the Lab's study screen. Parity-tested (`parity/fixtures/fsrs-degenerate.ts`); the Lab session also computes a card's previews through `app.safely` (bare buttons + a crash report rather than no card).

#### Future: State Override Events

For manual state adjustments (e.g., admin resetting a card), we may add a `set_card_state` event type that explicitly sets state. This maintains the event-sourced model while allowing overrides.

### What Works Offline
- Viewing decks and notes (from local cache)
- **All study functionality** - card display, rating, queue management, daily limits
- Audio playback (if previously cached)
- Viewing statistics (from local data)

### What Requires Internet (Fail Gracefully)
- AI deck generation
- Ask Claude questions
- TTS audio generation
- Initial data sync (first load)
- Session creation (best-effort, non-blocking)

### Key Implementation Files
- `frontend/src/db/database.ts` - IndexedDB schema and queries (Dexie)
- `frontend/src/hooks/useOfflineData.ts` - Offline-first React hooks
- `frontend/src/services/sync.ts` - Background sync service
- `frontend/src/services/review-events.ts` - Review event creation and state computation
- `frontend/src/contexts/NetworkContext.tsx` - Online/offline detection
- `shared/scheduler/compute-state.ts` - Pure function to compute card state from events
- `frontend/src/utils/audioPlayback.ts` - The one audio player: native bridge in the Android app (`window.AndroidAudio`, see `native/README.md`), one `<audio>` element elsewhere; `createMediaTrack` for clips that pause / seek / show progress / loop / mix (reader scrubber, chat voice + listening, clips, a take's preview — element-only, no bridge can seek); never `new Audio()` elsewhere. The device-voice fallback is `speakFallback` (`services/audioCache.ts`). docs/AUDIO.md "Playing audio on the web"
- `frontend/src/services/nativeAudioPrefs.ts` - Android-app playback tuning (compressor, keep-awake), toggled in Settings
- `frontend/src/utils/audioDiagnostics.ts` - Per-clip playback measurement behind Settings → "Copy Audio Report"

### When Adding Features
- **Study-related features**: Must work offline. Use `useOfflineData` hooks, store data in IndexedDB.
- **Other features**: Should fail gracefully. Show clear error messages, don't block the UI, don't prevent navigation.

