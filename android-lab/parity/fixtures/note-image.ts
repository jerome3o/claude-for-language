/**
 * Pictures on cards golden vectors (shared/cards/note-image.ts): where a picture shows per card
 * type / side / setting, the "Illustrate this deck" estimate and progress labels, a note's state.
 * Writes note-image.json; core NoteImageParityTest asserts cards/NoteImage.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  estimateIllustrateCost,
  illustrateProgressLabel,
  noteImageSides,
  noteImageState,
  showNoteImage,
} from '../../../shared/cards/note-image';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: note-image <out-dir>');
mkdirSync(OUT, { recursive: true });

const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi', 'unknown'];
const show: unknown[] = [];
for (const t of TYPES) for (const side of ['front', 'back'] as const) for (const enabled of [true, false]) for (const key of [null, '', 'note-images/a.png']) {
  show.push({ cardType: t, side, enabled, key, show: showNoteImage(t, side, enabled, key) });
}
const sides = TYPES.map(t => ({ cardType: t, ...noteImageSides(t) }));
const estimates = [0, 1, 2, 3.7, 24, 100, 499, 500, 501, 10_000, -3].map(n => ({ n, ...estimateIllustrateCost(n) }));
const labels: unknown[] = [];
for (const total of [0, 1, 3, 24]) for (const withImage of [0, 1, 2, 18]) for (const pending of [0, 1, 6]) for (const failed of [0, 2]) {
  labels.push({ total, withImage, pending, failed, label: illustrateProgressLabel({ total, with_image: withImage, pending, failed }) });
}
const states: unknown[] = [];
for (const key of [null, '', 'k']) for (const status of [null, 'pending', 'failed']) {
  states.push({ key, status, state: noteImageState({ image_key: key, image_status: status }) });
}

writeFileSync(join(OUT, 'note-image.json'), JSON.stringify({ show, sides, estimates, labels, states }));
console.log(`note-image: ${show.length} show cases, ${estimates.length} estimates, ${labels.length} labels`);
