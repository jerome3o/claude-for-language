import { describe, expect, it } from 'vitest';
import { buildAskSystemPrompt, knownWordsBlock, ASK_KNOWN_WORDS_MAX } from '../ask-prompt';
import { CARD_STANDARD } from '@shared/cards/standard';

describe('Ask Claude system prompt', () => {
  it('Chinese mode: answer entirely in simple graded Chinese, plain text, the known words, tools + card standard', () => {
    const p = buildAskSystemPrompt({ language: 'zh', knownWords: ['银行', '学生', '银行', ' ', '吃饭'] });
    expect(p).toContain('answer ENTIRELY in simple Chinese');
    expect(p).toContain('HSK 3–4');
    expect(p).toContain('Plain text only: no Markdown');
    expect(p).toContain('银行、学生、吃饭');
    expect(p).toContain('edit_current_card');
    expect(p).toContain('bump_cards');
    expect(p).toContain(CARD_STANDARD);
    // An explicit request for English is still honoured; the English-mode advice is not there.
    expect(p).toContain('explicitly asks for English');
    expect(p).not.toContain('Use examples with both Chinese characters and pinyin');
  });

  it('English mode: the original English explanations (Markdown, pinyin with the examples), no immersion rules', () => {
    const p = buildAskSystemPrompt({ language: 'en', knownWords: ['熊猫'] });
    expect(p).toContain('Use examples with both Chinese characters and pinyin');
    expect(p).toContain('briefly confirm what you did');
    expect(p).not.toContain('ENTIRELY in simple Chinese');
    expect(p).not.toContain('熊猫');
    expect(p).toContain(CARD_STANDARD);
  });

  it('Chinese mode without known words has no words block', () => {
    expect(buildAskSystemPrompt({ language: 'zh' })).not.toContain('Words the learner already knows');
  });

  it('known words: unique, trimmed, capped', () => {
    expect(knownWordsBlock([])).toBe('');
    expect(knownWordsBlock(['', '  '])).toBe('');
    const many = Array.from({ length: 400 }, (_, i) => `词${i}`);
    const block = knownWordsBlock(many);
    expect(block.split('\n')[1].split('、')).toHaveLength(ASK_KNOWN_WORDS_MAX);
  });
});
