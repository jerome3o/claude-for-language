import { describe, expect, it } from 'vitest';

/**
 * An effect written `useEffect(() => something(), deps)` returns whatever
 * `something()` returns, and React keeps it as the effect's cleanup: on the
 * next run / unmount it CALLS it. A value that isn't a function then throws
 * ("n is not a function" in the production build) during the commit, and the
 * page's error boundary takes the whole screen down.
 *
 * That is what broke video calls on 5 Oct 2026: the role-play activity had
 * `useEffect(() => el?.scrollIntoView(…), [round])`, and newer Chrome returns a
 * Promise from the scroll methods — every new line of the role-play crashed
 * the call ("Couldn't open the call — n is not a function").
 *
 * Rule: an effect's body is a block, unless the expression is known to return
 * the cleanup function itself (a `subscribe(…)` that returns its unsubscribe,
 * a hold that returns its release, or a cleanup function passed directly).
 */

const sources = import.meta.glob<string>(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Concise-body effects whose expression returns the cleanup function. */
const RETURNS_CLEANUP = [/^\(\)\s*=>/, /^[\w.]*subscribe\(/, /^holdNativeOutput\(\)/, /^stop,/];

describe('effect cleanups', () => {
  it('found the sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it('no effect returns a value that is not its cleanup (e.g. a Promise from scrollIntoView)', () => {
    const bad: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      const re = /use(?:Layout|Insertion)?Effect\(\s*\(\)\s*=>(?!\s*\{)\s*([^\n]*)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const expr = m[1].trim();
        if (RETURNS_CLEANUP.some((r) => r.test(expr))) continue;
        const line = text.slice(0, m.index).split('\n').length;
        bad.push(`${file}:${line}  ${m[0].trim().slice(0, 120)}`);
      }
    }
    expect(bad, 'Use a block body: useEffect(() => { …; }, deps)').toEqual([]);
  });
});
