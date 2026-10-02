import { describe, expect, it } from 'vitest';
import { MAX_CRASHES_PER_UPLOAD, MAX_TRACE_CHARS, parseCrashUpload } from '../crash-reports';

describe('parseCrashUpload', () => {
  it('keeps the Lab crash shape, trims traces and defaults the app version', () => {
    const r = parseCrashUpload({
      client: 'lab',
      app_version: '0.361',
      device: 'Google Pixel 10 Pro Fold · Android 16',
      crashes: [
        { id: 'freeze-1-2', source: 'freeze', at: '2026-10-02T08:00:00.000Z', thread: 'main', trace: 'x'.repeat(MAX_TRACE_CHARS + 50) },
        { id: 'exit-5-77', source: 'exit_info', at: '2026-10-02T07:59:00.000Z', reason: 'anr', description: 'Input dispatching timed out', importance: 100 },
      ],
    });
    if ('error' in r) throw new Error(r.error);
    expect(r.client).toBe('lab');
    expect(r.crashes).toHaveLength(2);
    expect(r.crashes[0].trace).toHaveLength(MAX_TRACE_CHARS);
    expect(r.crashes[0].app_version).toBe('0.361');
    expect(r.crashes[1]).toMatchObject({ id: 'exit-5-77', reason: 'anr', description: 'Input dispatching timed out', trace: null });
  });

  it('refuses bodies without crashes and caps the batch', () => {
    expect('error' in parseCrashUpload(null)).toBe(true);
    expect('error' in parseCrashUpload({ crashes: [] })).toBe(true);
    const many = parseCrashUpload({ crashes: Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, source: 'uncaught', trace: 't' })) });
    if ('error' in many) throw new Error(many.error);
    expect(many.crashes).toHaveLength(MAX_CRASHES_PER_UPLOAD);
  });
});
