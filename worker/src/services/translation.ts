import { analyzeSentence } from './sentence';
import type { SentenceBreakdown } from '../types';

/**
 * Translate and segment a Chinese message for interactive translation feature
 * Reuses the existing sentence analysis infrastructure
 */
export async function translateAndSegment(
  apiKey: string,
  content: string
): Promise<{ translation: string; segmentation: SentenceBreakdown }> {
  const breakdown = await analyzeSentence(apiKey, content);

  return {
    translation: breakdown.english,
    segmentation: breakdown
  };
}
