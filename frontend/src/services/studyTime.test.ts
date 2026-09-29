import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ACTIVE_IDLE_MS } from '@shared/study';

vi.mock('../api/client', async (orig) => {
  const real = await orig<typeof import('../api/client')>();
  return { ...real, putStudyTime: vi.fn() };
});

import { putStudyTime } from '../api/client';
import {
  _resetStudyTime,
  activeMsToday,
  deviceActiveMsToday,
  noteStudyInteraction,
  pauseStudyTime,
  reportStudyTimeIfDue,
  studyDeviceId,
} from './studyTime';
import { getLocalDateString } from '../api/client';

describe('study time on this device', () => {
  const T = new Date('2026-09-29T09:00:00').getTime();
  beforeEach(() => {
    localStorage.clear();
    _resetStudyTime();
    vi.useFakeTimers();
    vi.setSystemTime(T);
    vi.mocked(putStudyTime).mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('counts while interacting, stops after the idle cut-off and when backgrounded', () => {
    noteStudyInteraction(T);
    noteStudyInteraction(T + 30_000);
    expect(deviceActiveMsToday(T + 40_000)).toBe(40_000);
    // Walked away: at most the idle allowance after the last tap.
    expect(deviceActiveMsToday(T + 30_000 + 10 * 60_000)).toBe(30_000 + ACTIVE_IDLE_MS);
    pauseStudyTime(T + 50_000); // screen off
    expect(deviceActiveMsToday(T + 3_600_000)).toBe(50_000);
  });

  it('survives a reload (localStorage) and a pause is saved at once', () => {
    noteStudyInteraction(T);
    pauseStudyTime(T + 20_000);
    _resetStudyTime();
    expect(deviceActiveMsToday(T + 99_000)).toBe(20_000);
  });

  it('reports per-day totals with a stable device id and adds other devices from the server', async () => {
    const day = getLocalDateString();
    vi.mocked(putStudyTime).mockResolvedValue([{ date: day, active_ms: 900_000, device_ms: 60_000 }]);
    noteStudyInteraction(T);
    pauseStudyTime(T + 60_000);
    await reportStudyTimeIfDue(true);
    const [device, days] = vi.mocked(putStudyTime).mock.calls[0];
    expect(device).toBe(studyDeviceId());
    expect(device).toMatch(/^web-[A-Za-z0-9]{8,}$/);
    expect(days).toEqual([{ date: day, active_ms: 60_000 }]);
    // 900 000 on the server of which 60 000 was this device + this device's own 60 000.
    expect(activeMsToday(T + 60_000)).toBe(900_000);
    // Throttled until forced.
    await reportStudyTimeIfDue();
    expect(putStudyTime).toHaveBeenCalledTimes(1);
  });

  it('a failed report is retried at the next chance', async () => {
    vi.mocked(putStudyTime).mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
    noteStudyInteraction(T);
    await reportStudyTimeIfDue();
    await reportStudyTimeIfDue();
    expect(putStudyTime).toHaveBeenCalledTimes(2);
  });
});
