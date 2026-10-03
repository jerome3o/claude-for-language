/**
 * When the nightly audio backfill runs (docs/AUDIO.md). Cron schedules are UTC,
 * so the worker fires at 23:00 and 00:00 UTC and only acts when it is midnight
 * in London: 23:00 UTC in summer (BST), 00:00 UTC in winter (GMT).
 */

export const NIGHT_TIME_ZONE = 'Europe/London';
export const NIGHTLY_CRONS = ['0 23 * * *', '0 0 * * *'] as const;
/** Keeps the daytime drain alive (a pump that died is restarted). */
export const PUMP_KEEPALIVE_CRON = '37 * * * *';
/** How long "night" lasts once it starts: batch work may use more of the rate until ~07:00 London. */
export const NIGHT_LENGTH_MS = 7 * 3600_000;

/** Hour (0–23) of `date` in London. */
export function londonHour(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: NIGHT_TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Number(parts.find((p) => p.type === 'hour')?.value ?? NaN) % 24;
}

/** Is it (about) midnight in London — the hour starting 00:00 local? A late cron still counts. */
export function isLondonMidnight(date: Date): boolean {
  return londonHour(date) === 0;
}
