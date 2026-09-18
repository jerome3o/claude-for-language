import { describe, it, expect } from 'vitest';
import { resolveLanding, LANDING_PATHS } from './landing';

describe('resolveLanding', () => {
  it('honours an explicit preference regardless of role or counts', () => {
    expect(resolveLanding('students', false, 12, false)).toBe('students');
    expect(resolveLanding('decks', true, 0, false)).toBe('decks');
    expect(resolveLanding('study', true, 0, false)).toBe('study');
    // even while counts are still loading
    expect(resolveLanding('students', true, 0, true)).toBe('students');
  });

  it('defaults to study for a plain student', () => {
    expect(resolveLanding(null, false, 0, false)).toBe('study');
    expect(resolveLanding(undefined, false, 40, false)).toBe('study');
  });

  it('sends a tutor with nothing due to the students page', () => {
    expect(resolveLanding(null, true, 0, false)).toBe('students');
  });

  it('keeps a tutor who also has cards due on study', () => {
    expect(resolveLanding(null, true, 3, false)).toBe('study');
  });

  it('never answers students while counts are loading (no flash)', () => {
    expect(resolveLanding(null, true, 0, true)).toBe('study');
    expect(resolveLanding(null, false, 0, true)).toBe('study');
  });

  it('maps every landing to a route', () => {
    expect(LANDING_PATHS.study).toBe('/');
    expect(LANDING_PATHS.students).toBe('/connections');
    expect(LANDING_PATHS.decks).toBe('/decks');
  });
});
