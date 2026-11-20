import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SENTENCE_STYLE,
  SENTENCE_STYLES,
  SENTENCE_STYLE_COPY,
  isSentenceStyle,
  pickSentenceStyleUpdate,
  sentenceStyleOf,
  sentenceStylePrompt,
} from './sentenceStyle';

describe('sentence style', () => {
  it('defaults to everyday', () => {
    expect(DEFAULT_SENTENCE_STYLE).toBe('everyday');
    expect(sentenceStyleOf(null)).toBe('everyday');
    expect(sentenceStyleOf(undefined)).toBe('everyday');
    expect(sentenceStyleOf('formal')).toBe('everyday');
    expect(sentenceStyleOf('casual')).toBe('casual');
    expect(sentenceStyleOf('standard')).toBe('standard');
  });

  it('knows its three choices, each with words', () => {
    expect(SENTENCE_STYLES).toEqual(['standard', 'everyday', 'casual']);
    for (const s of SENTENCE_STYLES) {
      expect(isSentenceStyle(s)).toBe(true);
      expect(SENTENCE_STYLE_COPY[s].label.length).toBeGreaterThan(0);
      expect(SENTENCE_STYLE_COPY[s].description.length).toBeGreaterThan(0);
    }
    expect(isSentenceStyle('Casual')).toBe(false);
    expect(isSentenceStyle(1)).toBe(false);
  });

  it('validates an update', () => {
    expect(pickSentenceStyleUpdate({ sentence_style: 'casual' })).toEqual({ value: 'casual', problems: [] });
    expect(pickSentenceStyleUpdate({ sentence_style: null })).toEqual({ value: null, problems: [] });
    expect(pickSentenceStyleUpdate({}).problems).toHaveLength(1);
    expect(pickSentenceStyleUpdate(null).problems).toHaveLength(1);
    expect(pickSentenceStyleUpdate({ sentence_style: 'slang' }).problems[0]).toMatch(/standard, everyday or casual/);
  });

  it('gives each style its own instruction', () => {
    const standard = sentenceStylePrompt('standard');
    const everyday = sentenceStylePrompt('everyday');
    const casual = sentenceStylePrompt('casual');
    expect(standard).toMatch(/REGISTER: standard/);
    expect(standard).toMatch(/No slang/);
    // Everyday: a gentle nudge — occasionally, never forced.
    expect(everyday).toMatch(/REGISTER: everyday spoken Chinese/);
    expect(everyday).toMatch(/occasionally use one/);
    expect(everyday).toMatch(/Never force one in/);
    expect(everyday).toMatch(/regional dialect/);
    // Casual: most sentences.
    expect(casual).toMatch(/REGISTER: casual/);
    expect(casual).toMatch(/Most sentences/);
    expect(casual).toMatch(/nothing vulgar/);
    expect(new Set([standard, everyday, casual]).size).toBe(3);
  });
});
