import { test, expect, cleanupTestData } from './fixtures/auth';

/**
 * E2E tests for the new user onboarding flow.
 *
 * Tests the journey from first login to generating the first deck of flashcards.
 */

test.describe('New User Onboarding', () => {
  test.afterAll(async ({ request }) => {
    await cleanupTestData(request);
  });

  test('new user sees empty home page with options to create or generate decks', async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    // Should see the welcome message
    await expect(page.getByRole('heading', { name: /Welcome to 汉语学习/i })).toBeVisible();

    // Should see empty state with options
    await expect(page.getByText('No decks yet')).toBeVisible();
    await expect(page.getByText('Create your first deck or use AI to generate one')).toBeVisible();

    // Should have action buttons
    await expect(page.getByRole('button', { name: 'Create Deck' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Generate' })).toBeVisible();
  });

  test('new user can navigate to generate page', async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Click on Generate link
    await page.getByRole('link', { name: 'Generate' }).click();

    // Should be on the generate page
    await expect(page.getByRole('heading', { name: 'AI Deck Generation' })).toBeVisible();
    await expect(
      page.getByText("Describe what you want to learn and Claude will generate")
    ).toBeVisible();

    // Should see the form elements
    await expect(page.getByLabel(/What do you want to learn/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate Deck with AI' })).toBeVisible();

    // Should see example prompts
    await expect(page.getByText('Example Prompts')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Common greetings and polite expressions' })).toBeVisible();
  });

  test('new user can create an empty deck manually', async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Click Create Deck button
    await page.getByRole('button', { name: 'Create Deck' }).click();

    // Modal should appear
    await expect(page.getByRole('heading', { name: 'Create New Deck' })).toBeVisible();

    // Fill in deck name
    const deckName = `Test Deck ${Date.now()}`;
    await page.getByLabel('Deck Name').fill(deckName);
    await page.getByLabel('Description').fill('A test deck created by E2E tests');

    // Submit the form
    await page.getByRole('button', { name: 'Create Deck' }).click();

    // Should navigate to the deck detail page
    await expect(page.getByRole('heading', { name: deckName })).toBeVisible({ timeout: 10000 });

    // Deck should be empty
    await expect(page.getByText('No notes yet')).toBeVisible();
  });
});

test.describe('AI Deck Generation', () => {
  // Use a longer timeout for AI generation
  test.setTimeout(120000); // 2 minutes

  test.afterAll(async ({ request }) => {
    await cleanupTestData(request);
  });

  test('user can generate a deck with AI', async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Navigate to generate page
    await page.goto('/generate');

    // Fill in the prompt
    const prompt = 'Basic greetings in Chinese';
    await page.getByLabel(/What do you want to learn/i).fill(prompt);

    // Click generate button
    await page.getByRole('button', { name: 'Generate Deck with AI' }).click();

    // Should show loading state
    await expect(page.getByText('Generating...')).toBeVisible();

    // Wait for generation to complete (this may take a while due to AI inference)
    await expect(page.getByRole('heading', { name: 'Deck Generated!' })).toBeVisible({
      timeout: 90000, // 90 seconds for AI generation
    });

    // Should show generated notes
    await expect(page.getByRole('heading', { name: 'Generated Notes' })).toBeVisible();

    // Should have some notes with Chinese characters
    // Look for at least one hanzi element (these have Chinese characters)
    const noteCards = page.locator('.note-card');
    await expect(noteCards.first()).toBeVisible();

    // Should have View Deck and Generate Another buttons
    await expect(page.getByRole('button', { name: 'View Deck' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate Another' })).toBeVisible();
  });

  test('user can click example prompt to fill form', async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Navigate to generate page
    await page.goto('/generate');

    // Click an example prompt
    await page.getByRole('button', { name: 'Common greetings and polite expressions' }).click();

    // The textarea should be filled with the example
    await expect(page.getByLabel(/What do you want to learn/i)).toHaveValue(
      'Common greetings and polite expressions'
    );
  });

  test('generated deck appears on home page', async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Navigate to generate page
    await page.goto('/generate');

    // Fill in the prompt and generate
    const prompt = 'Numbers from 1 to 5 in Chinese';
    const deckName = `E2E Numbers ${Date.now()}`;

    await page.getByLabel(/What do you want to learn/i).fill(prompt);
    await page.getByLabel(/Deck Name/i).fill(deckName);
    await page.getByRole('button', { name: 'Generate Deck with AI' }).click();

    // Wait for generation to complete
    await expect(page.getByRole('heading', { name: 'Deck Generated!' })).toBeVisible({
      timeout: 90000,
    });

    // Click View Deck
    await page.getByRole('button', { name: 'View Deck' }).click();

    // Should be on deck detail page
    await expect(page.getByRole('heading', { name: deckName })).toBeVisible({ timeout: 10000 });

    // Navigate back to home
    await page.goto('/');

    // The new deck should appear in the deck list
    await expect(page.getByText(deckName)).toBeVisible({ timeout: 10000 });
  });
});
