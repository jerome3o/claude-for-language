import { describe, expect, it } from 'vitest';
import { kindCondition, shapeFeatureRequestForMcp } from './feedback.js';
import { signMediaUrls } from './media.js';

describe('feature requests in MCP results', () => {
  it('parses the feedback context and hides the raw key', () => {
    const out = shapeFeatureRequestForMcp({
      id: 'fb-1',
      kind: 'bug',
      content: 'Froze',
      screenshot_url: '/api/audio/feedback/u1/fb-1.png',
      screenshot_key: 'feedback/u1/fb-1.png',
      context: JSON.stringify({ platform: 'lab', app_version: '0.142', screen: '/study', online: false, junk: 'x' }),
    });
    expect(out.context).toEqual({ platform: 'lab', app_version: '0.142', screen: '/study', online: false });
    expect(out.context_line).toBe('Lab app 0.142 · /study · offline');
    expect(out.has_screenshot).toBe(true);
    expect('screenshot_key' in out).toBe(false);
    const old = shapeFeatureRequestForMcp({ id: 'r', content: 'Idea', screenshot_url: null, context: null });
    expect(old).toMatchObject({ kind: 'request', context: null, context_line: null, has_screenshot: false });
  });

  it('the screenshot path gets a signed link', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const api = {
      baseUrl: 'https://api.example',
      post: async <T,>(path: string, body: unknown) => {
        calls.push({ path, body });
        return { urls: { 'feedback/u1/fb-1.png': '/api/audio/feedback/u1/fb-1.png?exp=1&sig=s' } } as T;
      },
    };
    const signed = await signMediaUrls(api, { request: shapeFeatureRequestForMcp({ id: 'fb-1', screenshot_url: '/api/audio/feedback/u1/fb-1.png' }) });
    expect(signed.request.screenshot_url).toBe('https://api.example/api/audio/feedback/u1/fb-1.png?exp=1&sig=s');
    expect(calls[0].path).toBe('/api/media/sign');
  });

  it('kind filters', () => {
    expect(kindCondition('feedback')?.sql).toContain("'feedback', 'bug'");
    expect(kindCondition('request')).toEqual({ sql: 'fr.kind = ?', params: ['request'] });
    expect(kindCondition(undefined)).toBeNull();
  });
});
