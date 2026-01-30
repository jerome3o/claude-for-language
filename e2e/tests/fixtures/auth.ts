import { test as base, expect, Page, APIRequestContext } from '@playwright/test';

/**
 * Extended Page type with test helpers
 */
export interface AuthenticatedPage extends Page {
  /**
   * Navigate to a path while preserving authentication.
   * Use this instead of page.goto() for authenticated navigation.
   */
  gotoAuthenticated: (path: string) => Promise<void>;
}

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
  authenticatedPage: AuthenticatedPage;
}

export const test = base.extend<AuthFixtures>({
  // Create a test user and provide their session token
  testUser: async ({ request }, use) => {
    const timestamp = Date.now();
    const email = `e2e-${timestamp}@test.e2e`;
    const name = `E2E Test User ${timestamp}`;

    // First check that the worker is running and test mode is enabled
    const healthResponse = await request.get('http://localhost:8787/api/health');
    if (!healthResponse.ok()) {
      throw new Error(`Worker not running: ${healthResponse.status()}`);
    }

    // Call the test auth API to create user and get session
    const response = await request.post('http://localhost:8787/api/test/auth', {
      data: { email, name },
    });

    if (!response.ok()) {
      const text = await response.text();
      throw new Error(
        `Failed to create test user: ${response.status()} ${text}\n` +
          'Make sure E2E_TEST_MODE=true is set in worker/.dev.vars'
      );
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
    // Navigate with session token in URL (mimicking OAuth callback redirect)
    // This is how the real auth flow works - token is passed via URL query param
    await page.goto(`/?session_token=${testUser.sessionToken}`);

    // Wait for auth to complete - look for the authenticated home page heading
    // This ensures we're actually logged in, not just past the loading state
    await page.waitForSelector('h1:has-text("Welcome to 汉语学习")', {
      timeout: 30000,
    });

    // Add helper method for authenticated navigation
    // This is needed because localStorage doesn't persist across page.goto in Playwright
    const authenticatedPage = page as AuthenticatedPage;
    authenticatedPage.gotoAuthenticated = async (path: string) => {
      // Include session token in URL to maintain authentication
      const separator = path.includes('?') ? '&' : '?';
      await page.goto(`${path}${separator}session_token=${testUser.sessionToken}`);
    };

    await use(authenticatedPage);
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
