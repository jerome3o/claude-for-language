/**
 * Guard: ONE "mastered" and ONE "due" in the server's SQL (shared/progress/cardSql.ts,
 * services/study-queue.ts). Fails when worker or MCP-server code goes back to
 *   - `interval > 21` / `interval >= 21` for mastered (use MASTERED_CARD_SQL: Review + stability > 21 d);
 *   - "no next review OR due by now" for due — that counts every NEW card as due (use the study
 *     queue for "due today", `reviewDueSql` / the queue's reviews_due for reviews).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../..');
const DIRS = ['worker/src', 'mcp-server/src'];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'ui') continue;
      out.push(...sources(p));
    } else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('app-html.ts')) {
      out.push(p);
    }
  }
  return out;
}

const RULES: Array<{ name: string; re: RegExp }> = [
  { name: 'mastered by interval (use MASTERED_CARD_SQL)', re: /\binterval\s*>=?\s*21\b/i },
  { name: 'every NEW card counted as due (use the study queue / reviewDueSql)', re: /next_review_at\s+IS\s+NULL\s+OR\b/i },
];

describe('one mastered, one due', () => {
  it('no worker / MCP source uses another definition', () => {
    const offenders: string[] = [];
    const files = DIRS.flatMap((d) => sources(path.join(ROOT, d)));
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const r of RULES) if (r.re.test(line)) offenders.push(`${path.relative(ROOT, file)}:${i + 1} — ${r.name}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
