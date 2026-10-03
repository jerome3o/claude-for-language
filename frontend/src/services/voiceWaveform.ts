/**
 * Voice message waveforms (docs/CHAT.md "Round 2"): 40 bars from the peaks of
 * the decoded clip, cached per message (memory + localStorage), with seeded
 * bars until it is decoded. The playback speed chip (1× → 1.5× → 2×) is
 * remembered on the device.
 */
import { useEffect, useState } from 'react';

export const WAVE_BARS = 40;
const KEY = 'chat-voice-wave-v1';
const SPEED_KEY = 'chat-voice-speed';
const MAX_KEPT = 300;

/** Peak level per bar (0..1, the loudest bar = 1; a floor keeps silence visible). Pure. */
export function peaks(samples: ArrayLike<number>, bars = WAVE_BARS): number[] {
  const n = samples.length;
  if (n === 0) return new Array(bars).fill(0.08);
  const out: number[] = [];
  for (let b = 0; b < bars; b++) {
    const from = Math.floor((b * n) / bars);
    const to = Math.max(from + 1, Math.floor(((b + 1) * n) / bars));
    let max = 0;
    for (let i = from; i < to && i < n; i++) {
      const v = Math.abs(samples[i]);
      if (v > max) max = v;
    }
    out.push(max);
  }
  const top = Math.max(...out);
  return out.map((v) => Math.max(0.08, top > 0 ? Math.round((v / top) * 100) / 100 : 0.08));
}

/** Stable pseudo-random bars for a message whose clip isn't decoded yet. Pure. */
export function seededBars(seed: string, bars = WAVE_BARS): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    out.push(0.25 + ((h % 1000) / 1000) * 0.6);
  }
  return out;
}

const memory = new Map<string, number[]>();

function readStore(): Record<string, number[]> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, number[]>;
  } catch {
    return {};
  }
}

function remember(id: string, bars: number[]) {
  memory.set(id, bars);
  const all = readStore();
  all[id] = bars;
  const keys = Object.keys(all);
  if (keys.length > MAX_KEPT) for (const k of keys.slice(0, keys.length - MAX_KEPT)) delete all[k];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

function known(id: string): number[] | null {
  return memory.get(id) ?? readStore()[id] ?? null;
}

async function decode(url: string): Promise<number[]> {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error('no audio context');
  const bytes = await (await fetch(url)).arrayBuffer();
  const ctx = new Ctx();
  try {
    const buf = await ctx.decodeAudioData(bytes);
    return peaks(buf.getChannelData(0));
  } finally {
    void ctx.close().catch(() => {});
  }
}

/** The bars for a voice message: seeded at first, the real peaks once `url` (a blob URL) decodes. */
export function useWaveform(messageId: string, url: string | null): number[] {
  const [bars, setBars] = useState<number[]>(() => known(messageId) ?? seededBars(messageId));
  useEffect(() => {
    const hit = known(messageId);
    if (hit) {
      setBars(hit);
      return;
    }
    if (!url) return;
    let live = true;
    decode(url)
      .then((b) => {
        remember(messageId, b);
        if (live) setBars(b);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [messageId, url]);
  return bars;
}

export const SPEEDS = [1, 1.5, 2] as const;

export function voiceSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return (SPEEDS as readonly number[]).includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

export function nextVoiceSpeed(current: number): number {
  const i = (SPEEDS as readonly number[]).indexOf(current);
  const next = SPEEDS[(i + 1) % SPEEDS.length];
  try {
    localStorage.setItem(SPEED_KEY, String(next));
  } catch {
    /* ignore */
  }
  return next;
}
