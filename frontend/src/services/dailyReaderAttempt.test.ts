import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as client from '../api/client';
import {
  ensureDailyReader,
  shouldAttemptDailyReader,
  getDailyReaderAttemptDate,
  recordDailyReaderAttempt,
  clearDailyReaderAttempt,
} from './readerSync';

describe('shouldAttemptDailyReader (pure)', () => {
  it('allows the first attempt of the day', () => {
    expect(shouldAttemptDailyReader(null, '2026-09-18')).toBe(true);
    expect(shouldAttemptDailyReader('2026-09-17', '2026-09-18')).toBe(true);
  });

  it('blocks a second attempt on the same local date', () => {
    expect(shouldAttemptDailyReader('2026-09-18', '2026-09-18')).toBe(false);
  });
});

describe('attempt date storage', () => {
  beforeEach(() => clearDailyReaderAttempt());

  it('round-trips through localStorage', () => {
    expect(getDailyReaderAttemptDate()).toBeNull();
    recordDailyReaderAttempt('2026-09-18');
    expect(getDailyReaderAttemptDate()).toBe('2026-09-18');
    clearDailyReaderAttempt();
    expect(getDailyReaderAttemptDate()).toBeNull();
  });
});

describe('ensureDailyReader — one attempt per local date', () => {
  beforeEach(() => {
    clearDailyReaderAttempt();
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
  });

  it('asks the server once, then skips for the rest of the day even after a failure', async () => {
    // A failed daily reader: the server answers 'failed' and, before the
    // guard, would have been asked again at every session end.
    const gen = vi.spyOn(client, 'generateDailyReader').mockResolvedValue({
      reader_id: 'r1',
      situation_id: 'due-cards',
      status: 'failed',
      error_message: 'Could not resolve authentication method.',
    });

    expect(await ensureDailyReader()).toBe(false);
    expect(gen).toHaveBeenCalledTimes(1);
    expect(getDailyReaderAttemptDate()).toBe(client.getLocalDateString());

    expect(await ensureDailyReader()).toBe(false);
    expect(await ensureDailyReader()).toBe(false);
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it('asks again on a new local date', async () => {
    const gen = vi.spyOn(client, 'generateDailyReader').mockResolvedValue({
      reader_id: 'r1',
      situation_id: 'due-cards',
      status: 'generating',
    });
    recordDailyReaderAttempt('2000-01-01'); // "yesterday"

    expect(await ensureDailyReader()).toBe(true);
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it('records the attempt even when the request throws, so a flaky API is not hammered', async () => {
    const gen = vi.spyOn(client, 'generateDailyReader').mockRejectedValue(new Error('500'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await ensureDailyReader()).toBe(false);
    expect(await ensureDailyReader()).toBe(false);
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it('does not count an offline call as an attempt', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
    const gen = vi.spyOn(client, 'generateDailyReader');

    expect(await ensureDailyReader()).toBe(false);
    expect(gen).not.toHaveBeenCalled();
    expect(getDailyReaderAttemptDate()).toBeNull();
  });
});
