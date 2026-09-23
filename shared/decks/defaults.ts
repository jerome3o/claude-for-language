/**
 * Deck settings: the one place that says what a NEW deck looks like.
 *
 * Every path that creates a deck — the app's "+ Add a deck", Generate with
 * Claude, JSON import, the starter deck, a tutor's copy landing in a student's
 * account (share / invite / "Send homework"), the MCP tools — goes through the
 * worker's content service, which fills the row from these values. The D1
 * column DEFAULTs are legacy and no longer decide anything.
 *
 * Existing decks keep whatever they have; change them in Deck → Settings.
 */

export interface DeckSettings {
  /** Brand-new words per day (blue). */
  new_cards_per_day: number;
  /** Extra NEW cards per day for words that already have a reviewed card (purple). */
  secondary_cards_per_day: number;
  /** FSRS target retention, 0.7–0.97. */
  request_retention: number;
  /** Longest review interval FSRS may schedule, in days. */
  maximum_interval: number;
  // Legacy SM-2 settings, kept so older clients and exports keep working.
  learning_steps: string;
  graduating_interval: number;
  easy_interval: number;
  relearning_steps: string;
  starting_ease: number;
  minimum_ease: number;
  maximum_ease: number;
  interval_modifier: number;
  hard_multiplier: number;
  easy_bonus: number;
}

/** Settings a freshly created deck gets. Jerome's preference: 3 new words and 6 purple cards a day. */
export const DEFAULT_DECK_SETTINGS: Readonly<DeckSettings> = Object.freeze({
  new_cards_per_day: 3,
  secondary_cards_per_day: 6,
  request_retention: 0.9,
  maximum_interval: 36500,
  learning_steps: '1 10',
  graduating_interval: 1,
  easy_interval: 4,
  relearning_steps: '10',
  starting_ease: 250,
  minimum_ease: 130,
  maximum_ease: 300,
  interval_modifier: 100,
  hard_multiplier: 120,
  easy_bonus: 130,
});

export const DECK_SETTING_KEYS = Object.keys(DEFAULT_DECK_SETTINGS) as Array<keyof DeckSettings>;

/** Allowed ranges for the numeric settings (inclusive). */
const NUMERIC_RANGES: Record<Exclude<keyof DeckSettings, 'learning_steps' | 'relearning_steps'>, [number, number]> = {
  new_cards_per_day: [0, 1000],
  secondary_cards_per_day: [0, 1000],
  request_retention: [0.7, 0.97],
  maximum_interval: [1, 36500],
  graduating_interval: [1, 365],
  easy_interval: [1, 365],
  starting_ease: [130, 500],
  minimum_ease: [100, 300],
  maximum_ease: [130, 500],
  interval_modifier: [10, 500],
  hard_multiplier: [100, 200],
  easy_bonus: [100, 300],
};

const STEPS_PATTERN = /^\d+(\.\d+)?(\s+\d+(\.\d+)?)*$/;

export interface DeckSettingsProblem {
  field: keyof DeckSettings;
  message: string;
}

/**
 * Pull the deck settings out of an untrusted object (a request body, a tool
 * input). Unknown keys are ignored; a key that is present but invalid is
 * reported. `undefined` values are skipped so callers can pass a form as-is.
 */
export function pickDeckSettings(input: Record<string, unknown> | null | undefined): {
  settings: Partial<DeckSettings>;
  problems: DeckSettingsProblem[];
} {
  const settings: Partial<DeckSettings> = {};
  const problems: DeckSettingsProblem[] = [];
  if (!input || typeof input !== 'object') return { settings, problems };

  for (const key of DECK_SETTING_KEYS) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (key === 'learning_steps' || key === 'relearning_steps') {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!STEPS_PATTERN.test(text)) {
        problems.push({ field: key, message: `${key} must be space-separated minutes, e.g. "1 10"` });
      } else {
        settings[key] = text;
      }
      continue;
    }
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    const [min, max] = NUMERIC_RANGES[key];
    if (!Number.isFinite(n) || n < min || n > max) {
      problems.push({ field: key, message: `${key} must be a number between ${min} and ${max}` });
      continue;
    }
    settings[key] = key === 'request_retention' ? n : Math.round(n);
  }
  return { settings, problems };
}

/** The full settings row for a new deck: the defaults, with any explicit overrides applied. */
export function newDeckSettings(overrides: Partial<DeckSettings> = {}): DeckSettings {
  const settings: DeckSettings = { ...DEFAULT_DECK_SETTINGS };
  for (const key of DECK_SETTING_KEYS) {
    const value = overrides[key];
    if (value !== undefined && value !== null) (settings as unknown as Record<string, unknown>)[key] = value;
  }
  return settings;
}
