# CLAUDE.md - AI Agent Guide

This is a Chinese language learning app with spaced repetition. This document is for AI agents working on this codebase.

## Quick Start

```bash
# Install dependencies
npm install

# First-time setup: Create local D1 database
cd worker && npx wrangler d1 migrations apply chinese-learning-db --local && cd ..

# Create worker/.dev.vars with your Anthropic API key
echo "ANTHROPIC_API_KEY=your-key-here" > worker/.dev.vars

# Run locally (both worker and frontend)
npm run dev

# Run just the worker
npm run dev:worker

# Run just the frontend
npm run dev:frontend

# Deploy to Cloudflare
npm run deploy
```

For detailed setup instructions, see [docs/SETUP.md](./docs/SETUP.md).

## Project Structure

```
/
├── worker/                 # Cloudflare Worker (API backend)
│   ├── src/
│   │   ├── index.ts       # Main entry point, routes
│   │   ├── services/      # Business logic (FSRS scheduler, AI, TTS)
│   │   ├── db/            # Database queries and migrations
│   │   └── types.ts       # TypeScript types
│   ├── wrangler.toml      # Cloudflare Worker config
│   └── package.json
│
├── shared/                # Shared code between worker and frontend
│   └── scheduler/         # FSRS spaced repetition algorithm
│       ├── compute-state.ts    # Core FSRS logic, state computation from events
│       ├── compute-state.test.ts # Tests for scheduler
│       └── index.ts       # Re-exports
│
├── frontend/              # React + Vite frontend
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── pages/         # Page components (StudyPage, DeckDetailPage, etc.)
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
├── docs/                  # Documentation
│   ├── SPEC.md           # Feature specification
│   ├── ARCHITECTURE.md   # Technical architecture
│   └── SETUP.md          # Setup and deployment guide
│
├── .github/workflows/     # GitHub Actions
│   └── deploy.yml        # Auto-deploy all services on push to main
│
└── package.json          # Root package.json (workspaces)
```

## Key Concepts

### Data Model
- **Note**: The source of truth. Contains hanzi, pinyin, english, audio URL, fun facts.
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

### Database Tables
- `users` - User accounts
- `decks` - Vocabulary decks
- `notes` - Vocabulary items (hanzi, pinyin, english, audio_url, fun_facts)
- `cards` - SRS cards (3 per note, one per card_type)
- `review_events` - Individual review records (rating, time, answer, recording_url). Card state is computed from these.
- `card_checkpoints` - Cached card state for performance (computed from review_events)
- `note_questions` - Q&A from Ask Claude feature (question, answer, asked_at)
- `tutor_relationships` - Tutor-student pairings (requester, recipient, role, status)
- `conversations` - Chat threads within a tutor-student relationship
- `messages` - Individual chat messages
- `shared_decks` - Record of decks shared from tutor to student

### Audio Storage
- Generated TTS audio and user recordings stored in Cloudflare R2
- Audio URLs follow pattern: `/{bucket}/{type}/{id}.mp3`
- Types: `generated` (TTS), `recordings` (user voice)
- TTS is generated via Google Cloud Text-to-Speech API (Mandarin Wavenet voice)

### AI Features
Uses Anthropic Claude API for several features:

1. **Deck generation**: "Generate cards about zoo vocabulary" → creates full deck with 8-12 cards
2. **Card suggestions**: While editing, suggest related vocabulary
3. **Ask Claude**: During study, ask questions about a card (grammar, usage, cultural context)
   - Questions and answers are stored in `note_questions` table
   - Visible in note history modal

### Pinyin Format
- Always use **tone marks** (nǐ hǎo), NOT tone numbers (ni3 hao3)
- Use proper Unicode: ā á ǎ à, ē é ě è, ī í ǐ ì, ō ó ǒ ò, ū ú ǔ ù, ǖ ǘ ǚ ǜ

## Offline-First Architecture (CRITICAL)

**Study mode MUST work fully offline.** This is a core requirement - users study on the subway, on planes, and in areas with poor connectivity.

### Offline-First Principles

1. **Study is 100% local-first**: All study functionality uses IndexedDB (via Dexie). No network requests are made during card reviews. Transitions between cards are instant.

2. **Event-sourced reviews**: Reviews are stored as immutable events in `reviewEvents` table. Card state is computed from events, never stored. Events sync to server when online.

3. **Data is cached locally**: Decks, notes, and cards are stored in IndexedDB. The app works immediately on load using cached data.

4. **Graceful degradation for other features**: Features that require internet (AI generation, Ask Claude, TTS generation) should fail gracefully with clear user feedback - not crash or hang.

### Event-Sourcing Architecture (CRITICAL)

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

6. **Checkpoints for performance**: `card_checkpoints` table stores computed state at a point in time. This avoids replaying all events from the beginning. Checkpoints are ALWAYS re-derivable from events.

#### What This Means in Practice

- **Never trust card state from sync**: When downloading cards from server, ignore the scheduling fields. Either:
  - Initialize as NEW and download events to compute real state, OR
  - Download events first, then compute state from events

- **Never store card state directly**: When a review happens, create an event and compute new state from events. Don't just update the card directly.

- **State mismatches indicate bugs**: If computed state differs from stored state, the computed state is correct. Use `fixAllCardStates()` to repair.

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

### When Adding Features
- **Study-related features**: Must work offline. Use `useOfflineData` hooks, store data in IndexedDB.
- **Other features**: Should fail gracefully. Show clear error messages, don't block the UI, don't prevent navigation.

## Feature Overview

### Study Flow (Offline-First)
**Study works 100% offline** - no loading spinners between cards, instant transitions.

1. User selects a deck (or "All Decks") and starts a study session
2. Cards are shown based on spaced repetition schedule (due cards first)
3. Daily new card limits are enforced locally (configurable per deck)
4. Three card types test different skills:
   - **Hanzi → Meaning**: See characters, speak aloud, reveal answer
   - **Meaning → Hanzi**: See English, type characters, check answer
   - **Audio → Hanzi**: Hear audio, type characters, check answer
5. On answer reveal:
   - Play TTS audio (if cached)
   - **Ask Claude** about the word (requires internet, fails gracefully)
   - Rate difficulty (Again/Hard/Good/Easy)
6. Reviews are saved locally and synced to server in background
7. "Study More" button appears when daily limit reached (bypasses limit)
8. Session ends when all due cards reviewed

### Deck Management
- Create/edit/delete decks
- Add notes manually or via AI generation
- Each note has: hanzi, pinyin (with tone marks), English, optional fun facts
- Each note auto-generates 3 cards (one per card type)
- **Play audio** button on each note in deck view
- **Generate audio** button if TTS is missing (🔊+)

### Note History
Each note has a **History** button showing:
- **Review history** by card type with:
  - Date/time of each review
  - Rating given (color-coded)
  - Time spent
  - User's typed answer
  - Audio recording (if recorded)
- **Current card stats**: stability, difficulty, lapses, interval
- **Questions asked** to Claude with answers

### AI Integration
- **Generate Deck**: Describe a topic, get 8-12 vocabulary cards
- **Ask Claude**: During study, ask about grammar, usage, examples, mnemonics
- Q&A is saved and viewable in note history

### MCP Server
AI assistants can manage vocabulary via MCP (see MCP Server section below).

## Development Guidelines

### Mobile-First Design (IMPORTANT)

**This app is primarily used on mobile devices.** All UI work must prioritize mobile experience.

#### CSS Guidelines
- Write mobile styles first, then use `@media (min-width: 640px)` for larger screens
- Minimum touch target size: 44px height for buttons and interactive elements
- Use relative units (rem) for font sizes, not px
- Test all changes on mobile viewport (375px width) before desktop

#### Key Breakpoints
- Mobile: < 640px (default styles)
- Tablet/Desktop: >= 640px (`@media (min-width: 640px)`)
- Large Desktop: >= 1024px (rarely needed)

#### Mobile UX Checklist
- [ ] Buttons are easily tappable (min 44px height)
- [ ] Text is readable without zooming (min 16px for body text)
- [ ] Forms don't cause zoom on iOS (inputs must be 16px+)
- [ ] Content doesn't overflow horizontally
- [ ] Modals are usable on small screens
- [ ] Navigation is accessible with one hand

#### Common Patterns
```css
/* Mobile-first example */
.element {
  padding: 1rem;        /* Mobile */
  font-size: 0.875rem;  /* Mobile */
}

@media (min-width: 640px) {
  .element {
    padding: 1.5rem;    /* Desktop */
    font-size: 1rem;    /* Desktop */
  }
}
```

### When Adding Features
1. Update types in `worker/src/types.ts` and `frontend/src/types.ts`
2. Add database migrations to `worker/src/db/migrations/`
3. Add API routes to `worker/src/routes/`
4. Add frontend components/pages as needed
5. **Test on mobile viewport before committing**
6. Update this CLAUDE.md if the change affects project structure
7. Update docs/SPEC.md if adding new features

### Database Migrations
Migrations are in `worker/src/db/migrations/`. Run order is determined by filename prefix (001_, 002_, etc.).

**Local development**: Apply migrations with:
```bash
cd worker && npx wrangler d1 migrations apply chinese-learning-db --local
```

**Production**: Migrations are applied automatically by CI on push to main (see Deployment section).

### Running Tests
```bash
# Run all tests (includes FSRS scheduler tests)
npm test

# Run tests in watch mode
npm run test:watch

# Run type checking
npm run typecheck
```

Key test files:
- `shared/scheduler/compute-state.test.ts` - FSRS algorithm tests
- `frontend/src/services/sync.test.ts` - Sync service tests
- `frontend/src/db/daily-stats.test.ts` - Daily stats tests

### Running Dev Servers
```bash
# The worker uses wrangler for local D1/R2
npm run dev:worker

# Frontend proxies API calls to worker
npm run dev:frontend

# Run both together
npm run dev
```

### Environment Variables / Secrets
- `ANTHROPIC_API_KEY`: For AI card generation and Ask Claude feature
- `GOOGLE_TTS_API_KEY`: For Google Cloud Text-to-Speech audio generation
- D1 and R2 bindings are configured in `wrangler.toml`

Set secrets via:
```bash
cd worker && npx wrangler secret put ANTHROPIC_API_KEY
cd worker && npx wrangler secret put GOOGLE_TTS_API_KEY
```

## API Endpoints Reference

### Decks
- `GET /api/decks` - List all decks
- `POST /api/decks` - Create deck
- `GET /api/decks/:id` - Get deck with notes
- `PUT /api/decks/:id` - Update deck
- `DELETE /api/decks/:id` - Delete deck

### Notes
- `GET /api/notes/:id` - Get note with cards
- `POST /api/decks/:deckId/notes` - Create note (auto-generates TTS)
- `PUT /api/notes/:id` - Update note
- `DELETE /api/notes/:id` - Delete note
- `GET /api/notes/:id/history` - Get review history and card stats
- `POST /api/notes/:id/ask` - Ask Claude about a note
- `GET /api/notes/:id/questions` - Get Q&A history
- `POST /api/notes/:id/generate-audio` - Generate TTS audio for note

### Cards & Study
- `GET /api/cards/due` - Get due cards (optional `?deck_id=`)
- `POST /api/study/sessions` - Start study session
- `POST /api/study/sessions/:id/reviews` - Record a review
- `PUT /api/study/sessions/:id/complete` - Complete session

### Audio
- `POST /api/audio/upload` - Upload user recording
- `GET /api/audio/*` - Get audio file from R2

### AI
- `POST /api/ai/generate-deck` - Generate deck from prompt
- `POST /api/ai/suggest-cards` - Get card suggestions

### Stats
- `GET /api/stats/overview` - Overall statistics
- `GET /api/stats/deck/:id` - Deck statistics

## Common Tasks

### Add a new API endpoint
1. Create handler in `worker/src/routes/`
2. Register route in `worker/src/index.ts`
3. Add API client function in `frontend/src/api/`

### Modify database schema
1. Create new migration file in `worker/src/db/migrations/`
2. Update types in both worker and frontend
3. Test locally with `wrangler d1 migrations apply`

### Add a new card type
1. Update `CardType` enum in types
2. Update card generation logic in `worker/src/services/cards.ts`
3. Update study flow in frontend

## MCP Server

The app includes an MCP (Model Context Protocol) server that allows AI assistants like Claude to interact with your vocabulary data.

### MCP Server URL (Streamable HTTP)
`https://chinese-learning-mcp.jeromeswannack.workers.dev/mcp`

### Architecture Overview

The MCP server uses several key technologies:
- **`@cloudflare/workers-oauth-provider`**: Wraps the worker with OAuth 2.1 support
- **`agents/mcp` (McpAgent)**: Class-based MCP server pattern from the `agents` package
- **Hono**: HTTP routing framework for the OAuth flow endpoints
- **Google OAuth**: User authentication via Google Sign-In

### Critical Implementation Details

#### 1. SQLite-Backed Durable Objects (IMPORTANT!)

The `McpAgent` class **requires SQLite-backed Durable Objects**. This is a common pitfall:

```toml
# wrangler.toml - CORRECT configuration
[durable_objects]
bindings = [
  { name = "MCP_OBJECT", class_name = "ChineseLearningMCPv2" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ChineseLearningMCPv2"]  # Must use new_sqlite_classes, NOT new_classes!
```

If you see this error, the Durable Object is not SQLite-backed:
```
Error: SqlError: SQL query failed: This Durable Object is not backed by SQLite storage
```

**Note**: An existing non-SQLite class cannot be converted. You must create a new class with a different name using `new_sqlite_classes`.

#### 2. OAuth Flow Implementation

The `OAuthProvider` does NOT auto-handle the authorization UI. Your `defaultHandler` must implement:
- `GET /authorize` - Parse OAuth request, store state in KV, redirect to Google
- `GET /callback` - Exchange Google code for tokens, get user info, call `completeAuthorization()`

```typescript
// Key pattern in callback handler:
const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
  request: oauthReqInfo,  // Original OAuth request from KV
  userId: user.id,
  metadata: { label: user.name || user.email },
  scope: oauthReqInfo.scope,
  props: { userId, userEmail, userName },  // Passed to McpAgent
});
return c.redirect(redirectTo);
```

#### 3. Required Secrets

Set these via `wrangler secret put`:
- `GOOGLE_CLIENT_ID` - From Google Cloud Console
- `GOOGLE_CLIENT_SECRET` - From Google Cloud Console
- `COOKIE_ENCRYPTION_KEY` - Generate with `openssl rand -hex 32`

#### 4. Google OAuth Setup

In Google Cloud Console, add this callback URL:
```
https://chinese-learning-mcp.jeromeswannack.workers.dev/callback
```

### Available Tools

| Tool | Description |
|------|-------------|
| `list_decks` | List all decks with stats (note count, cards due, mastered) |
| `get_deck` | Get a deck with all its notes |
| `get_deck_progress` | Get detailed study progress for a deck |
| `create_deck` | Create a new deck |
| `update_deck` | Update deck name/description |
| `delete_deck` | Delete a deck and all its notes |
| `add_note` | Add a vocabulary note (auto-generates TTS audio) |
| `batch_add_notes` | Add multiple notes at once (more efficient for bulk operations) |
| `update_note` | Update an existing note |
| `delete_note` | Delete a note |
| `get_note_cards` | Get all cards for a note with their SRS state |
| `set_card_familiarity` | Set familiarity level (new/seen/familiar/well_known/mastered) |
| `update_card_settings` | Fine-grained control over card scheduling |
| `batch_set_familiarity` | Set familiarity for multiple notes at once |
| `get_note_history` | Get review history and Q&A for a note |
| `get_due_cards` | Get cards due for review |
| `get_overall_stats` | Get overall study statistics |
| `study` | **MCP App** - Opens an interactive flashcard study session in the UI |

### Study Tool (MCP App)

The `study` tool is special - it renders an interactive flashcard UI directly in Claude.ai or other MCP hosts that support MCP Apps. Usage:

1. Call `list_decks` to get available deck IDs
2. Call `study(deck_id: "...")` to open the study interface
3. The UI displays cards, handles flipping, and rating
4. Audio is played via browser speech synthesis (Chinese TTS)
5. Reviews are submitted automatically via the `submit_review` tool (hidden from model)

The UI bundle is built with Vite and embedded in the worker. To rebuild:
```bash
cd mcp-server && npm run build:ui
```

### Notes on MCP Usage
- When `add_note` is called, the MCP server automatically calls the main API to generate TTS audio
- Notes created via MCP will have audio available for playback
- Use `get_note_history` to see a user's study progress and questions asked about a note

### Connecting to Claude.ai

Add the MCP server URL in Claude.ai settings:
```
https://chinese-learning-mcp.jeromeswannack.workers.dev/mcp
```

Claude.ai will handle the OAuth flow automatically.

### Connecting to Claude Desktop

Use `mcp-remote` to connect Claude Desktop to the MCP server:
```bash
npx mcp-remote https://chinese-learning-mcp.jeromeswannack.workers.dev/mcp
```

### Development

```bash
# Run MCP server locally
npm run dev:mcp

# Deploy MCP server
npm run deploy:mcp
```

### Debugging

To view live logs while testing:
```bash
cd mcp-server && npx wrangler tail --format pretty
```

Common issues:
- **"Could not find McpAgent binding for MCP_OBJECT"** - Missing Durable Object config in wrangler.toml
- **"This Durable Object is not backed by SQLite storage"** - Used `new_classes` instead of `new_sqlite_classes`
- **OAuth errors after deploy** - GitHub Actions may overwrite secrets; ensure `MCP_COOKIE_ENCRYPTION_KEY` is set in GitHub secrets

## Deployment

### How Deployment Works

**Deployment is automatic via GitHub Actions.** When you push to `main`, the CI pipeline (`.github/workflows/deploy.yml`) automatically:

1. Runs TypeScript type checking
2. Builds the frontend
3. **Applies D1 database migrations to production** (automatically)
4. Deploys the Worker API
5. Sets worker secrets
6. Deploys the frontend to Cloudflare Pages
7. Deploys the MCP server

### To Deploy

Simply push to main:
```bash
git push origin main
```

**You do NOT need to manually run migrations for production** - the CI handles this automatically before deploying the worker.

### Manual Deployment (if needed)

If you need to deploy manually without CI:
```bash
# Apply migrations to production
cd worker && npx wrangler d1 migrations apply chinese-learning-db --remote

# Deploy everything
npm run deploy
```

### Monitoring Deployments

Check GitHub Actions for deployment status. If a deployment fails:
1. Check the Actions tab on GitHub for error logs
2. Common issues: TypeScript errors, migration failures, missing secrets

## Tutor-Student Feature

The app supports many-to-many tutor-student relationships where users can be tutors to some people and students to others.

### Key Tables
- `tutor_relationships` - Pairing between users with role and status
- `conversations` - Chat threads within a relationship
- `messages` - Individual messages in conversations
- `shared_decks` - Record of decks shared from tutor to student

### Features
- **Pairing**: Either party invites by email, specifying their role (tutor/student)
- **Chat**: Polling-based messaging (3-second intervals)
- **Flashcard Generation**: AI generates flashcards from chat context
- **Deck Sharing**: Tutors can copy decks to students (auto-added)
- **Student Progress**: Tutors can view student study statistics

### Frontend Routes
- `/connections` - List all connections and pending requests
- `/connections/:relId` - View a specific connection (conversations, shared decks)
- `/connections/:relId/chat/:convId` - Chat interface
- `/connections/:relId/progress` - Student progress view (tutor only)
