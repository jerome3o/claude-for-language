/**
 * The E2E_TEST_MODE stand-in of the "check my Chinese" a card thread runs on my question (CLAUDE.md
 * "E2E is hermetic": checked first, whatever key is set). Deterministic: a question with 什么意 not
 * followed by 思 is improvable (→ 什么意思), anything else is fine. Same raw shape as the model's tool
 * input, so `normalizeAutoCheck` shapes it like a real check.
 */
import type { AutoChecker } from '../chat/auto-check';

export const fakeAskChecker: AutoChecker = async (text) => {
  if (/什么意(?!思)/.test(text)) {
    const corrected = text.replace(/什么意(?!思)/g, '什么意思');
    return {
      status: 'improvable',
      corrected: { hanzi: corrected, pinyin: '', english: '(E2E) the corrected question' },
      mistakes: [{ quote: '什么意', fix: '什么意思', why: 'The word is 意思.' }],
      severity: 'moderate',
    };
  }
  return { status: 'ok', corrected: { hanzi: text, pinyin: '', english: '' } };
};
