/**
 * Performance guards for unit tests that don't flake on a busy machine.
 *
 * A wall-clock budget ("10k notes in < 100 ms") fails whenever CI runs the suite next to other
 * jobs. What the tests really guard against is an accidental O(n²) — so they compare the same code
 * at two sizes, interleaved, and take each size's FASTEST run (load only ever adds time, so the
 * minimum is the most stable estimate). Linear / n log n work at 4× the size takes ~4–8× as long;
 * quadratic takes ~16×. A machine that is uniformly slow slows both sizes and the ratio holds.
 *
 * The absolute budgets are still useful on a quiet machine: they are checked only with
 * PERF_BUDGETS=1 (e.g. `PERF_BUDGETS=1 npx vitest run shared/decks`).
 */

/** Fastest of `rounds` runs of each function, interleaved round by round (after one warm-up each). */
export function fastestTimes(fns: Array<() => unknown>, rounds = 9): number[] {
  fns.forEach((f) => f());
  const best = fns.map(() => Infinity);
  for (let r = 0; r < rounds; r++) {
    fns.forEach((f, i) => {
      const t0 = performance.now();
      f();
      best[i] = Math.min(best[i], performance.now() - t0);
    });
  }
  return best;
}

/**
 * Growth ceiling for 4× the input: n log n measures ~4–8× (the small size suffers relatively more
 * from GC / JIT noise on a busy box), quadratic ~16×.
 */
export const MAX_GROWTH_AT_4X = 12;

/** The opt-in absolute budgets (PERF_BUDGETS=1). */
export const checkPerfBudgets = (): boolean =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.PERF_BUDGETS === '1';
