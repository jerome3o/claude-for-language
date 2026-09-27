import { test, expect } from './fixtures/auth';
import type { Page } from '@playwright/test';

/**
 * Handwriting practice (/practice/strokes, preview): the stroke data is served
 * next to the app, a stroke drawn out of order is called out, and writing the
 * strokes in order finishes the character with a summary.
 *
 * Strokes are drawn with the mouse along the character's medians (the same
 * data the grader uses), converted to screen coordinates.
 */

// 十 from hanzi-writer-data: [horizontal, vertical], data space (1024 box, y up)
const SHI: [number, number][][] = [
  [[109, 442], [177, 422], [373, 456], [819, 505], [869, 499], [932, 476]],
  [[456, 811], [484, 803], [522, 767], [512, 593], [507, -33]],
];

async function drawStroke(page: Page, median: [number, number][]) {
  const box = await page.getByTestId('stroke-pad').boundingBox();
  if (!box) throw new Error('no pad');
  const pts = median.map(([x, y]) => [box.x + (x / 1024) * box.width, box.y + ((900 - y) / 1024) * box.height]);
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
}

test('stroke data is served as /strokes/<hex>.json', async ({ request }) => {
  const res = await request.get('http://localhost:3000/strokes/5341.json'); // 十
  expect(res.ok()).toBe(true);
  const json = await res.json();
  expect(json.medians).toHaveLength(2);
});

test('write 十: wrong order is called out, then the right strokes finish it', async ({ authenticatedPage: page }) => {
  await page.gotoAuthenticated(`/practice/strokes?text=${encodeURIComponent('十')}`);
  await expect(page.getByTestId('stroke-pad')).toBeVisible({ timeout: 30000 });

  // Vertical first — the grader knows it is stroke 2.
  await drawStroke(page, SHI[1]);
  await expect(page.getByTestId('writing-status')).toContainText('stroke 1 comes first');

  await drawStroke(page, SHI[0]);
  await drawStroke(page, SHI[1]);

  const summary = page.getByTestId('writing-summary');
  await expect(summary).toBeVisible({ timeout: 5000 });
  await expect(summary).toContainText('十');
  await expect(summary).toContainText('1 mistake');
});
