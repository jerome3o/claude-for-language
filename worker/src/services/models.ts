/**
 * The current Opus model and the request shape it needs ("Calling Claude reliably" in
 * CLAUDE.md). Opus 5.5 always thinks (thinking can't be disabled: `{ type: 'disabled' }`
 * is a 400), thinking tokens count against `max_tokens`, forced `tool_choice`
 * (`any` / `tool`) is a 400 and so is `temperature`. Depth is set with
 * `output_config.effort` — its default is `medium`, so every call says which it wants.
 */
export const OPUS_MODEL = 'claude-opus-5-5';

export type ModelEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * `params` plus the effort, for the SDK version in this repo (it doesn't type
 * `output_config` yet). Use `tool_choice: auto` (or none) with Opus 5.5.
 */
export function withEffort<T extends object>(params: T, effort: ModelEffort): T {
  return { ...params, output_config: { effort } } as T;
}

/**
 * The model for chat replies (Ask Claude, Coach follow-ups, Discuss with Claude): fast first
 * words, run with `thinking: { type: 'disabled' }` (it would think by default, and thinking
 * tokens count against `max_tokens`). Tools work with `tool_choice` auto.
 */
export const SONNET_MODEL = 'claude-sonnet-5';

export type ModelTier = 'opus' | 'sonnet' | 'haiku' | 'other';

/** A model id as a tier (analytics carry the tier, never the id). */
export function modelTier(model: string): ModelTier {
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return 'other';
}
