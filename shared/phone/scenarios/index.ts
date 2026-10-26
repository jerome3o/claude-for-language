/** The bundled scenarios, easy → hard within each app (docs/PHONE_PRACTICE.md). */
import type { ScenarioSpec } from '../types';
import { CHAT_SCENARIOS } from './chat';
import { DINE_SCENARIOS } from './dine';
import { FOOD_SCENARIOS } from './food';
import { MOVIE_SCENARIOS } from './movie';
import { RAIL_SCENARIOS } from './rail';
import { RIDE_SCENARIOS } from './ride';

export const BUNDLED_SCENARIOS: ScenarioSpec[] = [...RAIL_SCENARIOS, ...RIDE_SCENARIOS, ...FOOD_SCENARIOS, ...CHAT_SCENARIOS, ...MOVIE_SCENARIOS, ...DINE_SCENARIOS];

export function bundledScenario(id: string): ScenarioSpec | null {
  return BUNDLED_SCENARIOS.find((s) => s.id === id) ?? null;
}

export { RAIL_SCENARIOS, RIDE_SCENARIOS, FOOD_SCENARIOS, CHAT_SCENARIOS, MOVIE_SCENARIOS, DINE_SCENARIOS };
