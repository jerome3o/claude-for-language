import { describe, it, expect } from 'vitest';
import { updateRequiredPage } from '../auth';

describe('updateRequiredPage (a web sign-in without a challenge)', () => {
  it('is a self-contained HTML page that tells the browser to update, not a redirect', async () => {
    const res = updateRequiredPage('https://chinese-learning-2x9.pages.dev');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    const html = await res.text();
    expect(html).toContain('old copy of the app');
    expect(html).toContain('href="https://chinese-learning-2x9.pages.dev/"');
    expect(html).toContain('chinese-learning-2x9.pages.dev → Clear');
    expect(html).not.toMatch(/<script/i);
  });

  it('escapes the app URL', async () => {
    const html = await updateRequiredPage('http://localhost:3000"><b>').text();
    expect(html).not.toContain('"><b>');
  });
});
