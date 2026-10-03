import { describe, expect, it } from 'vitest';
import { isResumablePath, nativeRouteAction } from './nativeRoute';

describe('nativeRouteAction', () => {
  it('never stacks a second Study', () => {
    expect(nativeRouteAction('/study?autostart=true', '/study?autostart=true')).toBe('stay');
    expect(nativeRouteAction('/study', '/study?autostart=true')).toBe('stay');
  });

  it('a study reminder ALWAYS opens Study, over a homework pass / reader / quest too', () => {
    for (const p of ['/homework/hw1', '/readers/r1', '/picture-hunt/p1', '/quests/q1', '/tutor-notes/practice', '/library/l1/try']) {
      expect(nativeRouteAction(p, '/study?autostart=true')).toBe('navigate');
    }
  });

  it('the homework reminder leaves a pass in progress on screen', () => {
    expect(nativeRouteAction('/homework/hw1', '/homework')).toBe('stay');
    expect(nativeRouteAction('/readers/r1', '/homework/hw2')).toBe('stay');
    expect(nativeRouteAction('/decks', '/homework/hw2')).toBe('navigate');
  });

  it('opens Study from anywhere else', () => {
    expect(nativeRouteAction('/', '/study?autostart=true')).toBe('navigate');
    expect(nativeRouteAction('/decks/abc', '/study?autostart=true')).toBe('navigate');
    expect(nativeRouteAction('/homework', '/study?autostart=true')).toBe('navigate');
  });

  it('chat links are explicit; the same page twice adds nothing', () => {
    expect(nativeRouteAction('/homework/hw1', '/connections/r1/chat/c1')).toBe('navigate');
    expect(nativeRouteAction('/connections/r1/chat/c1', '/connections/r1/chat/c1')).toBe('stay');
  });

  it('knows what is resumable', () => {
    expect(isResumablePath('/readers/generate')).toBe(false);
    expect(isResumablePath('/readers')).toBe(false);
    expect(isResumablePath('/homework')).toBe(false);
    expect(isResumablePath('/homework/x?y=1')).toBe(true);
  });
});
