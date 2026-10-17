import { describe, expect, it } from 'vitest';
import { estimateCost, geminiImageOutputTokens, imageOutputPriceFor, parseAiUsage } from '../analytics/ai-usage';

const url = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

describe('Gemini image pricing', () => {
  it('prices a 2.5 Flash Image picture at the image rate (~$0.039), not the text rate', () => {
    const usage = parseAiUsage('gemini', url('gemini-2.5-flash-image'), {
      modelVersion: 'gemini-2.5-flash-image',
      usageMetadata: {
        promptTokenCount: 300,
        candidatesTokenCount: 1300,
        candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }, { modality: 'TEXT', tokenCount: 10 }],
      },
    }, 200)!;
    expect(usage.output_tokens).toBe(1300);
    // 300 × $0.30 + 10 × $2.50 + 1290 × $30 (per million)
    expect(usage.cost_usd).toBeCloseTo((300 * 0.3 + 10 * 2.5 + 1290 * 30) / 1e6, 8);
    expect(usage.cost_usd).toBeGreaterThan(0.038);
    expect(usage.cost_usd).toBeLessThan(0.04);
  });

  it('prices 3.1 Flash Image (preview name too) at $60 / M image tokens', () => {
    expect(imageOutputPriceFor('gemini-3.1-flash-image-preview')).toBe(60);
    const usage = parseAiUsage('gemini', url('gemini-3.1-flash-image'), {
      usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 1120, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] },
    }, 200)!;
    expect(usage.model).toBe('gemini-3.1-flash-image');
    expect(usage.cost_usd).toBeCloseTo(0.0672, 6);
  });

  it('counts every candidate token as image when an image model gives no breakdown', () => {
    expect(geminiImageOutputTokens('gemini-2.5-flash-image', { candidatesTokenCount: 1290 })).toBe(1290);
    expect(estimateCost('gemini-2.5-flash-image', 0, 1290, 0, 1290)).toBeCloseTo(0.0387, 6);
  });

  it('leaves text models alone', () => {
    expect(imageOutputPriceFor('gemini-3.5-flash')).toBeNull();
    expect(geminiImageOutputTokens('gemini-3.5-flash', { candidatesTokenCount: 500, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 500 }] })).toBe(0);
    // image tokens passed for a text model are priced as text
    expect(estimateCost('gemini-3.5-flash', 0, 1_000_000, 0, 1_000_000)).toBe(2.5);
    expect(estimateCost('gemini-3.6-flash', 1_000_000, 1_000_000)).toBe(4.5);
    expect(estimateCost('claude-opus-5-5', 1_000_000, 1_000_000)).toBe(24);
  });
});
