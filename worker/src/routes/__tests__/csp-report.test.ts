import { describe, it, expect, vi } from 'vitest';
import cspReport, { blockedOrigin, summarizeCspReport } from '../csp-report';

describe('CSP reports', () => {
  it('keeps only the directive, the blocked origin / keyword and the page path', () => {
    const s = summarizeCspReport({
      'csp-report': {
        'document-uri': 'https://chinese-learning-2x9.pages.dev/connections/abc/chat?x=secret',
        'effective-directive': 'connect-src',
        'blocked-uri': 'wss://stt-rt.soniox.com/transcribe-websocket?api_key=secret',
        'source-file': 'https://chinese-learning-2x9.pages.dev/assets/index-x.js',
        'line-number': 12,
        disposition: 'report',
      },
    });
    expect(s).toEqual({
      directive: 'connect-src',
      blocked: 'wss://stt-rt.soniox.com',
      page: '/connections/abc/chat',
      source: 'https://chinese-learning-2x9.pages.dev',
      line: 12,
      disposition: 'report',
    });
    expect(JSON.stringify(s)).not.toContain('secret');
  });

  it('reads the Reporting API shape and keywords', () => {
    expect(summarizeCspReport({ type: 'csp-violation', body: { effectiveDirective: 'script-src-elem', blockedURL: 'inline', documentURL: 'https://a.example/study' } }))
      .toMatchObject({ directive: 'script-src-elem', blocked: 'inline', page: '/study' });
    expect(blockedOrigin('eval')).toBe('eval');
    expect(blockedOrigin('data:image/png;base64,AAAA')).toBe('data');
    expect(summarizeCspReport({})).toBeNull();
    expect(summarizeCspReport('x')).toBeNull();
  });

  it('answers 204 to anything and logs one line per report', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const body = JSON.stringify({ 'csp-report': { 'violated-directive': 'img-src', 'blocked-uri': 'https://x.example/a.png', 'document-uri': 'https://app.example/' } });
    expect((await cspReport.request('/csp-report', { method: 'POST', body })).status).toBe(204);
    expect((await cspReport.request('/csp-report', { method: 'POST', body: 'not json' })).status).toBe(204);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({ type: 'csp', directive: 'img-src', blocked: 'https://x.example' });
    log.mockRestore();
  });
});
