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
