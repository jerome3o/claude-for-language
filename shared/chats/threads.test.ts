import { describe, it, expect } from 'vitest';
import { sqliteToIso } from './threads';

describe('sqliteToIso', () => {
  it('converts the datetime(now) format and leaves ISO alone', () => {
    expect(sqliteToIso('2026-09-25 10:01:02')).toBe('2026-09-25T10:01:02Z');
    expect(sqliteToIso('2026-09-25T10:01:02.000Z')).toBe('2026-09-25T10:01:02.000Z');
  });
});
