/**
 * Which browser origins may call the API with credentials (the `/api/*` CORS middleware).
 *
 * Every client that sends an Origin:
 * - the web app / PWA on Cloudflare Pages, and its preview deployments (`<hash>.…pages.dev`);
 * - the hybrid Android app and the desktop app — both load the Pages site, so the same origin;
 * - the Capacitor shell's own origins, kept for its offline placeholder page;
 * - local development (`npm run dev`, E2E) on any localhost port;
 * - the API and MCP workers themselves.
 * The Lab app (OkHttp) and the MCP server's ApiClient send no Origin and are unaffected.
 * Extra origins can be added without a deploy of this file through `CORS_EXTRA_ORIGINS`
 * (comma-separated, exact origins).
 */

const EXACT = new Set([
  'https://chinese-learning-2x9.pages.dev',
  'https://chinese-learning-api.jeromeswannack.workers.dev',
  'https://chinese-learning-mcp.jeromeswannack.workers.dev',
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
]);

const PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.chinese-learning-2x9\.pages\.dev$/,
  /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/,
];

/** The origin to echo back, or null (no Access-Control-Allow-Origin header is sent). */
export function allowedCorsOrigin(origin: string | null | undefined, extra?: string | null): string | null {
  if (!origin) return null;
  if (EXACT.has(origin) || PATTERNS.some((re) => re.test(origin))) return origin;
  if (extra && extra.split(',').map((o) => o.trim()).filter(Boolean).includes(origin)) return origin;
  return null;
}
