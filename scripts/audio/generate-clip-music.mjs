#!/usr/bin/env node
/**
 * The lo-fi beats under 🎬 Clips (docs/CLIPS.md "Music"; shared/clips/music.ts): chill but a little
 * stimulating — soft kick / snare / swung hats, a round bass, warm electric-piano chords (FM), a
 * quiet pad, a few melody notes in the second half and a little vinyl crackle, through a warm
 * low-pass and a gentle tape-ish saturation, with the chords "pumping" softly under the kick.
 *
 * Procedural — no samples, no third-party audio. Written for this app and dedicated to the public
 * domain (CC0 1.0). Deterministic: the same script always writes the same samples (a seeded PRNG).
 * Every loop is rendered CIRCULARLY (a note or a drum tail that crosses the end wraps to the start,
 * the filters run twice round the loop), so it is exactly periodic.
 *
 * Encoding: ffmpeg with libmp3lame when it is on PATH (FFMPEG=/path/to/ffmpeg), else Python's
 * `lameenc` (PYTHON=/path/to/python with `pip install lameenc`):
 *
 *   node scripts/audio/generate-clip-music.mjs
 *
 * writes frontend/public/audio/clip-beat-<name>-v1.mp3 and the Lab app's copies,
 * android-lab/app/src/main/res/raw/clip_beat_<name>.mp3 (32 kHz mono, 48 kbps, 16 bars each).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RATE = 32000;
const BARS = 16;
const TWO_PI = Math.PI * 2;

const midi = (m) => 440 * 2 ** ((m - 69) / 12);

/** A seeded PRNG (mulberry32) — every "random" choice is fixed. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TRACKS = [
  {
    name: 'cafe',
    bpm: 88,
    swing: 0.14,
    seed: 11,
    // Fmaj7 · Em7 · Dm9 · Cmaj7
    chords: [
      { bass: 41, notes: [57, 60, 64, 65] },
      { bass: 40, notes: [55, 59, 62, 64] },
      { bass: 38, notes: [57, 60, 62, 64, 65] },
      { bass: 36, notes: [55, 59, 60, 64] },
    ],
    melody: [76, 74, 72, 69, 67, 72, 74, 76],
    snare: 0.5,
    keys: 0.24,
  },
  {
    name: 'nightbus',
    bpm: 92,
    swing: 0.1,
    seed: 23,
    // Am9 · Dm7 · G13 · Cmaj9
    chords: [
      { bass: 45, notes: [55, 59, 60, 64] },
      { bass: 38, notes: [53, 57, 60, 62] },
      { bass: 43, notes: [53, 59, 64, 65] },
      { bass: 36, notes: [55, 59, 62, 64] },
    ],
    melody: [72, 76, 79, 76, 74, 72, 69, 71],
    snare: 0.58,
    keys: 0.23,
  },
  {
    name: 'rain',
    bpm: 85,
    swing: 0.16,
    seed: 37,
    // Ebmaj7 · Cm9 · Abmaj7 · Bb7sus4
    chords: [
      { bass: 39, notes: [55, 58, 62, 63] },
      { bass: 36, notes: [55, 58, 62, 63] },
      { bass: 44, notes: [55, 60, 63, 67] },
      { bass: 46, notes: [56, 58, 63, 65] },
    ],
    melody: [70, 67, 65, 63, 67, 70, 72, 70],
    snare: 0.42,
    keys: 0.25,
  },
];

function render(track) {
  const beat = 60 / track.bpm;
  const bar = beat * 4;
  const six = beat / 4; // a 16th
  const loopS = bar * BARS;
  const N = Math.round(loopS * RATE);
  const drums = new Float64Array(N);
  const music = new Float64Array(N); // keys + pad + melody: pumped by the kick
  const bassBuf = new Float64Array(N);
  const rand = rng(track.seed);
  const kickTimes = [];

  /** Add `fn(tau)` for `dur` seconds from `start` (circular). */
  const add = (buf, start, dur, fn) => {
    const s0 = Math.round(start * RATE);
    const n = Math.round(dur * RATE);
    for (let i = 0; i < n; i++) {
      const idx = (((s0 + i) % N) + N) % N;
      buf[idx] += fn(i / RATE);
    }
  };
  /** A 16th step's time in the bar, the off-beat 8ths swung late. */
  const stepTime = (barStart, step) => barStart + step * six + (step % 4 === 2 ? track.swing * beat : 0);

  for (let b = 0; b < BARS; b++) {
    const t0 = b * bar;
    const chord = track.chords[b % track.chords.length];
    const fill = b % 8 === 7;

    // ---- Drums ----
    const kicks = [0, 10, ...(b % 2 === 1 ? [7] : [])];
    for (const st of kicks) {
      const at = stepTime(t0, st) + (rand() - 0.5) * 0.006;
      kickTimes.push(at);
      const vel = st === 0 ? 1 : 0.78;
      let phase = 0;
      let last = 0;
      add(drums, at, 0.5, (tau) => {
        const f = 52 + 90 * Math.exp(-tau * 32);
        phase += TWO_PI * f * (tau - last);
        last = tau;
        const click = tau < 0.006 ? (1 - tau / 0.006) * 0.45 : 0;
        return vel * 0.75 * (Math.sin(phase) * Math.exp(-tau * 11) + click);
      });
    }
    const snares = [4, 12, ...(fill ? [14, 15] : [])];
    for (const st of snares) {
      const at = stepTime(t0, st) + 0.004 + (rand() - 0.5) * 0.008;
      const vel = st >= 14 ? 0.45 : 1;
      let lp = 0;
      let lp2 = 0;
      add(drums, at, 0.35, (tau) => {
        const n = rand() * 2 - 1;
        lp += 0.35 * (n - lp);
        lp2 += 0.08 * (lp - lp2);
        const band = lp - lp2; // a soft band of noise
        const body = Math.sin(TWO_PI * 185 * tau) * Math.exp(-tau * 30) * 0.5;
        return track.snare * vel * (band * 3.2 * Math.exp(-tau * 15) + body);
      });
    }
    for (let st = 0; st < 16; st += 2) {
      const open = st === 14 && b % 4 === 3;
      const at = stepTime(t0, st) + (rand() - 0.5) * 0.01;
      const vel = (st % 4 === 0 ? 0.75 : 1) * (0.75 + rand() * 0.25);
      let lp = 0;
      add(drums, at, open ? 0.3 : 0.08, (tau) => {
        const n = rand() * 2 - 1;
        lp += 0.55 * (n - lp);
        const hp = n - lp; // the bright part only
        return 0.34 * vel * hp * Math.exp(-tau * (open ? 11 : 45));
      });
    }

    // ---- Bass: root on 1 (dotted quarter), the fifth on the "and" of 2, root again on 3.5 ----
    const bassNotes = [
      [0, 6, chord.bass],
      [6, 3, chord.bass + 7],
      [10, 5, chord.bass],
    ];
    for (const [st, len, note] of bassNotes) {
      const at = stepTime(t0, st);
      const f = midi(note);
      const dur = len * six;
      add(bassBuf, at, dur + 0.08, (tau) => {
        const atk = Math.min(1, tau / 0.012);
        const rel = tau > dur ? Math.max(0, 1 - (tau - dur) / 0.08) : 1;
        const env = atk * rel * (0.75 + 0.25 * Math.exp(-tau * 4));
        return 0.2 * env * (Math.sin(TWO_PI * f * tau) + 0.45 * Math.sin(TWO_PI * 2 * f * tau) + 0.18 * Math.sin(TWO_PI * 3 * f * tau));
      });
    }

    // ---- Keys: an electric piano (2-op FM), the chord on 1 (held) and a short stab on the "and" of 3 ----
    const stabs = [
      [0, 2.2, 1],
      [10, 0.9, 0.7],
    ];
    for (const [st, hold, vel] of stabs) {
      const at = stepTime(t0, st) + 0.01;
      chord.notes.forEach((note, k) => {
        const f = midi(note);
        const strum = k * 0.014;
        const dur = hold * beat;
        const detune = 1 + (k % 2 ? 0.0012 : -0.0009);
        add(music, at + strum, dur + 0.25, (tau) => {
          const idx = 1.6 * Math.exp(-tau * 3) + 0.25;
          const mod = Math.sin(TWO_PI * f * tau) * idx;
          const env = Math.min(1, tau / 0.006) * Math.exp(-tau * 1.5) * (tau > dur ? Math.max(0, 1 - (tau - dur) / 0.25) : 1);
          const trem = 1 + 0.12 * Math.sin(TWO_PI * 4.6 * tau);
          return track.keys * vel * env * trem * Math.sin(TWO_PI * f * detune * tau + mod);
        });
      });
    }

    // ---- A quiet pad under it all (two partials, slow attack) ----
    chord.notes.slice(0, 3).forEach((note) => {
      const f = midi(note - 12);
      add(music, t0, bar + 0.4, (tau) => {
        const env = Math.min(1, tau / 0.5) * (tau > bar ? Math.max(0, 1 - (tau - bar) / 0.4) : 1);
        return 0.035 * env * (Math.sin(TWO_PI * f * tau) + 0.3 * Math.sin(TWO_PI * 2.003 * f * tau));
      });
    });

    // ---- The second half: a few melody notes (bars 9–16), sparse and soft ----
    if (b >= 8) {
      const spots = b % 2 === 0 ? [2, 7] : [4, 11, 14];
      spots.forEach((st, k) => {
        const note = track.melody[(b * 3 + k) % track.melody.length];
        const f = midi(note);
        const at = stepTime(t0, st);
        add(music, at, 0.9, (tau) => {
          const idx = 1.1 * Math.exp(-tau * 5) + 0.15;
          const env = Math.min(1, tau / 0.004) * Math.exp(-tau * 3.2);
          return 0.13 * env * Math.sin(TWO_PI * f * tau + Math.sin(TWO_PI * 2 * f * tau) * idx);
        });
      });
    }
  }

  // ---- Mix: the kick pumps the keys / pad a little (sidechain feel) ----
  const pump = new Float64Array(N).fill(1);
  for (const k of kickTimes) {
    const s0 = Math.round(k * RATE);
    const n = Math.round(0.35 * RATE);
    for (let i = 0; i < n; i++) {
      const idx = (((s0 + i) % N) + N) % N;
      pump[idx] = Math.min(pump[idx], 1 - 0.3 * Math.exp(-(i / RATE) * 9));
    }
  }
  const mix = new Float64Array(N);
  for (let i = 0; i < N; i++) mix[i] = drums[i] + bassBuf[i] + music[i] * pump[i];

  // ---- Vinyl: a soft hiss and a sparse crackle ----
  const vin = rng(track.seed * 7 + 3);
  let hiss = 0;
  for (let i = 0; i < N; i++) {
    hiss += 0.05 * (vin() * 2 - 1 - hiss);
    let crackle = 0;
    if (vin() < 0.00018) crackle = (vin() * 2 - 1) * 0.22;
    mix[i] += hiss * 0.02 + crackle;
  }

  // ---- Warm low-pass (one pole, ~5 kHz), run twice round the loop so the seam is clean; tape saturation ----
  const a = 1 - Math.exp((-TWO_PI * 5000) / RATE);
  let y = 0;
  const out = new Float64Array(N);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      y += a * (mix[i] - y);
      if (pass === 1) out[i] = y;
    }
  }
  for (let i = 0; i < N; i++) out[i] = Math.tanh(out[i] * 1.15) / Math.tanh(1.15);

  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gain = 0.8 / peak; // −2 dBFS; the players add their own (low) volume
  const pcm = Buffer.alloc(N * 2);
  for (let i = 0; i < N; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(out[i] * gain * 32767))), i * 2);
  return { pcm, seconds: loopS };
}

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

function hasFfmpeg(ffmpeg) {
  try {
    execFileSync(ffmpeg, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function encode(wavPath, pcmPath, out) {
  const ffmpeg = process.env.FFMPEG || 'ffmpeg';
  if (hasFfmpeg(ffmpeg)) {
    execFileSync(
      ffmpeg,
      ['-y', '-loglevel', 'error', '-i', wavPath, '-ac', '1', '-ar', String(RATE), '-codec:a', 'libmp3lame', '-b:a', '48k', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', out],
      { stdio: 'inherit' },
    );
    return;
  }
  const python = process.env.PYTHON || 'python3';
  const code = [
    'import sys, lameenc',
    'e = lameenc.Encoder()',
    `e.set_bit_rate(48); e.set_in_sample_rate(${RATE}); e.set_channels(1); e.set_quality(2)`,
    'data = open(sys.argv[1], "rb").read()',
    'open(sys.argv[2], "wb").write(e.encode(data) + e.flush())',
  ].join('\n');
  execFileSync(python, ['-c', code, pcmPath, out], { stdio: 'inherit' });
}

const dir = mkdtempSync(join(tmpdir(), 'clip-music-'));
try {
  for (const track of TRACKS) {
    const { pcm, seconds } = render(track);
    const wavPath = join(dir, `${track.name}.wav`);
    const pcmPath = join(dir, `${track.name}.pcm`);
    writeFileSync(wavPath, wav(pcm));
    writeFileSync(pcmPath, pcm);
    const web = join(ROOT, `frontend/public/audio/clip-beat-${track.name}-v1.mp3`);
    const lab = join(ROOT, `android-lab/app/src/main/res/raw/clip_beat_${track.name}.mp3`);
    mkdirSync(dirname(web), { recursive: true });
    encode(wavPath, pcmPath, web);
    mkdirSync(dirname(lab), { recursive: true });
    copyFileSync(web, lab);
    console.log(`wrote ${web} and ${lab} (${seconds.toFixed(1)} s loop, ${track.bpm} BPM)`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
