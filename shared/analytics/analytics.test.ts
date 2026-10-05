import { describe, it, expect } from 'vitest';
import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
  FORBIDDEN_PROP_KEYS,
  LEGACY_USAGE_UPLOAD_PATH,
  SCREEN_REPLACED_BY,
  USAGE_UPLOAD_PATH,
  VERBOSE_ONLY_EVENTS,
  analyticsUploadPathProblems,
  eventAllowedAtLevel,
  isClientEvent,
  parseAnalyticsLevel,
  parseUsageUpload,
  sanitizeProps,
  screenName,
  type AnalyticsEventDef,
} from './index';

describe('catalogue', () => {
  it('names are area.snake_case and unique', () => {
    for (const name of ANALYTICS_EVENT_NAMES) expect(name).toMatch(/^[a-z_]+\.[a-z_]+$/);
    expect(new Set(ANALYTICS_EVENT_NAMES).size).toBe(ANALYTICS_EVENT_NAMES.length);
  });

  it('no event declares a forbidden prop key', () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      for (const key of (ANALYTICS_EVENTS[name] as AnalyticsEventDef).props) {
        expect(FORBIDDEN_PROP_KEYS, `${name}.${key}`).not.toContain(key);
      }
    }
  });

  it('replacedBy points at a real event; replaced screens at another screen', () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      const r = (ANALYTICS_EVENTS[name] as AnalyticsEventDef).replacedBy;
      if (r) expect(ANALYTICS_EVENT_NAMES).toContain(r);
    }
    for (const [from, to] of Object.entries(SCREEN_REPLACED_BY)) expect(from).not.toBe(to);
    for (const v of VERBOSE_ONLY_EVENTS) expect(ANALYTICS_EVENT_NAMES).toContain(v);
  });

  it('server events cannot be sent by a client', () => {
    expect(isClientEvent('server.ai_call')).toBe(false);
    expect(isClientEvent('study.card_rated')).toBe(true);
    expect(isClientEvent('made.up')).toBe(false);
  });

  it('levels', () => {
    expect(parseAnalyticsLevel(undefined)).toBe('verbose');
    expect(parseAnalyticsLevel(' OFF ')).toBe('off');
    expect(parseAnalyticsLevel('nonsense')).toBe('verbose');
    expect(eventAllowedAtLevel('study.card_rated', 'basic')).toBe(false);
    expect(eventAllowedAtLevel('study.session_start', 'basic')).toBe(true);
    expect(eventAllowedAtLevel('study.session_start', 'off')).toBe(false);
  });
});

describe('privacy filter', () => {
  it('drops a message body, card content and an email whatever the key', () => {
    const props = sanitizeProps('chat.send', {
      kind: 'text',
      text: '我今天很累，想早点睡觉',
      content: 'hello there',
      body: 'secret',
      email: 'minghui@example.com',
      is_ai: false,
    });
    expect(props).toEqual({ kind: 'text', is_ai: false });
    expect(JSON.stringify(props)).not.toContain('睡觉');
  });

  it('drops a sentence, Chinese or an address even under an allowed key', () => {
    expect(sanitizeProps('chat.menu_action', { action: 'translate this please', kind: '你好' })).toEqual({});
    expect(sanitizeProps('error.shown', { code: 'a@b.co', where: 'study', status: 503 })).toEqual({ where: 'study', status: 503 });
    expect(sanitizeProps('error.shown', { code: 'x'.repeat(65) })).toEqual({});
  });

  it('keeps ids, enums, numbers and booleans; drops non-finite numbers and objects', () => {
    expect(sanitizeProps('study.card_rated', { rating: 'good', card_type: 'hanzi_to_meaning', time_ms: 4200.4, recorded: true, queue: NaN, extra: 1 }))
      .toEqual({ rating: 'good', card_type: 'hanzi_to_meaning', time_ms: 4200.4, recorded: true });
    expect(sanitizeProps('study.card_rated', { rating: { nested: 'x' } })).toEqual({});
    expect(sanitizeProps('unknown.event', { a: 1 })).toEqual({});
    expect(sanitizeProps('study.card_rated', ['good'])).toEqual({});
  });
});

describe('screenName', () => {
  it('replaces ids with :id and drops query / hash', () => {
    expect(screenName('/connections/3f1c2b9a-1234-4cde-9abc-0123456789ab/chat/abc123def456?x=1#y')).toBe('/connections/:id/chat/:id');
    expect(screenName('/decks/12345')).toBe('/decks/:id');
    expect(screenName('/readers/{id}/edit')).toBe('/readers/:id/edit');
    expect(screenName('/coach?text=我想')).toBe('/coach');
    expect(screenName('/cards/%E4%BD%A0')).toBe('/cards/:id');
    expect(screenName('/library/catalogue')).toBe('/library/catalogue');
    expect(screenName('/settings/voices')).toBe('/settings/voices');
    expect(screenName('')).toBe('/');
    expect(screenName('/')).toBe('/');
  });
});

describe('parseUsageUpload', () => {
  const now = Date.parse('2026-10-03T10:00:00Z');
  const base = { id: 'evt_0001abcd', ts: '2026-10-03T09:59:00Z', event: 'study.card_rated', session_id: 's_123', platform: 'lab', app_version: '0.57 (412)' };

  it('keeps valid events, re-filters props and normalises the screen', () => {
    const res = parseUsageUpload({ events: [{ ...base, screen: '/decks/abcdef123456', props: { rating: 'good', answer: '你好' } }] }, now);
    if ('error' in res) throw new Error(res.error);
    expect(res.rejected).toBe(0);
    expect(res.events[0]).toMatchObject({ id: 'evt_0001abcd', screen: '/decks/:id', props: { rating: 'good' }, platform: 'lab', app_version: '0.57 (412)' });
  });

  it('rejects unknown / server events, bad ids and platforms; clamps future times', () => {
    const res = parseUsageUpload({
      events: [
        { ...base, event: 'server.ai_call' },
        { ...base, event: 'nope.nope' },
        { ...base, id: 'x' },
        { ...base, platform: 'ios' },
        { ...base, ts: 'yesterday' },
        { ...base, id: 'evt_future01', ts: '2027-01-01T00:00:00Z' },
      ],
    }, now);
    if ('error' in res) throw new Error(res.error);
    expect(res.rejected).toBe(5);
    expect(res.events[0].ts).toBe(new Date(now).toISOString());
  });

  it('refuses a body without events', () => {
    expect(parseUsageUpload({}, now)).toEqual({ error: '`events` must be an array' });
  });

  it('keeps a web-shaped event as the web client queues it (ids, ISO build time, session, route pattern)', () => {
    const res = parseUsageUpload({
      events: [{
        id: 'e_0mfx3k2a10003_k3j9x0aa', ts: '2026-10-03T09:58:00.000Z', event: 'app.screen_view', screen: '/connections/:id',
        props: { duration_ms: 27111 }, session_id: 's_6f1c2a4e-1b2c-4d5e-8f90-123456789abc', platform: 'web', app_version: '2026-10-03T18:01:09.171Z',
      }],
    }, now);
    if ('error' in res) throw new Error(res.error);
    expect(res.rejected).toBe(0);
    expect(res.events[0]).toMatchObject({ platform: 'web', app_version: '2026-10-03T18:01:09.171Z', screen: '/connections/:id', props: { duration_ms: 27111 } });
  });
});

describe('upload path', () => {
  it('is not one a content blocker refuses (EasyPrivacy "/analytics/event" blocked every browser upload)', () => {
    expect(analyticsUploadPathProblems(LEGACY_USAGE_UPLOAD_PATH)).toContain('/analytics/event');
    expect(analyticsUploadPathProblems(USAGE_UPLOAD_PATH)).toEqual([]);
  });
});
