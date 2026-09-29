/**
 * Structural checks for a hunt's objects and for play uploads. The worker runs
 * these on what the pipeline produces before it is stored; clients can trust
 * a stored hunt's shape.
 */
import { cardTextProblems } from '../cards/standard';
import type { HuntBox, HuntObject, HuntRegion, PictureHuntPlay } from './types';
import { PICTURE_HUNT_MAX_OBJECTS } from './types';

const TONE_NUMBER = /[a-zü][1-5]/i;
const HAS_HAN = /[㐀-鿿]/;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Clamp a box into the image; null when it has no area left. */
export function cleanBox(raw: unknown): HuntBox | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (![b.x, b.y, b.w, b.h].every(isFiniteNumber)) return null;
  const x0 = clamp01(b.x as number);
  const y0 = clamp01(b.y as number);
  const x1 = clamp01((b.x as number) + (b.w as number));
  const y1 = clamp01((b.y as number) + (b.h as number));
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;
  return { x: round4(x0), y: round4(y0), w: round4(x1 - x0), h: round4(y1 - y0) };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function cleanRegion(raw: unknown): HuntRegion | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const box = cleanBox(r.box);
  if (!box) return null;
  const region: HuntRegion = { box };
  if (Array.isArray(r.polygon)) {
    const pts = r.polygon
      .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && isFiniteNumber(p[0]) && isFiniteNumber(p[1]))
      .map(([x, y]) => [round4(clamp01(x)), round4(clamp01(y))] as [number, number]);
    if (pts.length >= 3) region.polygon = pts;
  }
  return region;
}

/**
 * Problems with one named object (empty = fine). The HARD card rules apply to
 * the hanzi, since the object can be added as a card as it is.
 */
export function huntObjectProblems(obj: Partial<HuntObject>): string[] {
  const problems: string[] = [];
  const label = obj.hanzi || obj.english || obj.id || '?';
  if (typeof obj.hanzi !== 'string' || !HAS_HAN.test(obj.hanzi)) problems.push(`${label}: hanzi must be Chinese characters`);
  else if (Array.from(obj.hanzi).length > 8) problems.push(`${label}: hanzi "${obj.hanzi}" is too long for an object name`);
  if (typeof obj.pinyin !== 'string' || !obj.pinyin.trim()) problems.push(`${label}: pinyin is missing`);
  else if (TONE_NUMBER.test(obj.pinyin)) problems.push(`${label}: pinyin "${obj.pinyin}" uses tone numbers — use tone marks`);
  if (typeof obj.english !== 'string' || !obj.english.trim()) problems.push(`${label}: english is missing`);
  for (const p of cardTextProblems({ hanzi: obj.hanzi, sentence_clue: obj.sentence_clue })) {
    problems.push(`${label}: ${p.message}`);
  }
  if (obj.sentence_clue && obj.hanzi && !obj.sentence_clue.includes(obj.hanzi)) {
    problems.push(`${label}: sentence_clue must contain "${obj.hanzi}" exactly`);
  }
  if (!Array.isArray(obj.regions) || obj.regions.length === 0) problems.push(`${label}: no region in the picture`);
  return problems;
}

/** Clean alternatives: Chinese only, no duplicates of the hanzi, at most 8. */
export function cleanAlternatives(hanzi: string, raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const a of raw) {
    if (typeof a !== 'string') continue;
    const t = a.trim();
    if (!t || t === hanzi || !HAS_HAN.test(t) || /[/|()（）［］[\]]/.test(t) || out.includes(t)) continue;
    out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}

/** Validate a stored objects list: every object fine, ids unique, at most the cap. */
export function validateHuntObjects(objects: HuntObject[]): string[] {
  const problems: string[] = [];
  if (objects.length === 0) problems.push('No objects were found in the picture');
  if (objects.length > PICTURE_HUNT_MAX_OBJECTS) problems.push(`At most ${PICTURE_HUNT_MAX_OBJECTS} objects`);
  const ids = new Set<string>();
  const hanzi = new Set<string>();
  for (const obj of objects) {
    if (ids.has(obj.id)) problems.push(`Duplicate id ${obj.id}`);
    ids.add(obj.id);
    if (hanzi.has(obj.hanzi)) problems.push(`Two objects are both called ${obj.hanzi}`);
    hanzi.add(obj.hanzi);
    problems.push(...huntObjectProblems(obj));
  }
  return problems;
}

/** A play upload, cleaned; null when it is unusable. found_ids are kept only if they exist. */
export function sanitizeHuntPlay(raw: unknown, objectIds: Set<string> | null): PictureHuntPlay | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== 'string' || !p.id || p.id.length > 64) return null;
  if (typeof p.hunt_id !== 'string' || !p.hunt_id) return null;
  const found = Array.isArray(p.found_ids)
    ? Array.from(new Set(p.found_ids.filter((x): x is string => typeof x === 'string' && (!objectIds || objectIds.has(x)))))
    : [];
  const total = isFiniteNumber(p.total) ? Math.max(0, Math.round(p.total)) : objectIds?.size ?? found.length;
  const playedAt = typeof p.played_at === 'string' && !Number.isNaN(Date.parse(p.played_at)) ? new Date(p.played_at).toISOString() : new Date().toISOString();
  return {
    id: p.id,
    hunt_id: p.hunt_id,
    found_ids: found,
    total: Math.max(total, found.length),
    hints_used: isFiniteNumber(p.hints_used) ? Math.max(0, Math.min(999, Math.round(p.hints_used))) : 0,
    gave_up: p.gave_up === true,
    duration_ms: isFiniteNumber(p.duration_ms) ? Math.max(0, Math.min(24 * 3600_000, Math.round(p.duration_ms))) : 0,
    played_at: playedAt,
  };
}
