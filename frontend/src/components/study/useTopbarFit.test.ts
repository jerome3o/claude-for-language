import { describe, it, expect } from 'vitest';
import { nextTopbarFit, TOPBAR_FIT_MAX } from './useTopbarFit';

describe('nextTopbarFit', () => {
  it('steps up while the counts overflow, up to the last level', () => {
    expect(nextTopbarFit(0, true)).toBe(1);
    expect(nextTopbarFit(1, true)).toBe(2);
    expect(nextTopbarFit(TOPBAR_FIT_MAX, true)).toBe(TOPBAR_FIT_MAX);
  });
  it('stays where the counts fit', () => {
    expect(nextTopbarFit(0, false)).toBe(0);
    expect(nextTopbarFit(2, false)).toBe(2);
  });
});
