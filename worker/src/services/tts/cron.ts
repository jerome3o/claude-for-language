/**
 * The audio crons (wrangler.toml [triggers], docs/AUDIO.md "Backfill"):
 * - 23:00 and 00:00 UTC: at London midnight (whichever of the two it is that
 *   day) night mode starts — batch work may use more of the MiniMax rate until
 *   ~07:00 — and the backfill pump is started;
 * - hourly: the pump is nudged so the daytime drain keeps going (a pump
 *   already holding the lease ignores the nudge; one that died is replaced).
 */
import type { Env } from '../../types';
import { LIMITER_NAME } from './limiter';
import { startPump } from './queue';
import { NIGHTLY_CRONS, NIGHT_LENGTH_MS, PUMP_KEEPALIVE_CRON, isLondonMidnight } from './schedule';

export type AudioCronAction = 'not_audio' | 'night_started' | 'not_london_midnight' | 'pump_nudged' | 'no_minimax';

export async function runAudioCron(env: Env, cron: string, now: Date): Promise<AudioCronAction> {
  const nightly = (NIGHTLY_CRONS as readonly string[]).includes(cron);
  if (!nightly && cron !== PUMP_KEEPALIVE_CRON) return 'not_audio';
  if (!env.MINIMAX_API_KEY) return 'no_minimax';
  try {
    if (nightly) {
      if (!isLondonMidnight(now)) return 'not_london_midnight';
      if (env.TTS_LIMITER) {
        await env.TTS_LIMITER.get(env.TTS_LIMITER.idFromName(LIMITER_NAME)).setNight(now.getTime() + NIGHT_LENGTH_MS);
      }
      await startPump(env, { night: true });
      return 'night_started';
    }
    await startPump(env);
    return 'pump_nudged';
  } catch (err) {
    console.error('[cron] audio backfill failed to start:', err);
    return nightly ? 'night_started' : 'pump_nudged';
  }
}
