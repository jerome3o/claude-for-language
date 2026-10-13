/**
 * E2E_TEST_MODE only: a stand-in for Claude in "Generate with Claude" (POST /api/ai/generate-deck),
 * like the other E2E fakes (card-check-fake.ts, idioms-fake.ts). The onboarding spec checks the
 * flow — prompt → "Deck Generated!" → the deck on Home — not Claude's vocabulary, and a real call
 * made it slow, paid and dependent on the API being up.
 */
import type { GeneratedDeck } from '../types';

export function fakeGeneratedDeck(prompt: string, deckName?: string): GeneratedDeck {
  return {
    deck_name: deckName?.trim() || `E2E: ${prompt.trim().slice(0, 40)}`,
    deck_description: `(E2E) Generated for: ${prompt.trim().slice(0, 80)}`,
    notes: [
      { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello', fun_facts: '你 (nǐ) you + 好 (hǎo) good: "you good" is the everyday greeting.' },
      { hanzi: '谢谢', pinyin: 'xièxie', english: 'thank you', fun_facts: '谢 (xiè) thank, said twice; the second is neutral tone.' },
      { hanzi: '再见', pinyin: 'zàijiàn', english: 'goodbye', fun_facts: '再 (zài) again + 见 (jiàn) see: "see you again".' },
    ],
  };
}
