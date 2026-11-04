import { describe, expect, it } from 'vitest';
import { holdReloads, reloadIsDisruptive } from './appUpdates';

describe('reloadIsDisruptive — an app update never reloads the page mid-activity', () => {
  it('holds the reload in a video call (Nov 2026: kicked out of lessons a minute in)', () => {
    expect(reloadIsDisruptive('/calls/abc123')).toBe(true);
    expect(reloadIsDisruptive('/group-class/abc')).toBe(true);
  });

  it('holds it on every full-screen route, not only the old list', () => {
    for (const path of ['/homework/a1', '/lessons/l1/play', '/audio-lessons/x', '/chats/claude/t1', '/phone/rail-1', '/study']) {
      expect(reloadIsDisruptive(path), path).toBe(true);
    }
  });

  it('reloads at once on ordinary screens', () => {
    for (const path of ['/', '/decks', '/chats', '/calls', '/calls/abc/review', '/settings', '/more']) {
      expect(reloadIsDisruptive(path), path).toBe(false);
    }
  });

  it('a hold (the live call) defers it on any screen until released', () => {
    const release = holdReloads('call');
    expect(reloadIsDisruptive('/')).toBe(true);
    release();
    expect(reloadIsDisruptive('/')).toBe(false);
  });
});
