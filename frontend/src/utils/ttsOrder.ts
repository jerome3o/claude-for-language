/**
 * The provider order lists on /admin/audio (stored clips, live playback):
 * pure moves so the page and its tests agree.
 */
import { TTS_PROVIDERS, type TtsConfig, type TtsProviderId } from '@shared/tts';

/** Move `id` one step up (-1) or down (+1); unchanged at the ends or when absent. */
export function moveProvider(order: readonly TtsProviderId[], id: TtsProviderId, dir: -1 | 1): TtsProviderId[] {
  const out = [...order];
  const i = out.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/**
 * Include (append at the end) or exclude a provider. Excluding the last one is
 * refused (at least one must remain): the order comes back unchanged.
 */
export function toggleProvider(order: readonly TtsProviderId[], id: TtsProviderId, include: boolean): TtsProviderId[] {
  if (include) return order.includes(id) ? [...order] : [...order, id];
  if (!order.includes(id) || order.length <= 1) return [...order];
  return order.filter((p) => p !== id);
}

/** The rows a list shows: the order first, then the providers left out (in catalogue order). */
export function orderRows(order: readonly TtsProviderId[]): Array<{ id: TtsProviderId; included: boolean; position: number | null }> {
  const rows: Array<{ id: TtsProviderId; included: boolean; position: number | null }> = order.map((id, i) => ({ id, included: true, position: i + 1 }));
  for (const id of TTS_PROVIDERS) if (!order.includes(id)) rows.push({ id, included: false, position: null });
  return rows;
}

/** Deep equality for two configs (key order of the JSON is stable: both come from the same shapes). */
export function sameTtsConfig(a: TtsConfig, b: TtsConfig): boolean {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

function normalise(c: TtsConfig) {
  return {
    stored_order: c.stored_order,
    live_order: c.live_order,
    upgrade_backup_clips: c.upgrade_backup_clips,
    providers: Object.fromEntries(
      TTS_PROVIDERS.map((id) => {
        const p = c.providers[id];
        return [id, { enabled: p.enabled, max_rpm: p.max_rpm, speed_factor: p.speed_factor, voices: { default: p.voices.default, female: p.voices.female, male: p.voices.male } }];
      }),
    ),
  };
}
