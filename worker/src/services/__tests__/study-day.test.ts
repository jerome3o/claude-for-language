import { describe, expect, it } from 'vitest';
import { userProgressShiftMinutes, userStudyDay, userStudyDayKey } from '../study-day';
import { computeStudyStatus } from '../tutor-dashboard';

const H = 3_600_000;

describe('a user\'s study day on the server', () => {
  it('their zone + "New day starts at"; NULL = 4 am', () => {
    const at = Date.UTC(2026, 10, 11, 1, 30); // 01:30 in London
    expect(userStudyDayKey({ time_zone: 'Europe/London', day_rollover_hour: null }, at)).toBe('2026-11-10');
    expect(userStudyDayKey({ time_zone: 'Europe/London', day_rollover_hour: 0 }, at)).toBe('2026-11-11');
    expect(userStudyDayKey({ time_zone: 'Asia/Shanghai', day_rollover_hour: 4 }, at)).toBe('2026-11-11'); // 09:30 there
    // No zone: the client's tz_offset (getTimezoneOffset: west positive), else UTC.
    expect(userStudyDayKey({ time_zone: null, day_rollover_hour: 4 }, Date.UTC(2026, 10, 11, 10), 480)).toBe('2026-11-10'); // 02:00 in LA
    expect(userStudyDay({}, Date.UTC(2026, 10, 11, 12)).startMs).toBe(Date.UTC(2026, 10, 11, 4));
  });

  it('the progress shift', () => {
    expect(userProgressShiftMinutes({ time_zone: 'Europe/London', day_rollover_hour: 4 }, Date.UTC(2026, 6, 1))).toBe(60 - 240);
    expect(userProgressShiftMinutes({ time_zone: null, day_rollover_hour: 0 }, Date.UTC(2026, 6, 1), -480)).toBe(480);
  });

  it('the tutor dashboard counts a 00:30 review as the night before', () => {
    const student = { time_zone: 'Europe/London', day_rollover_hour: 4 };
    const rows = [
      { reviewed_at: '2026-11-10T21:00:00.000Z', rating: 2, time_spent_ms: 1000 },
      { reviewed_at: '2026-11-11T00:30:00.000Z', rating: 2, time_spent_ms: 1000 },
    ];
    const now = new Date(Date.UTC(2026, 10, 11, 2));
    const s = computeStudyStatus(rows, (at) => userStudyDayKey(student, at), now);
    expect(s.today.reviews).toBe(2);
    expect(s.streak_days).toBe(1);
    const midnight = computeStudyStatus(rows, (at) => userStudyDayKey({ ...student, day_rollover_hour: 0 }, at), now);
    expect(midnight.today.reviews).toBe(1);
    expect(midnight.streak_days).toBe(2);
    expect(Date.UTC(2026, 10, 11, 2) - userStudyDay(student, now.getTime()).startMs).toBe(22 * H);
  });
});
