#!/usr/bin/env node
/**
 * The soft music bed under audio lessons (docs/AUDIO_LESSONS.md "Music"; shared/audio-lesson/music.ts).
 *
 * Procedural — no samples, no third-party audio: four slow pad chords (Dmaj9 → Bm7 → Gmaj7 → Asus2),
 * each a few soft sine partials with a slightly detuned twin for a slow chorus, crossfading over
 * 8 s, under a very slow swell. The loop is rendered CIRCULARLY (a chord that crosses the end
 * wraps to the start), so it is exactly periodic, and it breathes out to near silence at its seam —
 * a player's loop restart (or an MP3 encoder's padding) falls in that breath and is never heard.
 * Written for this app and dedicated to the public domain (CC0 1.0).
 *
 * Deterministic: the same script always writes the same samples. Encoding needs ffmpeg with
 * libmp3lame (FFMPEG=/path/to/ffmpeg, else `ffmpeg` on PATH):
 *
 *   node scripts/audio/generate-lesson-music.mjs
 *
 * writes frontend/public/audio/lesson-music-v1.mp3 and the Lab app's copy,
 * android-lab/app/src/main/res/raw/lesson_music.mp3 (24 kHz mono, 40 kbps, ~480 KB).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB_OUT = join(ROOT, 'frontend/public/audio/lesson-music-v1.mp3');
const LAB_OUT = join(ROOT, 'android-lab/app/src/main/res/raw/lesson_music.mp3');

const RATE = 24000;
const CHORD_S = 24;
const CHORDS = [
  // Dmaj9: D2 A2 | D3 F#3 A3 E4
  [73.42, 110.0, 146.83, 185.0, 220.0, 329.63],
  // Bm7: B1 F#2 | B2 D3 F#3 A3
  [61.74, 92.5, 123.47, 146.83, 185.0, 220.0],
  // Gmaj7: G1 D2 | G2 B2 D3 F#3
  [49.0, 73.42, 98.0, 123.47, 146.83, 185.0],
  // Asus2: A1 E2 | A2 B2 E3 A3
  [55.0, 82.41, 110.0, 123.47, 164.81, 220.0],
];
const LOOP_S = CHORD_S * CHORDS.length; // 96 s
const N = LOOP_S * RATE;
const FADE_S = 8; // chord crossfade
/** Partials of one pad voice: soft, mostly the fundamental (warm, nothing bright). */
const PARTIALS = [
  [1, 1],
  [2, 0.28],
  [3, 0.08],
  [4, 0.03],
];
/** Each note's twin, a little sharp: a slow beat, like a chorus. */
const DETUNE = 1.0021;

const buf = new Float64Array(N);
const TWO_PI = Math.PI * 2;

/** 0 → 1 → 0 over a chord's window: raised-cosine fades at both ends. */
function chordEnvelope(tau, length) {
  if (tau < 0 || tau > length) return 0;
  if (tau < FADE_S) return 0.5 - 0.5 * Math.cos((Math.PI * tau) / FADE_S);
  if (tau > length - FADE_S) return 0.5 - 0.5 * Math.cos((Math.PI * (length - tau)) / FADE_S);
  return 1;
}

CHORDS.forEach((notes, k) => {
  const start = k * CHORD_S - FADE_S / 2;
  const length = CHORD_S + FADE_S;
  const samples = Math.round(length * RATE);
  const startSample = Math.round(start * RATE);
  notes.forEach((f, n) => {
    // Lower notes a little quieter (they carry more energy), higher ones softer still.
    const level = n < 2 ? 0.55 : 0.42 / (1 + n * 0.12);
    const phase = (k * 7 + n * 3) * 0.37; // fixed, so the render is deterministic
    for (let i = 0; i < samples; i++) {
      const tau = i / RATE;
      const env = chordEnvelope(tau, length);
      if (env === 0) continue;
      let v = 0;
      for (const [h, a] of PARTIALS) {
        const fh = f * h;
        if (fh > 1800) continue;
        v += a * (Math.sin(TWO_PI * fh * tau + phase * h) + 0.8 * Math.sin(TWO_PI * fh * DETUNE * tau + phase * h * 1.7));
      }
      const idx = (((startSample + i) % N) + N) % N;
      buf[idx] += level * env * v;
    }
  });
});

// A very slow swell (period = the loop / 7, so the loop stays periodic) and the breath at the seam.
for (let i = 0; i < N; i++) {
  const t = i / RATE;
  const swell = 0.88 + 0.12 * Math.sin((TWO_PI * 7 * t) / LOOP_S);
  const d = Math.min(t, LOOP_S - t); // seconds from the seam (circular)
  const breath = 1 - 0.985 * Math.exp(-((d / 1.8) ** 2));
  buf[i] *= swell * breath;
}

// Normalise: peak −12 dBFS — the players add their own (low) volume on top.
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const gain = 0.25 / peak;
const pcm = Buffer.alloc(N * 2);
for (let i = 0; i < N; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(buf[i] * gain * 32767))), i * 2);

function wav(data) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const dir = mkdtempSync(join(tmpdir(), 'lesson-music-'));
try {
  const wavPath = join(dir, 'music.wav');
  writeFileSync(wavPath, wav(pcm));
  mkdirSync(dirname(WEB_OUT), { recursive: true });
  const ffmpeg = process.env.FFMPEG || 'ffmpeg';
  execFileSync(
    ffmpeg,
    ['-y', '-loglevel', 'error', '-i', wavPath, '-ac', '1', '-ar', String(RATE), '-codec:a', 'libmp3lame', '-b:a', '40k', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', WEB_OUT],
    { stdio: 'inherit' },
  );
  mkdirSync(dirname(LAB_OUT), { recursive: true });
  copyFileSync(WEB_OUT, LAB_OUT);
  console.log(`wrote ${WEB_OUT} and ${LAB_OUT} (${LOOP_S} s loop)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
