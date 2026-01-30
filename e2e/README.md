# E2E Tests

End-to-end tests using Playwright for the Chinese Learning App.

## Overview

These tests run a headless Chromium browser against the local development servers to test complete user flows, including:

- New user onboarding
- AI deck generation
- Study sessions (future)

## Prerequisites

The tests require:
1. Local D1 database set up (`cd worker && npx wrangler d1 migrations apply chinese-learning-db --local`)
2. Worker dev vars configured with `ANTHROPIC_API_KEY` for AI generation tests
3. Playwright browsers installed (`npx playwright install chromium`)

## Running Tests

### Local Development

```bash
# From the project root
npm run test:e2e

# With UI (interactive mode)
npm run test:e2e:ui

# From the e2e directory
npm test
npm run test:headed  # See the browser
npm run test:debug   # Debug mode
```

### CI

Tests run automatically on push to `main` and on pull requests. The CI workflow:
1. Sets up the local D1 database
2. Configures the worker with `E2E_TEST_MODE=true`
3. Starts both frontend and worker servers
4. Runs Playwright tests

## Test Auth

In E2E test mode, the worker exposes special endpoints to bypass OAuth:

- `POST /api/test/auth` - Creates a test user and returns a session token
- `POST /api/test/cleanup` - Removes all test users and their data

These endpoints only work when `E2E_TEST_MODE=true` is set in the worker environment.

**Important:** These endpoints are NEVER enabled in production.

## Writing Tests

Tests use a custom auth fixture that:
1. Creates a test user via the test auth API
2. Sets the session token in localStorage
3. Provides an authenticated page ready for testing

Example:
```typescript
import { test, expect } from './fixtures/auth';

test('user can see home page', async ({ authenticatedPage }) => {
  const page = authenticatedPage;
  await expect(page.getByRole('heading', { name: /Welcome/i })).toBeVisible();
});
```

## Test Data Cleanup

Test users are created with emails ending in `@test.e2e` and are cleaned up after tests using the cleanup fixture. All associated data (decks, notes, cards, sessions) is also removed.
