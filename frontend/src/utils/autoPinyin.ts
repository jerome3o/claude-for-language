/**
 * The ONE way the web app writes pinyin for Chinese text by itself (editors'
 * 拼音 auto-fill, Paste a list, word chips, the call board): pinyin-pro, then
 * the card standard's 一 / 不 tone changes (shared/pinyin/toneChange.ts) — no
 * other tone sandhi. Lab app: `ToneChange.autoPinyin` over its pinyin-pro port.
 */
import { pinyin, polyphonic } from 'pinyin-pro';
import { applyYiBuToneChanges } from '@shared/pinyin/toneChange';
import type { DevicePinyin } from '@shared/pinyin/wordSyllables';

type Options = { nonZh?: 'spaced' | 'consecutive' | 'removed' };

export function autoPinyin(text: string, options: Options = {}): string {
  if (!text) return '';
  const raw = pinyin(text, { toneType: 'symbol', type: 'string', ...(options.nonZh ? { nonZh: options.nonZh } : {}) });
  return applyYiBuToneChanges(text, raw);
}

/** "shì “ qǐng … ”， bú" → "shì “qǐng …”，bú": no spaces inside quotes or before punctuation. */
export function tidyPinyin(s: string): string {
  return s
    .replace(/\s+([，。！？、：；”’）」』,.!?;:)])/g, '$1')
    .replace(/([“‘（「『(])\s+/g, '$1')
    .replace(/([，。！？、：；])\s*/g, '$1 ')
    .trim();
}

/** Pinyin of a whole sentence, made on the device (chat messages, a card sentence written without any). */
export function devicePinyinLine(text: string): string {
  try {
    return tidyPinyin(autoPinyin(text, { nonZh: 'consecutive' }));
  } catch {
    return '';
  }
}

/** Every reading pinyin-pro knows for one character (`polyphonic`; Lab `Pinyin.readings`, parity-tested). */
export function deviceReadings(ch: string): string[] {
  try {
    return (polyphonic(ch)[0] ?? '').split(' ').filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

/**
 * What this device knows about how characters are read, for checking a word's pinyin
 * (shared/pinyin/wordSyllables.ts): pinyin-pro's readings plus the character dictionary's when its
 * records are on the device, and the app's auto-pinyin as the device's own reading.
 */
export function devicePinyin(charRecords: ReadonlyArray<{ char: string; readings: ReadonlyArray<{ pinyin: string }> }> = []): DevicePinyin {
  const extra = new Map(charRecords.map((r) => [r.char, r.readings.map((x) => x.pinyin)]));
  return {
    readings: (ch) => [...deviceReadings(ch), ...(extra.get(ch) ?? [])],
    auto: (text) => autoPinyin(text),
  };
}
