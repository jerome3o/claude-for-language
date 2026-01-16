# Setup Guide

This guide covers how to set up the Chinese Learning App for local development and production deployment.

## Prerequisites

- Node.js 20+
- npm 9+
- A Cloudflare account (free tier works)
- Wrangler CLI (installed as dev dependency)
- An Anthropic API key (for AI card generation)

## Local Development

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Local D1 Database

Create the D1 database locally and apply migrations:

```bash
cd worker
npx wrangler d1 create chinese-learning-db --local
npx wrangler d1 migrations apply chinese-learning-db --local
```

### 3. Create Local Environment File

Create `worker/.dev.vars` with your Anthropic API key:

```
ANTHROPIC_API_KEY=your-anthropic-api-key
```

### 4. Start Development Servers

From the project root:

```bash
# Start both worker and frontend
npm run dev

# Or start them separately:
npm run dev:worker   # Starts worker on port 8787
npm run dev:frontend # Starts frontend on port 3000
```

The frontend proxies API requests to the worker, so you can access the app at http://localhost:3000.

## Production Deployment

### 1. Create Cloudflare Resources

First, create the D1 database and R2 bucket:

```bash
# Create D1 database
npx wrangler d1 create chinese-learning-db

# Note the database_id from the output and update worker/wrangler.toml

# Create R2 bucket
npx wrangler r2 bucket create chinese-learning-audio
```

### 2. Update wrangler.toml

Edit `worker/wrangler.toml` and replace the placeholder `database_id`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "chinese-learning-db"
database_id = "your-actual-database-id-here"
```

### 3. Apply Migrations to Production

```bash
cd worker
npx wrangler d1 migrations apply chinese-learning-db
```

### 4. Set Secrets

```bash
npx wrangler secret put ANTHROPIC_API_KEY
# Enter your Anthropic API key when prompted
```

### 5. Deploy

Manual deployment:

```bash
npm run deploy
```

Or push to the `main` branch to trigger the GitHub Actions workflow.

## GitHub Actions Setup

The repository is configured to automatically deploy on pushes to `main`. You need to set up these secrets in your GitHub repository:

1. Go to Settings > Secrets and variables > Actions
2. Add these secrets:
   - `CLOUDFLARE_TOKEN`: Your Cloudflare API token (with Workers and D1 permissions)
   - `CLOUDFLARE_ACCOUNT`: Your Cloudflare account ID

The `ANTHROPIC_API_KEY` should be set directly in Cloudflare using `wrangler secret`, not through GitHub Actions.

## Troubleshooting

### "D1 database not found"

Make sure you've:
1. Created the database with `wrangler d1 create`
2. Updated the `database_id` in `wrangler.toml`
3. Applied migrations with `wrangler d1 migrations apply`

### "R2 bucket not found"

Create the bucket:
```bash
npx wrangler r2 bucket create chinese-learning-audio
```

### "AI generation not working"

Verify your Anthropic API key is set:
```bash
# For local development
echo "ANTHROPIC_API_KEY=your-key" > worker/.dev.vars

# For production
npx wrangler secret put ANTHROPIC_API_KEY
```

### Frontend not connecting to API

In development, ensure both servers are running. The frontend (port 3000) proxies to the worker (port 8787).

In production, the frontend is built and served from the worker as static assets.

## Architecture Overview

```
                    ┌─────────────────┐
                    │   Cloudflare    │
                    │     Worker      │
                    │  (API + Static) │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │   D1     │  │   R2     │  │ Anthropic │
        │ Database │  │  Bucket  │  │   API     │
        └──────────┘  └──────────┘  └──────────┘
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed technical documentation.
