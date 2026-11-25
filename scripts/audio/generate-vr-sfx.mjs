#!/usr/bin/env node
/**
 * The sound effects and ambience loops of 🥽 VR worlds (docs/VR_WORLDS.md "Sound").
 *
 * Procedural — no samples, no third-party audio. Impacts are MODAL SYNTHESIS: each material is a few
 * damped sine modes (wood knocks low and short, glass rings high and long, metal is inharmonic and
 * long, cloth is mostly a soft filtered thump) plus a short noise transient; the player varies pitch
 * and volume with the impact speed. UI sounds are little bells and sweeps; ambiences are 20 s loops
 * rendered with a crossfaded seam (room tone, a fridge hum, street traffic, a restaurant's murmur, an
 * airport hall). Written for this app and dedicated to the public domain (CC0 1.0).
 *
 * Deterministic (seeded noise). Encoding needs ffmpeg with libmp3lame (FFMPEG=/path, else `ffmpeg`):
 *
 *   node scripts/audio/generate-vr-sfx.mjs            # everything
 *   node scripts/audio/generate-vr-sfx.mjs amb-street # one file
 *
 * writes frontend/public/vr/sfx/<name>.mp3 (mono; effects 44.1 kHz 64 kbps, ambiences 32 kHz 40 kbps).
 * A new world that needs a new ambience adds a function to AMBIENCES below and a name to
 * frontend/src/vr/worlds/types.ts AMBIENCES.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'frontend/public/vr/sfx');
const TWO_PI = Math.PI * 2;

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

/** One-pole low-pass in place (cutoff Hz). */
function lowpass(buf, rate, cutoff) {
  const a = Math.exp((-TWO_PI * cutoff) / rate);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y = (1 - a) * buf[i] + a * y;
    buf[i] = y;
  }
  return buf;
}
function highpass(buf, rate, cutoff) {
  const low = lowpass(Float64Array.from(buf), rate, cutoff);
  for (let i = 0; i < buf.length; i++) buf[i] -= low[i];
  return buf;
}
function bandpass(buf, rate, lo, hi) {
  highpass(buf, rate, lo);
  return lowpass(buf, rate, hi);
}

function normalize(buf, peak = 0.89) {
  let m = 0;
  for (const v of buf) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / m;
  return buf;
}

/** A damped sine mode added into buf from t0: freq, amplitude, decay time constant (s). */
function mode(buf, rate, t0, f, amp, tau, attack = 0.001) {
  const start = Math.floor(t0 * rate);
  const n = Math.min(buf.length - start, Math.ceil(tau * 7 * rate));
  const ph = Math.random() * 0; // deterministic phase
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t / attack) * Math.exp(-t / tau);
    buf[start + i] += amp * env * Math.sin(TWO_PI * f * t + ph);
  }
}

/** A noise burst (white noise through a band) added from t0 with an exponential decay. */
function noiseBurst(buf, rate, t0, amp, tau, lo, hi, seed) {
  const r = rng(seed);
  const n = Math.min(buf.length - Math.floor(t0 * rate), Math.ceil(tau * 7 * rate));
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) b[i] = (r() * 2 - 1) * Math.exp(-i / rate / tau);
  if (lo) highpass(b, rate, lo);
  if (hi) lowpass(b, rate, hi);
  const s = Math.floor(t0 * rate);
  for (let i = 0; i < n; i++) buf[s + i] += amp * b[i];
}

const IMPACTS = {
  wood: { modes: [[190, 1, 0.045], [430, 0.7, 0.03], [810, 0.45, 0.02], [1350, 0.25, 0.012]], noise: [0.5, 0.008, 200, 3500], len: 0.35 },
  glass: { modes: [[1870, 1, 0.32], [3150, 0.6, 0.22], [4430, 0.35, 0.15], [5960, 0.2, 0.1]], noise: [0.25, 0.003, 2000, 9000], len: 1.4 },
  metal: { modes: [[530, 0.8, 0.5], [1260, 1, 0.38], [2310, 0.55, 0.28], [3480, 0.35, 0.2], [4810, 0.2, 0.14]], noise: [0.3, 0.004, 1000, 8000], len: 1.8 },
  plastic: { modes: [[310, 1, 0.03], [770, 0.6, 0.022], [1420, 0.35, 0.015]], noise: [0.6, 0.01, 300, 5000], len: 0.3 },
  cloth: { modes: [[95, 1, 0.04], [170, 0.5, 0.03]], noise: [1.2, 0.03, 60, 900], len: 0.3 },
  paper: { modes: [[420, 0.3, 0.01]], noise: [1.2, 0.04, 1500, 8000], len: 0.3 },
  ceramic: { modes: [[1120, 1, 0.16], [2680, 0.6, 0.11], [4150, 0.35, 0.07], [5300, 0.15, 0.05]], noise: [0.3, 0.004, 1500, 9000], len: 0.9 },
  food: { modes: [[110, 1, 0.05], [240, 0.5, 0.03]], noise: [0.8, 0.02, 80, 1400], len: 0.3 },
  stone: { modes: [[250, 1, 0.06], [620, 0.6, 0.04], [1160, 0.35, 0.025]], noise: [0.7, 0.01, 300, 6000], len: 0.4 },
};

function impact(material, rate) {
  const def = IMPACTS[material];
  const buf = new Float64Array(Math.ceil(def.len * rate));
  for (const [f, a, tau] of def.modes) mode(buf, rate, 0, f, a, tau);
  const [na, ntau, lo, hi] = def.noise;
  noiseBurst(buf, rate, 0, na, ntau, lo, hi, material.length * 97);
  return normalize(buf, 0.85);
}

/** A bell note: a few slightly inharmonic partials with long decays. */
function bell(buf, rate, t0, f, amp, len = 0.9) {
  for (const [ratio, a, tau] of [[1, 1, len * 0.45], [2.01, 0.45, len * 0.3], [3.02, 0.2, len * 0.2], [4.17, 0.1, len * 0.12]]) mode(buf, rate, t0, f * ratio, amp * a, tau, 0.002);
}

function sweep(buf, rate, t0, f0, f1, len, amp) {
  const s = Math.floor(t0 * rate);
  const n = Math.floor(len * rate);
  let ph = 0;
  for (let i = 0; i < n && s + i < buf.length; i++) {
    const t = i / n;
    const f = f0 * Math.pow(f1 / f0, t);
    ph += (TWO_PI * f) / rate;
    const env = Math.sin(Math.PI * t) ** 2;
    buf[s + i] += amp * env * Math.sin(ph);
  }
}

function whoosh(rate, len, lo, hi, seed, rise = false) {
  const n = Math.floor(len * rate);
  const buf = new Float64Array(n);
  const r = rng(seed);
  for (let i = 0; i < n; i++) buf[i] = r() * 2 - 1;
  // a moving band: filter in slices
  const out = new Float64Array(n);
  const slices = 12;
  for (let k = 0; k < slices; k++) {
    const a = Math.floor((k / slices) * n);
    const b = Math.floor(((k + 1) / slices) * n);
    const t = k / (slices - 1);
    const c = rise ? lo + (hi - lo) * t : hi - (hi - lo) * Math.sin(Math.PI * t);
    const seg = bandpass(buf.slice(Math.max(0, a - 200), b), rate, c * 0.6, c * 1.6);
    for (let i = a; i < b; i++) out[i] = seg[i - Math.max(0, a - 200)];
  }
  for (let i = 0; i < n; i++) out[i] *= Math.sin((Math.PI * i) / n) ** 1.5;
  return normalize(out, 0.7);
}

const EFFECTS = {
  pickup: (rate) => { const b = new Float64Array(Math.floor(0.2 * rate)); sweep(b, rate, 0, 330, 620, 0.12, 0.6); noiseBurst(b, rate, 0, 0.12, 0.03, 2000, 7000, 3); return normalize(b, 0.6); },
  drop: (rate) => { const b = new Float64Array(Math.floor(0.2 * rate)); sweep(b, rate, 0, 560, 300, 0.12, 0.6); return normalize(b, 0.5); },
  throw: (rate) => whoosh(rate, 0.38, 300, 2200, 9),
  teleport: (rate) => { const b = whoosh(rate, 0.3, 400, 3000, 21, true); sweep(b, rate, 0.05, 500, 1100, 0.2, 0.2); return normalize(b, 0.55); },
  click: (rate) => { const b = new Float64Array(Math.floor(0.05 * rate)); mode(b, rate, 0, 2400, 1, 0.004); noiseBurst(b, rate, 0, 0.4, 0.002, 2000, 9000, 4); return normalize(b, 0.5); },
  use: (rate) => {
    const b = new Float64Array(Math.floor(0.35 * rate));
    noiseBurst(b, rate, 0, 0.8, 0.008, 400, 5000, 5);
    mode(b, rate, 0, 900, 0.5, 0.02);
    noiseBurst(b, rate, 0.11, 1, 0.012, 150, 3000, 6);
    mode(b, rate, 0.11, 320, 0.7, 0.04);
    return normalize(b, 0.7);
  },
  success: (rate) => { const b = new Float64Array(Math.floor(1.4 * rate)); bell(b, rate, 0, 1046.5, 0.8); bell(b, rate, 0.11, 1318.5, 0.7); bell(b, rate, 0.22, 1568, 0.8, 1.1); return normalize(b, 0.75); },
  finish: (rate) => {
    const b = new Float64Array(Math.floor(2.6 * rate));
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => bell(b, rate, i * 0.12, f, 0.7, 1.3));
    bell(b, rate, 0.7, 1568, 0.6, 1.8);
    bell(b, rate, 0.7, 2093, 0.4, 1.8);
    return normalize(b, 0.8);
  },
  hint: (rate) => { const b = new Float64Array(Math.floor(0.9 * rate)); bell(b, rate, 0, 1760, 0.5, 0.7); return normalize(b, 0.45); },
  open: (rate) => { const b = new Float64Array(Math.floor(0.5 * rate)); noiseBurst(b, rate, 0, 0.5, 0.01, 200, 3000, 8); const w = whoosh(rate, 0.35, 150, 900, 12); for (let i = 0; i < w.length; i++) b[i] += 0.35 * w[i]; return normalize(b, 0.6); },
  water: (rate) => {
    // a running tap: band noise with a fast flutter (loops — the player sets loop)
    const len = 4;
    const n = Math.floor(len * rate);
    const r = rng(77);
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) b[i] = r() * 2 - 1;
    bandpass(b, rate, 500, 6000);
    for (let i = 0; i < n; i++) b[i] *= 0.75 + 0.25 * Math.sin((TWO_PI * 13 * i) / rate) * Math.sin((TWO_PI * 0.5 * i) / rate);
    return seamLoop(normalize(b, 0.5), rate, 0.5);
  },
  crossing: (rate) => {
    // the pedestrian signal while green (street world): a quick "dī-dī-dī" tick, faster than walking pace
    const len = 2;
    const b = new Float64Array(Math.floor(len * rate));
    for (let k = 0; k < 8; k++) {
      const t0 = k * 0.25;
      mode(b, rate, t0, 2850, 0.6, 0.018, 0.002);
      mode(b, rate, t0, 5700, 0.12, 0.01, 0.002);
      noiseBurst(b, rate, t0, 0.08, 0.004, 1500, 6000, 600 + k);
    }
    return normalize(b, 0.5);
  },
  sizzle: (rate) => {
    // a hot griddle (the street world's jianbing cart): hiss + crackles, loops
    const len = 4;
    const n = Math.floor(len * rate);
    const r = rng(91);
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) b[i] = r() * 2 - 1;
    bandpass(b, rate, 2500, 9000);
    for (let i = 0; i < n; i++) b[i] *= 0.35 + 0.15 * Math.sin((TWO_PI * 0.7 * i) / rate);
    for (let k = 0; k < 70; k++) noiseBurst(b, rate, r() * (len - 0.05), 0.4 + r() * 0.6, 0.002 + r() * 0.004, 1500, 8000, 700 + k);
    return seamLoop(normalize(b, 0.4), rate, 0.5);
  },
};

/** Crossfades the last `fade` seconds into the start: the result loops seamlessly (length − fade). */
function seamLoop(buf, rate, fade) {
  const f = Math.floor(fade * rate);
  const n = buf.length - f;
  const out = buf.slice(0, n);
  for (let i = 0; i < f; i++) {
    const t = i / f;
    out[i] = buf[i] * Math.sin((t * Math.PI) / 2) + buf[n + i] * Math.cos((t * Math.PI) / 2);
  }
  return out;
}

function brown(n, seed, k = 0.02) {
  const r = rng(seed);
  const b = new Float64Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = (y + k * (r() * 2 - 1)) * 0.998;
    b[i] = y;
  }
  return normalize(b, 1);
}

function pink(n, seed) {
  const r = rng(seed);
  const b = new Float64Array(n);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    b[i] = b0 + b1 + b2 + w * 0.1848;
  }
  return normalize(b, 1);
}

function add(dst, src, gain, at = 0) {
  for (let i = 0; i < src.length && at + i < dst.length; i++) dst[at + i] += gain * src[i];
}

function chirp(buf, rate, t0, seed) {
  const r = rng(seed);
  const notes = 2 + Math.floor(r() * 3);
  for (let k = 0; k < notes; k++) sweep(buf, rate, t0 + k * 0.09, 3200 + r() * 1500, 4200 + r() * 1800, 0.06, 0.05);
}

/** Speech-like murmur: band noise whose loudness moves like syllables. */
function murmur(n, rate, seed, voices = 5) {
  const out = new Float64Array(n);
  for (let v = 0; v < voices; v++) {
    const r = rng(seed + v * 31);
    const src = pink(n, seed + v * 7);
    bandpass(src, rate, 250 + r() * 150, 1800 + r() * 900);
    let phase = r() * 10;
    let env = 0;
    let target = 0;
    let next = 0;
    for (let i = 0; i < n; i++) {
      if (i >= next) {
        target = r() < 0.25 ? 0 : 0.4 + r() * 0.6;
        next = i + Math.floor((0.08 + r() * 0.22) * rate);
      }
      env += (target - env) * 0.004;
      phase += 1 / rate;
      out[i] += src[i] * env * (0.6 + 0.4 * Math.sin(phase * 0.7 + v));
    }
  }
  return normalize(out, 1);
}

const AMB_LEN = 22; // rendered; 20 s after the seam crossfade

const AMBIENCES = {
  city: (rate) => {
    // 街上 (the street world) at dusk: the city's hum, cars and a bus going by (air brakes), an e-bike's
    // whine and its "dī dī", a far-off horn, people talking as they pass, evening sparrows.
    const n = AMB_LEN * rate;
    const b = new Float64Array(n);
    add(b, lowpass(brown(n, 9, 0.04), rate, 180), 0.4);
    add(b, lowpass(pink(n, 10), rate, 600), 0.1);
    for (const [t, dur, seed, gain] of [[0.5, 4.5, 51, 0.5], [4.2, 3.5, 52, 0.35], [9.8, 5, 53, 0.55], [15.5, 4, 54, 0.4], [18.2, 3.2, 55, 0.3]]) {
      add(b, passBy(rate, dur, seed, 70, 1400, 0), gain, Math.floor(t * rate));
    }
    // the bus: low and slow, then the air brakes hiss
    add(b, passBy(rate, 6, 56, 40, 700, 55), 0.55, Math.floor(6.5 * rate));
    const hiss = new Float64Array(Math.floor(1.2 * rate));
    noiseBurst(hiss, rate, 0, 1, 0.35, 3000, 9000, 57);
    add(b, hiss, 0.12, Math.floor(10.2 * rate));
    // an e-bike: a rising electric whine, and its two-tone beep
    const whine = new Float64Array(Math.floor(3 * rate));
    sweep(whine, rate, 0, 520, 900, 3, 0.25);
    add(b, whine, 0.25, Math.floor(2.4 * rate));
    for (const t of [3.1, 3.32]) {
      const beep = new Float64Array(Math.floor(0.2 * rate));
      for (let i = 0; i < beep.length; i++) beep[i] = Math.sin((TWO_PI * 1760 * i) / rate) * Math.min(1, (beep.length - i) / 400) * Math.min(1, i / 60);
      add(b, beep, 0.06, Math.floor(t * rate));
    }
    // a far-off car horn
    const horn = new Float64Array(Math.floor(0.5 * rate));
    for (let i = 0; i < horn.length; i++) {
      const tt = i / rate;
      horn[i] = (Math.sign(Math.sin(TWO_PI * 415 * tt)) * 0.5 + Math.sign(Math.sin(TWO_PI * 523 * tt)) * 0.5) * Math.min(1, i / 300) * Math.min(1, (horn.length - i) / 800);
    }
    add(b, lowpass(horn, rate, 1500), 0.05, Math.floor(13.4 * rate));
    // people walking by, talking; a bicycle bell
    add(b, murmur(n, rate, 120, 4), 0.1);
    bell(b, rate, 17.1, 2093, 0.12, 0.5);
    bell(b, rate, 17.3, 2093, 0.1, 0.5);
    // evening sparrows in the tree
    for (const [t, seed] of [[1.4, 61], [1.8, 62], [5.6, 63], [8.9, 64], [9.2, 65], [12.1, 66], [14.6, 67], [19.4, 68], [19.8, 69]]) chirp(b, rate, t, seed);
    return seamLoop(normalize(b, 0.4), rate, 2);
  },
  kitchen: (rate) => {
    const n = AMB_LEN * rate;
    const b = new Float64Array(n);
    add(b, lowpass(brown(n, 1), rate, 400), 0.18);
    // the fridge: 50 Hz + harmonics, slowly breathing
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const w = 0.8 + 0.2 * Math.sin(TWO_PI * 0.09 * t);
      b[i] += w * (0.05 * Math.sin(TWO_PI * 50 * t) + 0.035 * Math.sin(TWO_PI * 100 * t) + 0.02 * Math.sin(TWO_PI * 150.4 * t));
    }
    // a soft clock tick each second
    for (let s = 0; s < AMB_LEN; s++) noiseBurst(b, rate, s + 0.02, 0.05, 0.003, 2500, 7000, 100 + s);
    // birds outside the window
    for (const [t, seed] of [[3.1, 1], [3.6, 2], [9.4, 3], [14.2, 4], [14.7, 5], [18.3, 6]]) chirp(b, rate, t, seed);
    return seamLoop(normalize(b, 0.32), rate, 2);
  },
  house: (rate) => {
    const n = AMB_LEN * rate;
    const b = new Float64Array(n);
    add(b, lowpass(brown(n, 2), rate, 300), 0.2);
    for (let s = 0; s < AMB_LEN; s++) noiseBurst(b, rate, s + 0.02, 0.06, 0.003, 2500, 7000, 200 + s);
    for (const [t, seed] of [[2.2, 11], [7.9, 12], [8.4, 13], [16.1, 14]]) chirp(b, rate, t, seed);
    return seamLoop(normalize(b, 0.28), rate, 2);
  },
  street: (rate) => {
    const n = AMB_LEN * rate;
    const b = new Float64Array(n);
    add(b, lowpass(brown(n, 3, 0.05), rate, 250), 0.35);
    // passing cars: a band of noise swelling and fading
    for (const [t, dur, seed] of [[1, 5, 31], [6.5, 4, 32], [11, 6, 33], [16, 4.5, 34]]) {
      const len = Math.floor(dur * rate);
      const car = pink(len, seed);
      bandpass(car, rate, 80, 1200);
      for (let i = 0; i < len; i++) car[i] *= Math.exp(-(((i / len - 0.5) * 4) ** 2));
      add(b, car, 0.5, Math.floor(t * rate));
    }
    // a bicycle bell, distant birds
    bell(b, rate, 8.2, 2093, 0.18, 0.5);
    bell(b, rate, 8.42, 2093, 0.15, 0.5);
    for (const [t, seed] of [[4.4, 41], [13.3, 42]]) chirp(b, rate, t, seed);
    add(b, murmur(n, rate, 50, 3), 0.06);
    return seamLoop(normalize(b, 0.4), rate, 2);
  },
  restaurant: (rate) => {
    const n = AMB_LEN * rate;
    const b = new Float64Array(n);
    add(b, murmur(n, rate, 60, 7), 0.5);
    add(b, lowpass(brown(n, 4), rate, 300), 0.15);
    // dishes and a sizzle from the kitchen
    for (const [t, seed] of [[2.3, 1], [5.8, 2], [9.1, 3], [12.7, 4], [17.4, 5]]) {
      const c = impact(seed % 2 ? 'ceramic' : 'metal', rate);
      add(b, c, 0.08 + 0.04 * (seed % 3), Math.floor(t * rate));
    }
    const sz = new Float64Array(Math.floor(5 * rate));
    noiseBurst(sz, rate, 0, 1, 1.5, 3000, 9000, 70);
    add(b, sz, 0.05, Math.floor(10 * rate));
    return seamLoop(normalize(b, 0.38), rate, 2);
  },
  airport: (rate) => {
    const n = AMB_LEN * rate;
    const b = new Float64Array(n);
    add(b, lowpass(pink(n, 5), rate, 900), 0.25);
    add(b, lowpass(brown(n, 6, 0.03), rate, 120), 0.3);
    add(b, murmur(n, rate, 80, 6), 0.22);
    // the announcement chime: ding-dong
    bell(b, rate, 6, 784, 0.35, 1.8);
    bell(b, rate, 6.6, 622.25, 0.35, 2.2);
    // a rolling suitcase
    const roll = new Float64Array(Math.floor(3 * rate));
    for (let k = 0; k < 40; k++) noiseBurst(roll, rate, k * 0.07, 0.25, 0.01, 200, 2000, 300 + k);
    for (let i = 0; i < roll.length; i++) roll[i] *= Math.sin((Math.PI * i) / roll.length);
    add(b, roll, 0.5, Math.floor(13 * rate));
    return seamLoop(normalize(b, 0.38), rate, 2);
  },
};

/** A vehicle going by: band noise swelling and fading, its pitch sliding down as it passes (Doppler-ish). */
function passBy(rate, dur, seed, lo, hi, engine = 0) {
  const len = Math.floor(dur * rate);
  const car = pink(len, seed);
  bandpass(car, rate, lo, hi);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const env = Math.exp(-(((t - 0.5) * 4) ** 2));
    ph += (TWO_PI * engine * (1.15 - 0.3 * t)) / rate;
    car[i] = env * (car[i] + (engine ? 0.35 * Math.sin(ph) + 0.15 * Math.sin(2 * ph) : 0));
  }
  return car;
}

function encode(name, buf, rate, kbps) {
  const tmp = mkdtempSync(join(tmpdir(), 'vr-sfx-'));
  try {
    const wav = join(tmp, `${name}.wav`);
    const pcm = Buffer.alloc(44 + buf.length * 2);
    pcm.write('RIFF', 0);
    pcm.writeUInt32LE(36 + buf.length * 2, 4);
    pcm.write('WAVEfmt ', 8);
    pcm.writeUInt32LE(16, 16);
    pcm.writeUInt16LE(1, 20);
    pcm.writeUInt16LE(1, 22);
    pcm.writeUInt32LE(rate, 24);
    pcm.writeUInt32LE(rate * 2, 28);
    pcm.writeUInt16LE(2, 32);
    pcm.writeUInt16LE(16, 34);
    pcm.write('data', 36);
    pcm.writeUInt32LE(buf.length * 2, 40);
    for (let i = 0; i < buf.length; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(buf[i] * 32767))), 44 + i * 2);
    writeFileSync(wav, pcm);
    const out = join(OUT, `${name}.mp3`);
    execFileSync(process.env.FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', `${kbps}k`, '-map_metadata', '-1', out]);
    console.log(`  ${name}.mp3`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const want = (name) => only.length === 0 || only.includes(name);
const FX_RATE = 44100;
const AMB_RATE = 32000;
for (const m of Object.keys(IMPACTS)) if (want(`impact-${m}`)) encode(`impact-${m}`, impact(m, FX_RATE), FX_RATE, 64);
for (const [name, fn] of Object.entries(EFFECTS)) if (want(name)) encode(name, fn(FX_RATE), FX_RATE, 64);
for (const [name, fn] of Object.entries(AMBIENCES)) if (want(`amb-${name}`)) encode(`amb-${name}`, fn(AMB_RATE), AMB_RATE, 40);
