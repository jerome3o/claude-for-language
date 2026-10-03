import { describe, expect, it } from 'vitest';
import { chatBackTarget } from './chatBack';

describe('chatBackTarget', () => {
  it('returns to the inbox when opened from it', () => {
    expect(chatBackTarget({ from: '/chats' }, 'r1')).toBe('/chats');
  });
  it('otherwise the person page', () => {
    expect(chatBackTarget(null, 'r1')).toBe('/connections/r1');
    expect(chatBackTarget({ from: '/elsewhere' }, 'r1')).toBe('/connections/r1');
    expect(chatBackTarget(undefined, undefined)).toBe('/chats');
  });
});
