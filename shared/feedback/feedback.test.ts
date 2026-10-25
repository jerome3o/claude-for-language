import { describe, it, expect } from 'vitest';
import {
  FEEDBACK_MAX_MESSAGE,
  FEEDBACK_RECENT_EVENTS,
  feedbackContent,
  feedbackContextLine,
  feedbackProblems,
  pickFeedbackContext,
  routePattern,
} from './feedback';
import { SHAKE_RULE, initialShakeState, shakeStep, type ShakeState } from './shake';

describe('routePattern', () => {
  it('keeps route words and hides ids, hanzi and query strings', () => {
    expect(routePattern('/decks/abc123')).toBe('/decks/:id');
    expect(routePattern('/idioms/画蛇添足?x=1')).toBe('/idioms/:id');
    expect(routePattern('/connections/r1/homework-library')).toBe('/connections/:id/homework-library');
    expect(routePattern('/study')).toBe('/study');
    expect(routePattern('/decks/:id')).toBe('/decks/:id');
    expect(routePattern('')).toBe('/');
    expect(routePattern('https://evil.example/x')).toBe('/');
  });
});

describe('pickFeedbackContext', () => {
  it('keeps the diagnostic fields only', () => {
    const ctx = pickFeedbackContext({
      platform: 'lab',
      app_version: '0.142',
      screen: '/decks/d1?token=secret',
      install_kind: 'lab',
      device: 'Pixel 10 Pro Fold',
      os: 'Android 16',
      online: false,
      viewport: '412x915',
      via: 'shake',
      recent_events: ['study.card_rated', 'Not An Event', 'feedback.open', 42],
      token: 'abc',
      answer: '银行',
    });
    expect(ctx).toEqual({
      platform: 'lab',
      app_version: '0.142',
      screen: '/decks/:id',
      install_kind: 'lab',
      device: 'Pixel 10 Pro Fold',
      os: 'Android 16',
      online: false,
      viewport: '412x915',
      via: 'shake',
      recent_events: ['study.card_rated', 'feedback.open'],
    });
  });

  it('drops bad values and caps the event list', () => {
    const many = Array.from({ length: 40 }, (_, i) => `study.e${i}`);
    const ctx = pickFeedbackContext({ platform: 'ios', device: '<script>', viewport: 'big', via: 'yell', recent_events: many, online: 'yes' });
    expect(ctx.platform).toBeUndefined();
    expect(ctx.device).toBeUndefined();
    expect(ctx.viewport).toBeUndefined();
    expect(ctx.via).toBeUndefined();
    expect(ctx.online).toBeUndefined();
    expect(ctx.recent_events).toHaveLength(FEEDBACK_RECENT_EVENTS);
    expect(ctx.recent_events?.[FEEDBACK_RECENT_EVENTS - 1]).toBe('study.e39');
    expect(pickFeedbackContext(null)).toEqual({});
    expect(pickFeedbackContext('x')).toEqual({});
  });
});

describe('feedback text', () => {
  it('a context line reads like a breadcrumb', () => {
    expect(feedbackContextLine({ platform: 'lab', app_version: '0.142', screen: '/study', device: 'Pixel 10 Pro Fold', online: false, via: 'shake' }))
      .toBe('Lab app 0.142 · /study · Pixel 10 Pro Fold · offline · shaken');
    expect(feedbackContextLine({ platform: 'vr', screen: '/vr' })).toBe('VR · /vr');
    expect(feedbackContextLine(null)).toBe('');
  });

  it('a screenshot alone is enough; nothing at all is not', () => {
    expect(feedbackProblems({ message: '  ', hasScreenshot: false })).toEqual(['empty']);
    expect(feedbackProblems({ message: '', hasScreenshot: true })).toEqual([]);
    expect(feedbackProblems({ message: 'x'.repeat(FEEDBACK_MAX_MESSAGE + 1), hasScreenshot: false })).toEqual(['too_long']);
    expect(feedbackProblems({ message: 'hi', hasScreenshot: false, kind: 'rant' })).toEqual(['kind']);
    expect(feedbackContent('', true, 'bug')).toMatch(/screenshot only/);
    expect(feedbackContent(' The card froze ', true, 'bug')).toBe('The card froze');
  });
});

function feed(samples: Array<[number, number]>): { shakes: number[]; state: ShakeState } {
  let state = initialShakeState();
  const shakes: number[] = [];
  for (const [t, m] of samples) {
    const r = shakeStep(state, { t, x: 0, y: m, z: 0 });
    state = r.state;
    if (r.shake) shakes.push(t);
  }
  return { shakes, state };
}

describe('shakeStep', () => {
  it('an angry shake (jolts every ~120 ms) opens the sheet once', () => {
    const samples: Array<[number, number]> = [];
    for (let t = 0; t < 1500; t += 20) samples.push([t, t % 120 === 0 ? 30 : 9.8]);
    const { shakes } = feed(samples);
    expect(shakes).toEqual([360]);
  });

  it('walking and running never do', () => {
    const walk: Array<[number, number]> = [];
    for (let t = 0; t < 10000; t += 20) walk.push([t, t % 500 === 0 ? 16 : 9.8]);
    expect(feed(walk).shakes).toEqual([]);
    const run: Array<[number, number]> = [];
    for (let t = 0; t < 10000; t += 20) run.push([t, t % 340 === 0 ? 27 : 9.8]);
    expect(feed(run).shakes).toEqual([]);
  });

  it('jolts closer than the gap count once, and the cooldown holds', () => {
    const samples: Array<[number, number]> = [];
    for (let t = 0; t < 400; t += 20) samples.push([t, 30]); // one long jolt
    expect(feed(samples).shakes.length).toBe(1); // 0, 100, 200, 300 → 4 jolts at gap ≥ 90 (every 100 ms here)
    const twice: Array<[number, number]> = [];
    for (let t = 0; t < SHAKE_RULE.cooldownMs + 2000; t += 100) twice.push([t, 30]);
    const { shakes } = feed(twice);
    expect(shakes[0]).toBe(300);
    expect(shakes[1] - shakes[0]).toBeGreaterThanOrEqual(SHAKE_RULE.cooldownMs);
  });

  it('ignores broken samples', () => {
    const r = shakeStep(initialShakeState(), { t: 0, x: NaN, y: 40, z: 0 });
    expect(r.shake).toBe(false);
  });
});
