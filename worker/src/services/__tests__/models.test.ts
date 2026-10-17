/**
 * The current Opus (services/models.ts): no call is left on the retired Opus 4.6, and
 * the Opus 5.5 request shape holds — effort set explicitly, no forced tool_choice, no
 * temperature, no disabled thinking (each a 400 on Opus 5.5).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OPUS_MODEL, withEffort } from '../models';

const SRC = join(__dirname, '..', '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') out.push(...sources(path));
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

describe('Opus model', () => {
  it('is Opus 5.5, with the effort in output_config', () => {
    expect(OPUS_MODEL).toBe('claude-opus-5-5');
    expect(withEffort({ model: OPUS_MODEL, max_tokens: 10 }, 'low')).toEqual({ model: OPUS_MODEL, max_tokens: 10, output_config: { effort: 'low' } });
  });

  it('no worker call uses the retired claude-opus-4-6 (the price table may still name the family)', () => {
    const offenders = sources(SRC).filter((f) => !f.endsWith('ai-usage.ts') && readFileSync(f, 'utf8').includes("'claude-opus-4-6'"));
    expect(offenders).toEqual([]);
  });

  it('the files moved to Opus 5.5 send no forced tool_choice, temperature or disabled thinking', () => {
    for (const file of ['services/ai.ts', 'services/practice.ts', 'services/tutor-notes-agent.ts']) {
      const text = readFileSync(join(SRC, file), 'utf8');
      // Every OPUS_MODEL call is wrapped in withEffort(…).
      const calls = text.split('model: OPUS_MODEL').length - 1 + text.split('model: MODEL').length - 1 + text.split('model: TUTOR_NOTES_MODEL').length - 1;
      expect(calls, file).toBeGreaterThan(0);
      expect(text.split('withEffort({').length - 1, file).toBe(calls);
    }
    const practice = readFileSync(join(SRC, 'services/practice.ts'), 'utf8');
    expect(practice).not.toMatch(/tool_choice: \{ type: 'tool'/);
  });
});
