/**
 * 📺 Watch (docs/WATCH.md): the link parser (shared/watch/video.ts) and the player's line rules
 * (shared/watch/lines.ts). Writes watch.json; core WatchParityTest asserts watch/Watch.kt matches
 * exactly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  activeLineIndex,
  firstUrlIn,
  focusStillHolds,
  lineEndCrossed,
  lineIndexAt,
  linePauseMs,
  lineSeekMs,
  nextWatchReveal,
  nextWatchSpeed,
  parseWatchSpeed,
  parseYouTubeVideoId,
  resumeAtMs,
  stepLine,
  watchClock,
  watchedFraction,
  watchIsWorking,
  watchSpeedLabel,
  watchStatusLine,
  WATCH_REVEALS,
  WATCH_SPEEDS,
  youtubeThumbnailUrl,
  youtubeWatchUrl,
  youtubeSearchUrl,
  WATCH_SHOWS,
} from '../../../shared/watch';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: watch <out-dir>');
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
const r = rng(158);
const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

const ID = 'dQw4w9WgXcQ';
const links = [
  '', '   ', 'hello', ID, ` ${ID} `, 'dQw4w9WgXc', 'dQw4w9WgXcQQ',
  `https://www.youtube.com/watch?v=${ID}`, `https://www.youtube.com/watch?v=${ID}&t=42s&list=PL1`,
  `https://m.youtube.com/watch?feature=share&v=${ID}`, `https://youtu.be/${ID}`, `https://youtu.be/${ID}?si=AbC`,
  `https://www.youtube.com/shorts/${ID}`, `https://www.youtube.com/embed/${ID}?start=10`,
  `https://www.youtube-nocookie.com/embed/${ID}`, `https://www.youtube.com/live/${ID}`, `https://music.youtube.com/watch?v=${ID}`,
  `https://www.youtube.com/v/${ID}`, `https://YOUTU.BE/${ID}`, `HTTPS://WWW.YOUTUBE.COM/watch?v=${ID}`,
  `youtu.be/${ID}`, `www.youtube.com/watch?v=${ID}`, `m.youtube.com/watch?v=${ID}`,
  `小欢喜 第1集 https://youtu.be/${ID}?si=xyz`, `Check this: https://www.youtube.com/watch?v=${ID}.`, `(https://youtu.be/${ID})`,
  `https://www.youtube.com/attribution_link?u=%2Fwatch%3Fv%3D${ID}%26feature%3Dshare`,
  'https://www.youtube.com/channel/UC1234567890', 'https://www.youtube.com/playlist?list=PL123', 'https://www.youtube.com/',
  'https://vimeo.com/12345678901', `https://example.com/watch?v=${ID}`, 'https://www.youtube.com/watch?v=short',
  `https://youtu.be/${ID.slice(0, 10)}!`, 'https://youtube.com/watch?v=abc_DEF-123', 'https://youtu.be/', 'not a url https://',
];
const parse = links.map((input) => ({ input, id: parseYouTubeVideoId(input), url: firstUrlIn(input) }));
const urls = { watch: youtubeWatchUrl(ID), thumb: youtubeThumbnailUrl(ID), search: youtubeSearchUrl('小欢喜 第1集'), shows: WATCH_SHOWS.map((s) => youtubeSearchUrl(s.query)) };

function randomLines() {
  const n = int(0, 7);
  const out: Array<{ start_ms: number; end_ms: number }> = [];
  let at = int(0, 3000);
  for (let i = 0; i < n; i++) {
    const len = int(300, 6000);
    out.push({ start_ms: at, end_ms: at + len });
    at += len + (r() < 0.4 ? 0 : int(0, 3000));
  }
  return out;
}

const lineCases = [] as unknown[];
for (let c = 0; c < 160; c++) {
  const lines = randomLines();
  const end = (lines[lines.length - 1]?.end_ms ?? 2000) + 2000;
  const probes = [] as unknown[];
  for (let p = 0; p < 12; p++) {
    const ms = int(0, end);
    const prev = r() < 0.3 ? ms - int(-500, 2500) : ms - int(0, 400);
    const focus = r() < 0.5 ? null : int(-1, lines.length);
    const playing = r() < 0.5;
    probes.push({
      ms, prev, focus, playing,
      at: lineIndexAt(lines, ms),
      active: activeLineIndex(lines, ms, focus, playing),
      holds: focusStillHolds(lines, ms, focus, playing),
      crossed: lineEndCrossed(lines, prev, ms, focus),
    });
  }
  const per = lines.map((_, i) => ({ seek: lineSeekMs(lines, i), pause: linePauseMs(lines, i) }));
  const steps = [-1, 0, 1, 2, lines.length - 1, lines.length].map((cur) => ({ cur, prev: stepLine(lines.length, cur, -1), next: stepLine(lines.length, cur, 1) }));
  lineCases.push({ lines, per, probes, steps });
}

const reveals = WATCH_REVEALS.flatMap((cur) => [true, false].flatMap((p) => [true, false].map((e) => ({ cur, p, e, next: nextWatchReveal(cur, p, e) }))));
const speeds = [...WATCH_SPEEDS, 2, 0, 0.6].map((s) => ({ speed: s, next: nextWatchSpeed(s), label: watchSpeedLabel(s) }));
const speedParse = [null, '', '1', '0.75', '0.5', ' 0.5 ', '2', 'fast', 1, 0.75, 0.5, 3].map((raw) => ({ raw, speed: parseWatchSpeed(raw) }));
const clocks = [0, -5, 999, 1000, 59_999, 65_000, 600_000, 3_599_999, 3_600_000, 3_725_000, 36_000_000].map((ms) => ({ ms, label: watchClock(ms) }));
const resumes = [
  [null, null], [0, 2_700_000], [3_000, 2_700_000], [5_000, 2_700_000], [120_000, 2_700_000], [2_670_000, 2_700_000],
  [2_669_999, 2_700_000], [120_000, null], [120_000, 0], [-5, 100_000], [NaN, 100_000],
].map(([p, d]) => ({ p, d, resume: resumeAtMs(p as number | null, d as number | null), fraction: watchedFraction(p as number | null, d as number | null) }));
const statuses = [
  { status: null }, { status: 'queued' }, { status: 'transcribing' }, { status: 'transcribing', chunks_done: 0, chunks_total: 9 },
  { status: 'transcribing', chunks_done: 9, chunks_total: 9 }, { status: 'translating' }, { status: 'translating', progress_done: 40, progress_total: 812 },
  { status: 'ready' }, { status: 'ready', progress_total: 812 }, { status: 'failed' }, { status: 'failed', error: 'video unavailable' }, { status: 'weird' },
].map((v) => ({ v, line: watchStatusLine(v), working: watchIsWorking(v.status) }));

writeFileSync(join(OUT, 'watch.json'), JSON.stringify({ parse, urls, lineCases, reveals, speeds, speedParse, clocks, resumes, statuses }));
