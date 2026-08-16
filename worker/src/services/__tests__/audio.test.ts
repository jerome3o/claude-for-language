import { describe, it, expect } from 'vitest';
import { parseByteRange, resolveServedRange } from '../audio';

describe('parseByteRange', () => {
  it('ignores a missing or empty header', () => {
    expect(parseByteRange(undefined)).toBeUndefined();
    expect(parseByteRange(null)).toBeUndefined();
    expect(parseByteRange('')).toBeUndefined();
  });

  it('parses a bounded range inclusively', () => {
    // bytes=0-499 is 500 bytes, not 499
    expect(parseByteRange('bytes=0-499')).toEqual({ offset: 0, length: 500 });
    expect(parseByteRange('bytes=100-100')).toEqual({ offset: 100, length: 1 });
  });

  it('parses an open-ended range', () => {
    expect(parseByteRange('bytes=1024-')).toEqual({ offset: 1024 });
  });

  it('parses a suffix range', () => {
    expect(parseByteRange('bytes=-500')).toEqual({ suffix: 500 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseByteRange('  bytes=0-9 ')).toEqual({ offset: 0, length: 10 });
  });

  it('falls back to the whole object for ranges it cannot serve', () => {
    expect(parseByteRange('bytes=500-100')).toBeUndefined(); // end before start
    expect(parseByteRange('bytes=0-9,20-29')).toBeUndefined(); // multi-range
    expect(parseByteRange('items=0-9')).toBeUndefined(); // wrong unit
    expect(parseByteRange('bytes=-')).toBeUndefined();
    expect(parseByteRange('bytes=-0')).toBeUndefined();
    expect(parseByteRange('bytes=abc-def')).toBeUndefined();
  });
});

describe('resolveServedRange', () => {
  const SIZE = 1000;

  it('returns null when R2 served the whole object', () => {
    expect(resolveServedRange(undefined, SIZE)).toBeNull();
  });

  it('resolves an offset+length range', () => {
    expect(resolveServedRange({ offset: 100, length: 200 }, SIZE)).toEqual({ offset: 100, length: 200 });
  });

  it('resolves an open-ended range to the end of the object', () => {
    expect(resolveServedRange({ offset: 600 }, SIZE)).toEqual({ offset: 600, length: 400 });
  });

  it('converts a suffix range to an absolute offset', () => {
    expect(resolveServedRange({ suffix: 250 }, SIZE)).toEqual({ offset: 750, length: 250 });
  });

  it('clamps a suffix larger than the object', () => {
    expect(resolveServedRange({ suffix: 5000 }, SIZE)).toEqual({ offset: 0, length: SIZE });
  });

  it('rejects a range that runs past the end of the object', () => {
    expect(resolveServedRange({ offset: 900, length: 200 }, SIZE)).toBeNull();
  });
});
