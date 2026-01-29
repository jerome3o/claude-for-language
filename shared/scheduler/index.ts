/**
 * Shared Scheduler Module - FSRS Implementation
 *
 * Event-sourced card state computation using the FSRS (Free Spaced Repetition
 * Scheduler) algorithm. Used by both frontend (offline) and worker (server).
 *
 * FSRS is a modern algorithm based on the DSR memory model that requires
 * 20-30% fewer reviews than SM-2 for the same retention level.
 */

export {
  // Types
  type Rating,
  CardQueue,
  type ReviewEvent,
  type DeckSettings,
  type ComputedCardState,
  type CardCheckpoint,
  type IntervalPreview,

  // Constants
  DEFAULT_DECK_SETTINGS,

  // Core functions
  initialCardState,
  applyReview,
  computeCardState,
  createCheckpoint,
  isCheckpointStale,

  // FSRS-specific functions
  getIntervalPreviews,
  getRetrievability,

  // Utility functions
  formatInterval,

  // Legacy compatibility (deprecated)
  parseLearningSteps,
  deckSettingsFromDb,
} from './compute-state';
