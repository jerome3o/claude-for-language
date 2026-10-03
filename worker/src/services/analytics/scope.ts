/**
 * The request (or queue / cron) scope analytics reads deep inside services
 * without threading parameters: env, the signed-in user, the route pattern and
 * `waitUntil`, so a write never delays the response. AsyncLocalStorage
 * (compatibility flag `nodejs_als`). Outside a scope everything degrades to
 * "nothing recorded" — analytics never breaks a call path.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Env } from '../../types';

export interface AnalyticsScope {
  env: Env;
  userId: string | null;
  /** Route pattern (`/api/decks/:id`), the queue name or `cron`. */
  route: string | null;
  waitUntil?: (p: Promise<unknown>) => void;
}

const storage = new AsyncLocalStorage<AnalyticsScope>();

export function runInScope<T>(scope: AnalyticsScope, fn: () => T): T {
  return storage.run(scope, fn);
}

export function currentScope(): AnalyticsScope | undefined {
  return storage.getStore();
}

/** Keeps a background write alive past the response when we can; never throws. */
export function keepAlive(p: Promise<unknown>): void {
  const guarded = p.catch((err) => console.warn('[analytics] write failed:', err instanceof Error ? err.message : err));
  try {
    currentScope()?.waitUntil?.(guarded);
  } catch {
    // waitUntil after the response finished in tests / odd runtimes
  }
}
