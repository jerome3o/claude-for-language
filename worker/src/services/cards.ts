import { CardType, Card, CardQueue } from '../types';

/**
 * Generate a unique ID using crypto
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Card types that should be generated for each note
 */
export const CARD_TYPES: CardType[] = [
  'hanzi_to_meaning',
  'meaning_to_hanzi',
  'audio_to_hanzi',
];

/**
 * Create card records for a note
 */
export function createCardsForNote(noteId: string): Omit<Card, 'created_at' | 'updated_at'>[] {
  return CARD_TYPES.map((cardType) => ({
    id: generateId(),
    note_id: noteId,
    card_type: cardType,
    // FSRS fields (defaults for new cards)
    stability: 0,
    difficulty: 0,  // Will be set on first review
    lapses: 0,
    // Legacy fields (for backward compatibility)
    ease_factor: 2.5,
    interval: 0,
    repetitions: 0,
    next_review_at: null,
    queue: CardQueue.NEW,
    learning_step: 0,
    due_timestamp: null,
  }));
}

/**
 * Get display information for a card type
 */
export function getCardTypeInfo(cardType: CardType): {
  prompt: string;
  action: string;
  reveals: string[];
} {
  switch (cardType) {
    case 'hanzi_to_meaning':
      return {
        prompt: 'See the Chinese characters and say the word aloud',
        action: 'speak',
        reveals: ['audio', 'pinyin', 'english'],
      };
    case 'meaning_to_hanzi':
      return {
        prompt: 'See the English meaning and type the Chinese characters',
        action: 'type',
        reveals: ['audio', 'pinyin', 'hanzi'],
      };
    case 'audio_to_hanzi':
      return {
        prompt: 'Listen to the audio and type the Chinese characters',
        action: 'type',
        reveals: ['pinyin', 'hanzi', 'english'],
      };
  }
}

/**
 * Check if a typed answer is correct
 * Handles common variations (simplified vs traditional, etc.)
 */
export function checkAnswer(userAnswer: string, correctHanzi: string): boolean {
  // Normalize both strings
  const normalize = (s: string) => s.trim().toLowerCase();
  return normalize(userAnswer) === normalize(correctHanzi);
}
