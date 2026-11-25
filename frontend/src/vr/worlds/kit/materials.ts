/**
 * PBR material presets for VR worlds (docs/VR_WORLDS.md "The helper library"). `mat('wood', '#a0703c')`
 * returns ONE shared MeshStandardMaterial per preset + colour (+ options), so a hundred chopsticks cost
 * one material. The world's environment map (lighting.tsx: three's RoomEnvironment, generated in
 * code) gives metal and glass their reflections; nothing is downloaded.
 *
 * Don't mutate a returned material (it is shared): ask for another colour / option instead.
 */
import { Color, DoubleSide, MeshStandardMaterial, type Texture } from 'three';
import { noiseTexture, plankTexture, tileTexture, woodTexture } from './textures';

export type MatPreset =
  | 'wood' | 'wood_planks' | 'painted' | 'metal' | 'steel' | 'chrome' | 'ceramic' | 'glass' | 'plastic' | 'rubber'
  | 'fabric' | 'paper' | 'plaster' | 'tile' | 'stone' | 'food' | 'leaf' | 'glow' | 'liquid';

export interface MatOptions {
  /** Texture repeat (wood / planks / tile / plaster). */
  repeat?: [number, number];
  /** Tiles per texture (tile). */
  tiles?: number;
  /** Grout colour (tile). */
  grout?: string;
  /** A ready texture to use as the colour map (labels, signs) — the colour then tints it. */
  map?: Texture;
  /** Visible from both sides (thin shells: a bowl, a lampshade). */
  doubleSide?: boolean;
  /** Override roughness / metalness. */
  roughness?: number;
  metalness?: number;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
}

const cache = new Map<string, MeshStandardMaterial>();

const BASE: Record<MatPreset, { color: string; roughness: number; metalness: number; opacity?: number; emissive?: string }> = {
  wood: { color: '#a87447', roughness: 0.62, metalness: 0 },
  wood_planks: { color: '#9c7550', roughness: 0.7, metalness: 0 },
  painted: { color: '#e8e2d6', roughness: 0.55, metalness: 0 },
  metal: { color: '#9aa1a8', roughness: 0.38, metalness: 0.9 },
  steel: { color: '#c9ced4', roughness: 0.25, metalness: 1 },
  chrome: { color: '#e9edf2', roughness: 0.08, metalness: 1 },
  ceramic: { color: '#f4f1ea', roughness: 0.18, metalness: 0 },
  glass: { color: '#d8ecf2', roughness: 0.04, metalness: 0, opacity: 0.32 },
  plastic: { color: '#3b7ff2', roughness: 0.42, metalness: 0 },
  rubber: { color: '#2b2b2b', roughness: 0.9, metalness: 0 },
  fabric: { color: '#7b8fa8', roughness: 0.95, metalness: 0 },
  paper: { color: '#f2ede1', roughness: 0.9, metalness: 0 },
  plaster: { color: '#efe9de', roughness: 0.95, metalness: 0 },
  tile: { color: '#e9e6df', roughness: 0.3, metalness: 0 },
  stone: { color: '#9a958d', roughness: 0.85, metalness: 0 },
  food: { color: '#d64535', roughness: 0.45, metalness: 0 },
  leaf: { color: '#4f8f3a', roughness: 0.7, metalness: 0 },
  glow: { color: '#fff4d6', roughness: 1, metalness: 0, emissive: '#fff1cc' },
  liquid: { color: '#f7f7f2', roughness: 0.15, metalness: 0 },
};

export function mat(preset: MatPreset, color?: string, opts: MatOptions = {}): MeshStandardMaterial {
  const key = `${preset}|${color ?? ''}|${JSON.stringify({ ...opts, map: opts.map?.uuid })}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const b = BASE[preset];
  const c = color ?? b.color;
  let map: Texture | undefined = opts.map;
  if (!map) {
    if (preset === 'wood') map = woodTexture(c, opts.repeat);
    else if (preset === 'wood_planks') map = plankTexture(c, opts.repeat);
    else if (preset === 'tile') map = tileTexture(c, opts.grout ?? '#b9b4aa', opts.tiles ?? 4, opts.repeat);
    else if (preset === 'plaster' || preset === 'stone' || preset === 'fabric' || preset === 'paper') map = noiseTexture(c, preset === 'stone' ? 0.12 : 0.05, opts.repeat);
  }
  const opacity = opts.opacity ?? b.opacity;
  const m = new MeshStandardMaterial({
    // A colour map carries the colour itself; the material colour then stays white (no double tint).
    color: map && !opts.map ? new Color('#ffffff') : new Color(c),
    map: map ?? null,
    roughness: opts.roughness ?? b.roughness,
    metalness: opts.metalness ?? b.metalness,
    transparent: opacity !== undefined && opacity < 1,
    opacity: opacity ?? 1,
    depthWrite: opacity === undefined || opacity >= 1,
    ...(opts.doubleSide || preset === 'glass' ? { side: DoubleSide } : {}),
    emissive: new Color(opts.emissive ?? b.emissive ?? '#000000'),
    emissiveIntensity: opts.emissiveIntensity ?? (b.emissive || opts.emissive ? 1 : 0),
  });
  m.name = `vr-world:${preset}`;
  cache.set(key, m);
  return m;
}
