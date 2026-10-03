/**
 * The ONE way the web app writes pinyin for Chinese text by itself (editors'
 * 拼音 auto-fill, Paste a list, word chips, the call board): pinyin-pro, then
 * the card standard's 一 / 不 tone changes (shared/pinyin/toneChange.ts) — no
 * other tone sandhi. Lab app: `ToneChange.autoPinyin` over its pinyin-pro port.
 */
import { pinyin } from 'pinyin-pro';
import { applyYiBuToneChanges } from '@shared/pinyin/toneChange';

type Options = { nonZh?: 'spaced' | 'consecutive' | 'removed' };

export function autoPinyin(text: string, options: Options = {}): string {
  if (!text) return '';
  const raw = pinyin(text, { toneType: 'symbol', type: 'string', ...(options.nonZh ? { nonZh: options.nonZh } : {}) });
  return applyYiBuToneChanges(text, raw);
}
