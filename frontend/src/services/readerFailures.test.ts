import { describe, it, expect } from 'vitest';
import { partitionReaders, friendlyReaderError, failedReadersLabel } from './readerFailures';

const r = (id: string, status: 'ready' | 'generating' | 'failed') => ({ id, status });

describe('partitionReaders', () => {
  it('keeps ready and generating readers in place and folds every failure away', () => {
    const { active, failed } = partitionReaders([
      r('a', 'ready'),
      r('b', 'failed'),
      r('c', 'generating'),
      r('d', 'failed'),
    ]);
    expect(active.map(x => x.id)).toEqual(['a', 'c']);
    expect(failed.map(x => x.id)).toEqual(['b', 'd']);
  });

  it('returns empty groups for an empty list', () => {
    expect(partitionReaders([])).toEqual({ active: [], failed: [] });
  });

  it('handles a list that is only failures (the 38-dead-cards case)', () => {
    const many = Array.from({ length: 38 }, (_, i) => r(`f${i}`, 'failed' as const));
    const { active, failed } = partitionReaders(many);
    expect(active).toHaveLength(0);
    expect(failed).toHaveLength(38);
  });
});

describe('friendlyReaderError', () => {
  it('never echoes the raw API text', () => {
    const raw = 'Could not resolve authentication method. Expected either apiKey or authToken to be set.';
    const friendly = friendlyReaderError(raw);
    expect(friendly).not.toContain('apiKey');
    expect(friendly).not.toContain('authToken');
    expect(friendly).toMatch(/AI service/);
  });

  it('recognises timeouts', () => {
    expect(friendlyReaderError('Generation timed out after 30 minutes')).toMatch(/too long/);
  });

  it('recognises rate limits and overload', () => {
    expect(friendlyReaderError('429 Too Many Requests')).toMatch(/busy/);
    expect(friendlyReaderError('overloaded_error')).toMatch(/busy/);
  });

  it('recognises the not-enough-vocabulary case', () => {
    expect(friendlyReaderError('Not enough learned vocabulary. Please study more cards first.')).toMatch(/learned words/);
  });

  it('falls back to a generic sentence for anything else, including no message', () => {
    expect(friendlyReaderError('TypeError: cannot read property x of undefined')).toMatch(/Something went wrong/);
    expect(friendlyReaderError(null)).toBe("Couldn't write this one.");
    expect(friendlyReaderError('')).toBe("Couldn't write this one.");
  });
});

describe('failedReadersLabel', () => {
  it('pluralises', () => {
    expect(failedReadersLabel(1)).toBe('1 failed generation');
    expect(failedReadersLabel(38)).toBe('38 failed generations');
  });
});
