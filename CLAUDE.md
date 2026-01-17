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
│   │   ├── routes/        # API route handlers
│   │   ├── services/      # Business logic (SM-2 algorithm, AI generation)
│   │   ├── db/            # Database queries and migrations
│   │   └── types.ts       # TypeScript types
│   ├── wrangler.toml      # Cloudflare Worker config
│   └── package.json
│
├── frontend/              # React + Vite frontend
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── pages/         # Page components
│   │   ├── hooks/         # Custom React hooks
│   │   ├── api/           # API client
│   │   └── types.ts       # TypeScript types (shared with worker)
│   ├── vite.config.ts
│   └── package.json
│
├── docs/                  # Documentation
│   ├── SPEC.md           # Feature specification
│   ├── ARCHITECTURE.md   # Technical architecture
│   └── SETUP.md          # Setup and deployment guide
│
├── .github/workflows/     # GitHub Actions
│   └── deploy.yml        # Auto-deploy on push to main
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

### Audio Storage
- Generated audio (gTTS) and user recordings stored in Cloudflare R2
- Audio URLs follow pattern: `/{bucket}/{type}/{id}.mp3`
- Types: `generated` (gTTS), `recordings` (user)

### AI Card Generation
Uses Anthropic Claude API to generate cards. Two modes:
1. **Deck generation**: "Generate cards about zoo vocabulary" → creates full deck
2. **Card suggestions**: While editing, suggest related cards

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
- `ANTHROPIC_API_KEY`: For AI card generation (set in Cloudflare dashboard or wrangler.toml)
- D1 and R2 bindings are configured in `wrangler.toml`

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

### MCP Server URL
`https://chinese-learning-mcp.jeromeswannack.workers.dev/sse`

### Available Tools

| Tool | Description |
|------|-------------|
| `list_decks` | List all decks with stats (note count, cards due, mastered) |
| `get_deck` | Get a deck with all its notes |
| `get_deck_progress` | Get detailed study progress for a deck |
| `create_deck` | Create a new deck |
| `update_deck` | Update deck name/description |
| `delete_deck` | Delete a deck and all its notes |
| `add_note` | Add a vocabulary note to a deck |
| `update_note` | Update an existing note |
| `delete_note` | Delete a note |
| `get_due_cards` | Get cards due for review |
| `get_overall_stats` | Get overall study statistics |

### Connecting to Claude Desktop

Use `mcp-remote` to connect Claude Desktop to the MCP server:
```bash
npx mcp-remote https://chinese-learning-mcp.jeromeswannack.workers.dev/sse
```

### Development

```bash
# Run MCP server locally
npm run dev:mcp

# Deploy MCP server
npm run deploy:mcp
```

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
