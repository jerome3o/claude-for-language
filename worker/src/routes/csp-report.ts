/**
 * POST /api/csp-report — where browsers report Content-Security-Policy violations of the
 * web app (frontend/public/_headers `report-uri`). Public (the browser sends it, with no
 * session). Each report becomes ONE log line in Workers Observability with only what is
 * needed to fix the policy — the directive and the ORIGIN (or keyword: inline / eval / data /
 * blob) of what was blocked, and the page path — never full URLs, query strings or samples.
 *
 * While the full policy is Report-Only, these lines say whether enforcing it would break
 * anything (filter `type = "csp"`).
 */
import { Hono } from 'hono';
import type { Env } from '../types';

const app = new Hono<{ Bindings: Env }>();

const MAX_BODY = 16 * 1024;

/** `https://x.example/a?b` → `https://x.example`; keywords (inline, eval, data, blob…) as they are. */
export function blockedOrigin(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value.split(':')[0].slice(0, 40);
  try {
    return new URL(value).origin;
  } catch {
    return 'invalid';
  }
}

function pagePath(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    return new URL(value).pathname.slice(0, 120);
  } catch {
    return '';
  }
}

/** The fields worth logging from one report (report-uri `csp-report` or Reporting API `body`). */
export function summarizeCspReport(raw: unknown): Record<string, string | number> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = (raw as Record<string, unknown>)['csp-report'] ?? (raw as Record<string, unknown>).body ?? raw;
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const directive = String(o['effective-directive'] ?? o.effectiveDirective ?? o['violated-directive'] ?? o.violatedDirective ?? '').split(' ')[0].slice(0, 40);
  if (!directive) return null;
  return {
    directive,
    blocked: blockedOrigin(o['blocked-uri'] ?? o.blockedURL),
    page: pagePath(o['document-uri'] ?? o.documentURL),
    source: blockedOrigin(o['source-file'] ?? o.sourceFile),
    line: Number(o['line-number'] ?? o.lineNumber ?? 0) || 0,
    disposition: String(o.disposition ?? '').slice(0, 10),
  };
}

app.post('/csp-report', async (c) => {
  const text = (await c.req.text().catch(() => '')).slice(0, MAX_BODY);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return c.body(null, 204);
  }
  for (const report of Array.isArray(parsed) ? parsed.slice(0, 20) : [parsed]) {
    const s = summarizeCspReport(report);
    if (s) console.log(JSON.stringify({ type: 'csp', ...s }));
  }
  return c.body(null, 204);
});

export default app;
