/**
 * The numbers of a composed audio lesson (composed.ts) without its compiler — what the block doc
 * (composed-doc.ts) and the MCP server read, so neither pulls in the pinyin tooling.
 */

export const COMPOSED_SPEC_VERSION = 1;

/** Named speeds on the app's scale (MiniMax's: 1 = normal, cards 0.6). A number 0.5–1.2 works too. */
export const COMPOSED_RATES = {
  /** The slowest each voice still sounds natural at (the sleep lessons' rate). */
  sleep: 0.5,
  /** A new word on its own. */
  slow: 0.6,
  /** A line on its own (dialogue lessons' line by line). */
  normal: 0.7,
  /** Close to natural speech. */
  natural: 0.85,
} as const;
export type ComposedRateName = keyof typeof COMPOSED_RATES;
export type ComposedRate = ComposedRateName | number;

/** Chinese voices a block may use; English voices. */
export const COMPOSED_ZH_VOICES = ['teacher', 'speaker_a', 'speaker_b', 'sleep'] as const;
export const COMPOSED_EN_VOICES = ['narrator', 'recap'] as const;

export const COMPOSED_BLOCK_TYPES = ['chapter', 'zh', 'en', 'pause', 'sequence', 'drill', 'word_focus', 'structure', 'exchange', 'retell', 'recall'] as const;
export const COMPOSED_RESERVED_TYPES = ['clip'] as const;

export const COMPOSED_LIMITS = {
  /** Estimated length of the whole lesson. */
  maxMinutes: 45,
  maxBlocks: 300,
  maxTitleChars: 120,
  /** One Chinese line (one clip). */
  maxZhChars: 120,
  /** One English text (split into clips around its Chinese). */
  maxEnChars: 600,
  maxRepeat: 6,
  maxPatternSteps: 12,
  maxPauseMs: 20_000,
  minRate: 0.5,
  maxRate: 1.2,
  maxExchangeLines: 20,
  maxRetellSentences: 20,
  maxExamples: 4,
  maxMeaningSentences: 6,
  maxMeaningChars: 40,
  /** The plan as JSON (the API refuses a bigger body). */
  maxPlanBytes: 200_000,
} as const;

/** Defaults: the pause after each kind of block, and the macros' timing. */
export const COMPOSED_DEFAULTS = {
  zhGap: 900,
  zhAfter: 1200,
  enAfter: 700,
  drillGap: 900,
  drillEnGap: 1300,
  drillAfter: 1800,
  wordRepeat: 3,
  wordAfter: 2000,
  meaningGap: 1500,
  exchangeSlowPlays: 2,
  exchangeNaturalPlays: 1,
  exchangeLineGap: 900,
  exchangePlayGap: 2000,
  retellRepeat: 2,
  retellSentenceGap: 1500,
  retellRepeatGap: 3000,
  recallThink: 3000,
  recallRepeats: 2,
  recallAfter: 1500,
} as const;

/** The script limits every format shares (validate.ts SCRIPT_LIMITS — the same numbers, tested). */
export const COMPOSED_SCRIPT_LIMITS = { maxUniqueSpeech: 260, maxSegments: 1500, maxChapters: 40 } as const;
