import { describe, it, expect } from 'vitest';
import { validateLessonSpec } from './validate';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Check for the 把/被 seed lesson (migration 0058): the exact JSON embedded
// in the migration must be a valid spec. Tests run with cwd=frontend.
describe('seed lesson spec', () => {
  it('validates the 把 vs 被 lesson', () => {
    const sql = readFileSync(resolve(process.cwd(), '../worker/src/db/migrations/0058_seed_ba_bei_lesson.sql'), 'utf8');
    const match = sql.match(/'(\{"title".*\})'/s);
    expect(match).toBeTruthy();
    const spec = JSON.parse(match![1]);
    expect(validateLessonSpec(spec)).toEqual([]);
  });
});
