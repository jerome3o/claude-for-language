/**
 * Runs public/push-sw.js against a fake service-worker `self`: chat pushes are
 * shown unless that chat is open in front (same rule as chatOpenInFront), call
 * pushes behave as before.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { chatOpenInFront } from './chatNotifications';

const SW = readFileSync(resolve(__dirname, '../../public/push-sw.js'), 'utf8');
const ORIGIN = 'https://app.example';

interface FakeClient { url: string; focused: boolean; visibilityState: string; messages: unknown[]; postMessage: (m: unknown) => void }

function client(path: string, focused = true, visibilityState = 'visible'): FakeClient {
  const c: FakeClient = { url: ORIGIN + path, focused, visibilityState, messages: [], postMessage: (m) => c.messages.push(m) };
  return c;
}

async function push(data: Record<string, unknown>, clients: FakeClient[]) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; },
    clients: { matchAll: async () => clients },
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); } },
  };
  new Function('self', SW)(self);
  let done: Promise<unknown> = Promise.resolve();
  listeners.push({ data: { json: () => data, text: () => '' }, waitUntil: (p: Promise<unknown>) => { done = p; } });
  await done;
  return shown;
}

const chat = {
  type: 'chat_message',
  title: '王老师',
  body: '你今天学习了吗？',
  url: '/connections/rel1/chat/conv1',
  tag: 'chat-conv1',
  conversation_id: 'conv1',
  relationship_id: 'rel1',
};

describe('push-sw.js chat_message', () => {
  it('shows one notification per conversation with the sender', async () => {
    const tabs = [client('/decks')];
    const shown = await push({ ...chat, sender_picture_url: 'https://pics.example/w.jpg' }, tabs);
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('王老师');
    expect(shown[0].options).toMatchObject({
      body: '你今天学习了吗？',
      tag: 'chat-conv1',
      renotify: true,
      icon: 'https://pics.example/w.jpg',
      badge: '/badge-72.png',
      data: { url: '/connections/rel1/chat/conv1', conversation_id: 'conv1' },
    });
    expect(tabs[0].messages).toEqual([{ type: 'push', data: { ...chat, sender_picture_url: 'https://pics.example/w.jpg' } }]);
  });

  it('falls back to the app icon', async () => {
    const shown = await push(chat, []);
    expect(shown[0].options.icon).toBe('/icon-192.png');
  });

  it('is skipped when that chat is open in a focused, visible tab — matching chatOpenInFront', async () => {
    const cases: FakeClient[][] = [
      [client('/connections/rel1/chat/conv1')],
      [client('/connections/rel1/chat/conv1', false)],
      [client('/connections/rel1/chat/conv1', true, 'hidden')],
      [client('/connections/rel1/chat/conv2')],
      [client('/'), client('/connections/rel1/chat/conv1')],
    ];
    for (const tabs of cases) {
      const shown = await push(chat, tabs);
      expect(shown.length === 0).toBe(chatOpenInFront(chat, tabs));
    }
    expect(await push(chat, cases[0])).toHaveLength(0);
    expect(await push(chat, cases[1])).toHaveLength(1);
  });
});

describe('push-sw.js calls (unchanged)', () => {
  const call = { type: 'call', call_id: 'c1', title: '📹 王老师 is calling', body: 'Tap to join', url: '/calls/c1', tag: 'call-c1' };
  it('rings with a Join action when nothing is in front', async () => {
    const shown = await push(call, [client('/study')]);
    expect(shown).toHaveLength(1);
    expect(shown[0].options).toMatchObject({ renotify: true, requireInteraction: true, icon: '/icon-192.png', actions: [{ action: 'join', title: 'Join' }] });
  });
  it('is skipped on a normal page in front (the app rings itself)', async () => {
    expect(await push(call, [client('/decks')])).toHaveLength(0);
  });
});
