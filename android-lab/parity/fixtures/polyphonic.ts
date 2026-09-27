/**
 * Package K: pinyin-pro's `polyphonic` for one character — Paste a list's "Check the reading:
 * a / b" hint (frontend/src/components/import/PasteWordsModal.tsx). Every BMP CJK character
 * (Ext A + URO + compatibility) plus a few non-Han inputs. Writes polyphonic.json into
 * process.argv[2]; core PolyphonicParityTest asserts Pinyin.readings matches exactly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { polyphonic } from 'pinyin-pro';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: polyphonic <out-dir>');
mkdirSync(OUT, { recursive: true });

const chars: string[] = [];
for (const [lo, hi] of [[0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xf900, 0xfaff]]) {
  for (let c = lo; c <= hi; c++) chars.push(String.fromCharCode(c));
}
chars.push('〇', 'a', '1', '。', ' ', '々');
// Only characters whose answer isn't the character itself are listed; the rest must echo.
const readings: Record<string, string> = {};
const echo: string[] = [];
for (const ch of chars) {
  const r = polyphonic(ch)[0] ?? '';
  if (r === ch) echo.push(ch);
  else readings[ch] = r;
}
writeFileSync(join(OUT, 'polyphonic.json'), JSON.stringify({ readings, echo: echo.join('') }));
