/**
 * The VR world contract (docs/VR_WORLDS.md "The contract"): a world folder exports ONE
 * `WorldDefinition` as its default export — the shared data (`WorldSpec`, shared/vr-worlds/types.ts:
 * objects with their Chinese words, zones, tasks) plus how it looks and sounds.
 *
 *   frontend/src/vr/worlds/<id>/meta.ts    WorldMeta (title, blurb, thumbnail, counts) — the picker reads only this
 *   frontend/src/vr/worlds/<id>/index.tsx  export default defineWorld({ …spec, Scene, objects with models, lighting, ambience })
 *   frontend/src/vr/worlds/registry.ts     one line per world
 */
import type { ComponentType } from 'react';
import type { WorldObjectSpec, WorldSpec } from '@shared/vr-worlds';
import type { LightingPreset } from './kit/lighting';

/** What an object's model is told each render (a fridge door swings with `states.door`). */
export interface ModelProps {
  states: Readonly<Record<string, string>>;
}

/**
 * An object's look: a component drawn in the object's own frame (origin = the collider's centre, so a
 * cup of `collider: { cylinder: [0.04, 0.1] }` is drawn from y −0.05 to +0.05), or a CC0 glTF file
 * under /vr/worlds/<id>/ (scaled / offset to fit the collider).
 */
export type WorldModel = ComponentType<ModelProps> | { gltf: string; scale?: number; offset?: [number, number, number] };

export interface WorldObjectDef extends WorldObjectSpec {
  model: WorldModel;
  /** Sound loops while a state holds: { 'water=on': 'water' } (a running tap). Names are /vr/sfx/ files. */
  loops?: Record<string, string>;
}

/** Ambience loops (frontend/public/vr/sfx/amb-<id>.mp3, made by scripts/audio/generate-vr-sfx.mjs). */
export const AMBIENCES = ['kitchen', 'house', 'street', 'restaurant', 'airport', 'apartment', 'city', 'none'] as const;
export type AmbienceId = (typeof AMBIENCES)[number];

export interface WorldDefinition extends WorldSpec {
  objects: WorldObjectDef[];
  lighting: LightingPreset;
  /** Metres across the shadow map covers, around the origin (default 8). */
  shadowArea?: number;
  ambience: AmbienceId;
  /** The static world: room, decor, signs — and `<Solid>` colliders for whatever things should bump into. */
  Scene: ComponentType;
}

/** The picker's card (no 3D code: loaded with the picker, the world itself loads on entry). */
export interface WorldMeta {
  id: string;
  title_zh: string;
  title_en: string;
  blurb: string;
  /** /vr/worlds/<id>/thumb.jpg (a flat-preview screenshot, ~640×360). */
  thumbnail: string;
  /** Shown before the world loads; registry.test.ts checks it matches the definition. */
  taskCount: number;
  objectCount: number;
  /** One emoji for the card while the thumbnail loads. */
  emoji: string;
}

/** Identity helper with the type spelled out (and a place for future defaults). */
export function defineWorld(def: WorldDefinition): WorldDefinition {
  return def;
}
