import { describe, expect, it } from 'vitest';
import {
  buildNoteImagePrompt,
  estimateIllustrateCost,
  illustrateProgressLabel,
  isSentenceNote,
  noteImageSides,
  noteImageState,
  NOTE_IMAGE_COST_USD,
  showNoteImage,
} from './note-image';

describe('where the picture shows', () => {
  it('goes with the English on the question of meaning → hanzi, on the answer side of the others', () => {
    expect(noteImageSides('meaning_to_hanzi')).toEqual({ front: true, back: true });
    expect(noteImageSides('hanzi_to_meaning')).toEqual({ front: false, back: true });
    expect(noteImageSides('audio_to_hanzi')).toEqual({ front: false, back: true });
  });

  it('never gives away the meaning on a card that tests it', () => {
    expect(showNoteImage('hanzi_to_meaning', 'front', true, 'k')).toBe(false);
    expect(showNoteImage('audio_to_hanzi', 'front', true, 'k')).toBe(false);
    expect(showNoteImage('meaning_to_hanzi', 'front', true, 'k')).toBe(true);
    expect(showNoteImage('hanzi_to_meaning', 'back', true, 'k')).toBe(true);
  });

  it('respects the setting and needs a picture', () => {
    expect(showNoteImage('meaning_to_hanzi', 'front', false, 'k')).toBe(false);
    expect(showNoteImage('meaning_to_hanzi', 'back', true, null)).toBe(false);
  });
});

describe('the prompt', () => {
  it('depicts the meaning, never the Chinese, and forbids writing', () => {
    const p = buildNoteImagePrompt({ hanzi: '银行', english: 'bank', sentence_clue_translation: 'I go to the bank to get money.' });
    expect(p).toContain('"bank"');
    expect(p).toContain('I go to the bank to get money.');
    expect(p).not.toContain('银行');
    expect(p).toMatch(/no Chinese characters/);
  });

  it('describes a scene for a sentence, and Regenerate changes the prompt', () => {
    const s = buildNoteImagePrompt({ hanzi: '我们去公园散步吧。', english: "Let's go for a walk in the park." });
    expect(s).toContain('Illustrate this scene');
    expect(buildNoteImagePrompt({ hanzi: '猫', english: 'cat' }, 3)).not.toBe(buildNoteImagePrompt({ hanzi: '猫', english: 'cat' }));
  });

  it('tells sentences from words', () => {
    expect(isSentenceNote('苹果')).toBe(false);
    expect(isSentenceNote('你好吗？')).toBe(true);
    expect(isSentenceNote('我今天想去图书馆看书')).toBe(true);
  });
});

describe('estimate and labels', () => {
  it('costs NOTE_IMAGE_COST_USD a picture', () => {
    expect(estimateIllustrateCost(24)).toEqual({ pictures: 24, usd: 24 * NOTE_IMAGE_COST_USD, label: `24 pictures · about $${(24 * NOTE_IMAGE_COST_USD).toFixed(2)}` });
    expect(estimateIllustrateCost(1).label).toMatch(/^1 picture · about \$/);
    expect(estimateIllustrateCost(0).label).toBe('Every card already has a picture');
  });

  it('says how far the deck is', () => {
    expect(illustrateProgressLabel({ total: 24, with_image: 18, pending: 6, failed: 0 })).toBe('18 of 24 cards have a picture · 6 being drawn');
    expect(illustrateProgressLabel({ total: 3, with_image: 1, pending: 0, failed: 2 })).toBe('1 of 3 cards has a picture · 2 couldn’t be drawn');
  });

  it('reads the state of a note', () => {
    expect(noteImageState({})).toBe('none');
    expect(noteImageState({ image_key: 'k' })).toBe('ready');
    expect(noteImageState({ image_key: 'k', image_status: 'pending' })).toBe('pending');
    expect(noteImageState({ image_status: 'failed' })).toBe('failed');
  });
});
