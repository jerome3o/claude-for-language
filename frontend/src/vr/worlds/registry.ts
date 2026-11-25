/**
 * Every VR world (docs/VR_WORLDS.md "Adding a world"): ONE line per world — its picker card (meta.ts,
 * no 3D code) and a lazy loader for the definition (its own chunk, downloaded when you enter it).
 * `registry.test.ts` loads each one and runs the shared validator on it.
 */
import type { WorldDefinition, WorldMeta } from './types';
import { kitchenMeta } from './kitchen/meta';
import { airportMeta } from './airport/meta';
import { homeMeta } from './home/meta';
import { marketMeta } from './market/meta';

export interface WorldEntry {
  meta: WorldMeta;
  load(): Promise<{ default: WorldDefinition }>;
}

export const WORLDS: readonly WorldEntry[] = [
  { meta: kitchenMeta, load: () => import('./kitchen') },
  { meta: homeMeta, load: () => import('./home') },
  { meta: airportMeta, load: () => import('./airport') },
  { meta: marketMeta, load: () => import('./market') },
];

export function worldEntry(id: string): WorldEntry | undefined {
  return WORLDS.find((w) => w.meta.id === id);
}
