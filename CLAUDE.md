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
│   │   ├── services/      # Business logic (SM-2, AI, TTS)
│   │   ├── db/            # Database queries and migrations
│   │   └── types.ts       # TypeScript types
│   ├── wrangler.toml      # Cloudflare Worker config
│   └── package.json
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
- **StudySession**: A study session with multiple card reviews
- **CardReview**: Individual card review within a session (rating, time, audio recording)

### Spaced Repetition (SM-2 Algorithm)
Each card tracks:
- `ease_factor`: Difficulty multiplier (starts at 2.5)
- `interval`: Days until next review
- `repetitions`: Successful review count
- `next_review_at`: When to show card next

Ratings: `again` (0), `hard` (1), `good` (2), `easy` (3)

### Database Tables
- `users` - User accounts (for future multi-user/tutor support)
- `decks` - Vocabulary decks
- `notes` - Vocabulary items (hanzi, pinyin, english, audio_url, fun_facts)
- `cards` - SRS cards (3 per note, one per card_type)
- `study_sessions` - Study session records
- `card_reviews` - Individual review records (rating, time, answer, recording_url)
- `note_questions` - Q&A from Ask Claude feature (question, answer, asked_at)

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

## Feature Overview

### Study Flow
1. User selects a deck (or "All Decks") and starts a study session
2. Cards are shown based on spaced repetition schedule (due cards first)
3. Three card types test different skills:
   - **Hanzi → Meaning**: See characters, speak aloud, reveal answer
   - **Meaning → Hanzi**: See English, type characters, check answer
   - **Audio → Hanzi**: Hear audio, type characters, check answer
4. On answer reveal:
   - Play TTS audio
   - **Ask Claude** about the word (grammar, usage, examples)
   - Rate difficulty (Again/Hard/Good/Easy)
5. Session ends when all cards reviewed

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
- **Current card stats**: interval, ease factor, repetitions
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

### Testing Locally
```bash
# The worker uses wrangler for local D1/R2
npm run dev:worker

# Frontend proxies API calls to worker
npm run dev:frontend
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
| `update_note` | Update an existing note |
| `delete_note` | Delete a note |
| `get_note_history` | Get review history and Q&A for a note |
| `get_due_cards` | Get cards due for review |
| `get_overall_stats` | Get overall study statistics |

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

## Future Considerations (Tutor Feature)
The codebase is designed to support a future tutor view:
- User model has a `role` field (student/tutor)
- Decks can be assigned to specific students
- CardReviews store audio recordings for tutor review
- Auth can be added via Cloudflare Zero Trust

When implementing tutor features:
1. Add tutor-specific routes with role checking
2. Create tutor dashboard pages in frontend
3. Add student assignment to decks
