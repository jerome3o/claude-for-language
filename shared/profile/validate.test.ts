import { describe, it, expect } from 'vitest';
import { pickProfileUpdate, isValidTimeZone, localTimeLabel, localTimeIn, normalizeName, timeZoneCity, PROFILE_LIMITS } from './validate';

describe('pickProfileUpdate', () => {
  it('only returns the keys that were sent', () => {
    expect(pickProfileUpdate({ name: 'Minghui' })).toEqual({ update: { name: 'Minghui' }, problems: [] });
    expect(pickProfileUpdate({})).toEqual({ update: {}, problems: [] });
    expect(pickProfileUpdate(null)).toEqual({ update: {}, problems: [] });
  });

  it('normalises the name to one clean line', () => {
    expect(pickProfileUpdate({ name: '  王​老师 \n (Minghui)  ' }).update.name).toBe('王老师 (Minghui)');
  });

  it('null name means "use my Google name"; empty is a problem', () => {
    expect(pickProfileUpdate({ name: null }).update).toEqual({ name: null });
    const r = pickProfileUpdate({ name: '   ' });
    expect(r.update).toEqual({});
    expect(r.problems[0]).toMatch(/empty/);
  });

  it('rejects a name over the limit, counting characters not UTF-16 units', () => {
    expect(pickProfileUpdate({ name: '王'.repeat(PROFILE_LIMITS.name) }).problems).toEqual([]);
    expect(pickProfileUpdate({ name: '😀'.repeat(PROFILE_LIMITS.name) }).problems).toEqual([]);
    expect(pickProfileUpdate({ name: 'a'.repeat(PROFILE_LIMITS.name + 1) }).problems[0]).toMatch(/at most 60/);
  });

  it('keeps line breaks in About me, collapses runs of blank lines, blank → null', () => {
    expect(pickProfileUpdate({ about: 'Hi!\r\n\r\n\r\n\r\nI teach HSK 1–4.  ' }).update.about).toBe('Hi!\n\nI teach HSK 1–4.');
    expect(pickProfileUpdate({ about: '  \n ' }).update.about).toBeNull();
    expect(pickProfileUpdate({ bio: null }).update.bio).toBeNull();
  });

  it('does not silently cut long text', () => {
    const r = pickProfileUpdate({ bio: 'x'.repeat(501), about: 'y'.repeat(501) });
    expect(r.update).toEqual({});
    expect(r.problems).toEqual(['Bio must be at most 500 characters', 'About me must be at most 500 characters']);
  });

  it('checks types', () => {
    expect(pickProfileUpdate({ name: 3, bio: [], about: {}, time_zone: 5 }).problems).toHaveLength(4);
  });

  it('accepts IANA zones and clears with null or empty', () => {
    expect(pickProfileUpdate({ time_zone: 'Asia/Shanghai' }).update.time_zone).toBe('Asia/Shanghai');
    expect(pickProfileUpdate({ time_zone: 'UTC' }).update.time_zone).toBe('UTC');
    expect(pickProfileUpdate({ time_zone: '' }).update.time_zone).toBeNull();
    expect(pickProfileUpdate({ time_zone: null }).update.time_zone).toBeNull();
    expect(pickProfileUpdate({ time_zone: 'Mars/Olympus_Mons' }).problems[0]).toMatch(/IANA/);
    expect(pickProfileUpdate({ time_zone: '../../etc' }).problems).toHaveLength(1);
  });
});

describe('time zone helpers', () => {
  it('validates zones', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('names the city', () => {
    expect(timeZoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(timeZoneCity('UTC')).toBe('UTC');
  });

  it('formats the local time in the zone', () => {
    const now = new Date('2026-09-27T13:04:00Z');
    expect(localTimeIn('Asia/Shanghai', now)).toBe('9:04 pm');
    expect(localTimeIn('UTC', now)).toBe('1:04 pm');
    expect(localTimeLabel('Asia/Shanghai', now)).toBe('9:04 pm in Shanghai');
    expect(localTimeLabel(null, now)).toBeNull();
    expect(localTimeLabel('Bogus/Zone', now)).toBeNull();
  });

  it('normalizeName strips controls and newlines', () => {
    expect(normalizeName('A\u0000B\nC')).toBe('AB C');
  });
});
