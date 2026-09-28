/**
 * Package J golden vectors: how a call fits its video (shared/calls/videoFit.ts).
 * Writes calls-video.json; checked by core/…/calls/CallsVideoParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { aspectMismatch, chooseVideoFit, containRect, coverRect, pipSize, type VideoSize } from '../../../shared/calls/videoFit';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20260928);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const common: VideoSize[] = [
  { width: 720, height: 1280 }, { width: 1280, height: 720 }, { width: 640, height: 480 }, { width: 480, height: 640 },
  { width: 1920, height: 1080 }, { width: 2560, height: 1600 }, { width: 1080, height: 2400 }, { width: 115, height: 100 },
  { width: 100, height: 115 }, { width: 116, height: 100 }, { width: 100, height: 100 }, { width: 0, height: 0 }, { width: 640, height: 0 },
];
const boxes: VideoSize[] = [
  { width: 1400, height: 760 }, { width: 396, height: 700 }, { width: 100, height: 100 }, { width: 800, height: 600 },
  { width: 1904, height: 820 }, { width: 560, height: 760 }, { width: 96, height: 128 }, { width: 0, height: 300 }, { width: 200, height: 150 },
  { width: 4000, height: 3000 }, { width: 380.5, height: 474.25 },
];
const randSize = (): VideoSize => ({ width: Math.round(r() * 2000) / pick([1, 1, 4]), height: Math.round(r() * 2000) / pick([1, 1, 4]) });

const cases: unknown[] = [];
const push = (video: VideoSize | null, box: VideoSize, screen: boolean, tolerance?: number) => {
  cases.push({
    video, box, screen, tolerance: tolerance ?? null,
    fit: chooseVideoFit(video, box, { screen, tolerance }),
    mismatch: video && video.width > 0 && video.height > 0 && box.width > 0 && box.height > 0 ? aspectMismatch(video, box) : null,
    contain: containRect(video, box),
    cover: coverRect(video, box),
    pip: pipSize(video, box),
  });
};
for (const v of [...common, null]) for (const b of boxes) push(v, b, false);
for (const b of boxes) push(common[1], b, true);
for (let i = 0; i < 400; i++) push(r() < 0.05 ? null : randSize(), randSize(), r() < 0.1, r() < 0.2 ? pick([0, 0.05, 0.3, 0.5]) : undefined);

writeFileSync(join(OUT, 'calls-video.json'), JSON.stringify({ cases }));
