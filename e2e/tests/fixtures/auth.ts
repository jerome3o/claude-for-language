import { test as base, expect, Page, APIRequestContext } from '@playwright/test';

/**
 * Auth fixture for E2E tests.
 *
 * Provides a logged-in test user by calling the test auth API.
 * Only works when E2E_TEST_MODE=true in the worker environment.
 */

export interface TestUser {
  id: string;
  email: string;
  name: string;
  sessionToken: string;
}

interface AuthFixtures {
  testUser: TestUser;
  authenticatedPage: Page;
}

export const test = base.extend<AuthFixtures>({
  // Create a test user and provide their session token
  testUser: async ({ request }, use) => {
    const timestamp = Date.now();
    const email = `e2e-${timestamp}@test.e2e`;
    const name = `E2E Test User ${timestamp}`;

    // Call the test auth API to create user and get session
    const response = await request.post('http://localhost:8787/api/test/auth', {
      data: { email, name },
    });

    if (!response.ok()) {
      const text = await response.text();
      throw new Error(`Failed to create test user: ${response.status()} ${text}`);
    }

    const data = await response.json();

    const testUser: TestUser = {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name,
      sessionToken: data.session_token,
    };

    await use(testUser);
  },

  // Provide a page that's already logged in
  authenticatedPage: async ({ page, testUser }, use) => {
    // Navigate to the app first (to ensure localStorage works)
    await page.goto('/');

    // Set the session token in localStorage (mimicking the OAuth flow)
    await page.evaluate((token: string) => {
      localStorage.setItem('session_token', token);
    }, testUser.sessionToken);

    // Reload to pick up the session
    await page.reload();

    // Wait for auth to complete
    await page.waitForFunction(() => {
      return !document.body.textContent?.includes('Loading...');
    });

    await use(page);
  },
});

export { expect };

/**
 * Helper to clean up test data after tests.
 * Call this in afterAll to remove test users and their data.
 */
export async function cleanupTestData(request: APIRequestContext) {
  const response = await request.post('http://localhost:8787/api/test/cleanup');
  if (!response.ok()) {
    console.warn('Failed to cleanup test data:', await response.text());
  }
}
