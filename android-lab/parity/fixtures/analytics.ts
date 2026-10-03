/**
 * Usage analytics (shared/analytics): the event catalogue (names, area, props, server,
 * replacedBy, verbose-only list, levels) and golden vectors for sanitizeProps, isSafeToken,
 * isIdSegment, screenName, parseAnalyticsLevel and eventAllowedAtLevel. Writes
 * analytics.json; checked by core/…/analytics/AnalyticsParityTest.kt.
 *
 * Prop values that JSON can't carry are written as markers the Kotlin test decodes the same
 * way: "__NaN__", "__Inf__", "__-Inf__", "__obj__" ({}), "__arr__" ([]).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ANALYTICS_EVENTS,
  ANALYTICS_LEVELS,
  ANALYTICS_PLATFORMS,
  SCREEN_REPLACED_BY,
  USAGE_RETENTION_DAYS,
  VERBOSE_ONLY_EVENTS,
  eventAllowedAtLevel,
  parseAnalyticsLevel,
} from '../../../shared/analytics/events';
import { FORBIDDEN_PROP_KEYS, MAX_PROPS, MAX_PROP_STRING, isIdSegment, isSafeToken, sanitizeProps, screenName } from '../../../shared/analytics/privacy';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const catalogue = Object.entries(ANALYTICS_EVENTS).map(([name, d]) => {
  const def = d as { area: string; props: readonly string[]; server?: boolean; replacedBy?: string };
  return { name, area: def.area, props: [...def.props], server: !!def.server, replacedBy: def.replacedBy ?? null };
});

function decode(v: unknown): unknown {
  if (v === '__NaN__') return NaN;
  if (v === '__Inf__') return Infinity;
  if (v === '__-Inf__') return -Infinity;
  if (v === '__obj__') return {};
  if (v === '__arr__') return [];
  return v;
}

const MESSAGE = '你好，我明天不能来上课了，对不起！';
type Case = { event: string; props: Record<string, unknown> };
const cases: Case[] = [
  // Allowed keys with safe values.
  { event: 'study.card_rated', props: { rating: 'good', card_type: 'hanzi_to_meaning', queue: 2, time_ms: 5321, recorded: true, multiple_choice: false } },
  // A message body / Chinese sentence / e-mail under ALLOWED keys: dropped by the value rule.
  { event: 'chat.send', props: { kind: MESSAGE, is_ai: false, reply: 'see you at 5pm', offline: null } },
  { event: 'chat.menu_action', props: { action: 'jerome@example.com', kind: 'text' } },
  { event: 'error.shown', props: { code: 'Network error: could not reach the server', where: '/decks/:id', status: 503 } },
  // Forbidden / undeclared keys: dropped by the key rules.
  { event: 'chat.send', props: { text: 'hello', message: MESSAGE, body: 'x', kind: 'text', email: 'a@b.c' } },
  { event: 'study.ask_claude', props: { card_type: 'audio_to_hanzi', question: 'what does 了 mean?', hanzi: '了', answer: 'le' } },
  // Numbers: rounding, non-finite, huge, negative, -0.
  { event: 'app.screen_view', props: { duration_ms: 1234.56789012, from: '/study' } },
  { event: 'app.screen_view', props: { duration_ms: '__NaN__' } },
  { event: 'app.screen_view', props: { duration_ms: '__Inf__', from: '__obj__' } },
  { event: 'study.session_end', props: { reviews: 0.0000004, duration_ms: -0.0000006, reason: 'emptied' } },
  { event: 'study.session_end', props: { reviews: 1e20, duration_ms: 2.5e-7, reason: '' } },
  { event: 'study.session_end', props: { reviews: 0.5, duration_ms: -0.5, reason: 'x'.repeat(64) } },
  { event: 'study.session_end', props: { reviews: 1.0000005, duration_ms: 3, reason: 'x'.repeat(65) } },
  // Arrays / objects are never props.
  { event: 'deck.paste_list', props: { added: '__arr__', updated: 3, skipped: '__obj__', failed: null } },
  // Unknown event → no props at all; event with no props.
  { event: 'not.an.event', props: { kind: 'text' } },
  { event: 'study.edit_card', props: { kind: 'text', anything: 1 } },
  // Token shapes.
  { event: 'settings.change', props: { setting: 'sound_on', value: 'on' } },
  { event: 'settings.change', props: { setting: 'landing page', value: 'a/b:c.d-e_f' } },
  { event: 'settings.change', props: { setting: 'ünïcode', value: '１２３' } },
  { event: 'notification.tapped', props: { kind: 'chat_message' } },
  { event: 'server.ai_call', props: { provider: 'anthropic', model: 'claude-sonnet-5', input_tokens: 12, output_tokens: 34, cache_read_tokens: 0, cost_usd: 0.0012345678, status: 'ok', route: '/api/notes/:id/ask' } },
  { event: 'chat.pinyin_toggle', props: { aid: 'pinyin', on: true } },
  { event: 'tutor.budget_change', props: { new_cards: 5, secondary_cards: 10, reset: false } },
];
const sanitize = cases.map((c) => {
  const decoded: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c.props)) decoded[k] = decode(v);
  return { event: c.event, props: c.props, out: sanitizeProps(c.event, decoded) };
});
// Every catalogue event with a full prop map of mixed values.
const mixed = ['ok', 'two words', 7.25, true, null, MESSAGE, 'x@y.z', 'abc123DEF', '__NaN__'];
for (const { name, props } of catalogue) {
  const p: Record<string, unknown> = {};
  props.forEach((k, i) => (p[k] = mixed[(i + name.length) % mixed.length]));
  const decoded: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) decoded[k] = decode(v);
  sanitize.push({ event: name, props: p, out: sanitizeProps(name, decoded) });
}

const tokens = ['', 'a', 'ok', 'two words', 'x@y.z', 'a/b:c.d-e_f', '你好', 'x'.repeat(64), 'x'.repeat(65), 'tab\there', 'new\nline', '+plus', 'é', '١٢٣', '１２３'];
const tokenVectors = tokens.map((t) => ({ value: t, safe: isSafeToken(t) }));

const segments = [
  '', 'decks', 'v2', 'abc', 'abc123', 'abc12345', 'ABCDEFGH', 'abcdefgh1', '12345', '0', '2026-10-03', '2026-10-3',
  '550e8400-e29b-41d4-a716-446655440000', '550E8400-E29B-41D4-A716-446655440000', 'Decks', 'my_deck', 'a-b-c', '-abc',
  '%E4%BD%A0', '你好', 'jerome@example.com', 'x_y-z12345', 'abcdefg1', 'abcdefg_', 'review',
  'lesson-attempts', '9abc', 'a.b', '١٢٣٤٥٦٧٨', 'aaaaaaa٣',
];
const segmentVectors = segments.map((s) => ({ seg: s, id: isIdSegment(s) }));

const paths = [
  '', '/', '?x=1', '#top', '/decks', '/decks/', '//decks//abc12345//', '/decks/abc12345def', '/decks/{id}', '/decks/:id',
  '/connections/abc123def456/chat/xyz98765', '/connections/{relId}/chat/{convId}', '/study?deck=abc123def456', '/coach?text=你好',
  '/coach#frag', '/readers/42/edit', '/homework/2026-10-03', '/cards/550e8400-e29b-41d4-a716-446655440000',
  '/practice/strokes?text=字', '/search', '/settings/sentences', '/library/catalogue/describe_image', '/calls/abc/review',
  '/tutor-notes/practice?cards=a,b', 'decks/abc12345', '/%E4%BD%A0/x', '/a/B/c', '/v2/api', '/{}/x', '/{x}', '/::/y',
];
const pathVectors = paths.map((p) => ({ path: p, screen: screenName(p) }));

const levelInputs: unknown[] = ['off', 'basic', 'verbose', ' BASIC ', 'Off', '', 'loud', null, 3, '　off　'];
const levels = levelInputs.map((raw) => ({ raw, level: parseAnalyticsLevel(raw) }));
const allowed = catalogue.flatMap(({ name }) =>
  (['off', 'basic', 'verbose'] as const).map((level) => ({ name, level, allowed: eventAllowedAtLevel(name, level) })),
);

writeFileSync(
  join(OUT, 'analytics.json'),
  JSON.stringify({
    catalogue,
    verbose_only: [...VERBOSE_ONLY_EVENTS],
    levels_list: [...ANALYTICS_LEVELS],
    platforms: [...ANALYTICS_PLATFORMS],
    screen_replaced_by: SCREEN_REPLACED_BY,
    retention_days: USAGE_RETENTION_DAYS,
    forbidden: [...FORBIDDEN_PROP_KEYS],
    max_props: MAX_PROPS,
    max_prop_string: MAX_PROP_STRING,
    sanitize,
    tokens: tokenVectors,
    segments: segmentVectors,
    paths: pathVectors,
    levels,
    allowed,
  }),
);
