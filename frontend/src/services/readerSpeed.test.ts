import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { READER_SPEED_STORAGE_KEY } from '@shared/reader/speed';

vi.mock('./analytics', () => ({ track: vi.fn() }));

import { track } from './analytics';
import {
  cycleReaderSpeed,
  getReaderSpeed,
  resetReaderSpeedForTests,
  setReaderSpeed,
  subscribeReaderSpeed,
} from './readerSpeed';

beforeEach(() => {
  localStorage.clear();
  resetReaderSpeedForTests();
  vi.mocked(track).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reader speed on this device', () => {
  it('starts at 1×', () => {
    expect(getReaderSpeed()).toBe(1);
  });

  it('cycles 1× → 0.75× → 0.5× → 1×, remembering each and recording the change', () => {
    expect(cycleReaderSpeed()).toBe(0.75);
    expect(localStorage.getItem(READER_SPEED_STORAGE_KEY)).toBe('0.75');
    expect(cycleReaderSpeed()).toBe(0.5);
    expect(cycleReaderSpeed()).toBe(1);
    expect(vi.mocked(track).mock.calls).toEqual([
      ['reader.speed_changed', { speed: 0.75 }],
      ['reader.speed_changed', { speed: 0.5 }],
      ['reader.speed_changed', { speed: 1 }],
    ]);
  });

  it('comes back after a reload', () => {
    setReaderSpeed(0.5);
    resetReaderSpeedForTests();
    expect(getReaderSpeed()).toBe(0.5);
  });

  it('ignores a corrupt stored value', () => {
    localStorage.setItem(READER_SPEED_STORAGE_KEY, 'warp');
    expect(getReaderSpeed()).toBe(1);
  });

  it('works when storage throws (private window / blocked site data)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(getReaderSpeed()).toBe(1);
    expect(cycleReaderSpeed()).toBe(0.75);
    expect(getReaderSpeed()).toBe(0.75);
  });

  it('tells every reader view on the page', () => {
    const seen: number[] = [];
    const off = subscribeReaderSpeed(() => seen.push(getReaderSpeed()));
    setReaderSpeed(0.75);
    setReaderSpeed(0.5);
    off();
    setReaderSpeed(1);
    expect(seen).toEqual([0.75, 0.5]);
  });
});
