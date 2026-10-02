import { describe, it, expect, beforeEach } from 'vitest';
import {
  chatOpenInFront,
  chatPathOf,
  chatNotificationTag,
  newestCreatedAt,
  shouldSendRead,
  chatNudgeDismissed,
  dismissChatNudge,
} from './chatNotifications';

const url = '/connections/rel1/chat/conv1';
const front = (u: string) => ({ url: u, focused: true, visibilityState: 'visible' });

describe('chatOpenInFront', () => {
  it('is true when a focused, visible tab is on that chat', () => {
    expect(chatOpenInFront({ url }, [front('https://app.example/connections/rel1/chat/conv1')])).toBe(true);
    expect(chatOpenInFront({ url }, [front('https://app.example/connections/rel1/chat/conv1/?x=1#y')])).toBe(true);
  });
  it('is false for another chat, another page, or a background / hidden tab', () => {
    expect(chatOpenInFront({ url }, [front('https://app.example/connections/rel1/chat/conv2')])).toBe(false);
    expect(chatOpenInFront({ url }, [front('https://app.example/connections/rel1')])).toBe(false);
    expect(chatOpenInFront({ url }, [{ url: 'https://app.example' + url, focused: false, visibilityState: 'visible' }])).toBe(false);
    expect(chatOpenInFront({ url }, [{ url: 'https://app.example' + url, focused: true, visibilityState: 'hidden' }])).toBe(false);
    expect(chatOpenInFront({ url }, [])).toBe(false);
  });
  it('is false without a url', () => {
    expect(chatOpenInFront({}, [front('https://app.example/')])).toBe(false);
    expect(chatOpenInFront(null, [front('https://app.example/')])).toBe(false);
  });
});

describe('helpers', () => {
  it('chatPathOf normalises', () => {
    expect(chatPathOf('/a/b/')).toBe('/a/b');
    expect(chatPathOf('https://x.dev/')).toBe('/');
  });
  it('tag', () => expect(chatNotificationTag('c9')).toBe('chat-c9'));
  it('newestCreatedAt', () => {
    expect(newestCreatedAt([])).toBeNull();
    expect(newestCreatedAt([{ created_at: '2026-10-02T10:00:00.000Z' }, { created_at: '2026-10-02T11:00:00.000Z' }, { created_at: '2026-10-01T23:00:00.000Z' }])).toBe('2026-10-02T11:00:00.000Z');
  });
  it('shouldSendRead only moves forward', () => {
    expect(shouldSendRead(null, null)).toBe(false);
    expect(shouldSendRead('b', null)).toBe(true);
    expect(shouldSendRead('b', 'b')).toBe(false);
    expect(shouldSendRead('a', 'b')).toBe(false);
    expect(shouldSendRead('c', 'b')).toBe(true);
  });
});

describe('nudge dismissal', () => {
  beforeEach(() => localStorage.clear());
  it('is remembered', () => {
    expect(chatNudgeDismissed()).toBe(false);
    dismissChatNudge();
    expect(chatNudgeDismissed()).toBe(true);
  });
});
