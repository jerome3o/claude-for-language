/**
 * useChatReadMarker: opening a chat reads it up to the newest message — a system row
 * included — even when the chat is closed again before the debounce (Jerome, Oct 2026).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const markConversationRead = vi.fn((_id: string, _upTo?: string) => Promise.resolve({}));
vi.mock('../api/client', () => ({ markConversationRead: (id: string, upTo?: string) => markConversationRead(id, upTo) }));

import { newestCreatedAt, readToSendOnLeave, useChatReadMarker } from './chatNotifications';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SYSTEM_ROW = { id: 'sys', created_at: '2026-10-23T14:00:46.462Z', system_kind: 'call_started' };
const OLDER = { id: 'old', created_at: '2026-10-21T15:41:01.584Z', system_kind: null };

function Chat({ id, messages }: { id: string; messages: Array<{ created_at: string }> }) {
  useChatReadMarker(id, newestCreatedAt(messages));
  return null;
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  markConversationRead.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  vi.useRealTimers();
  host.remove();
});

describe('useChatReadMarker', () => {
  it('reads up to the newest message when it is a system row', () => {
    act(() => root.render(<Chat id="conv" messages={[OLDER, SYSTEM_ROW]} />));
    act(() => void vi.advanceTimersByTime(900));
    expect(markConversationRead).toHaveBeenCalledWith('conv', SYSTEM_ROW.created_at);
    act(() => root.unmount());
    expect(markConversationRead).toHaveBeenCalledTimes(1); // nothing left to send on leave
  });

  it('a glance shorter than the debounce still reads the chat', () => {
    act(() => root.render(<Chat id="conv" messages={[OLDER, SYSTEM_ROW]} />));
    act(() => void vi.advanceTimersByTime(300));
    expect(markConversationRead).not.toHaveBeenCalled();
    act(() => root.unmount());
    expect(markConversationRead).toHaveBeenCalledWith('conv', SYSTEM_ROW.created_at);
  });

  it('closed before the messages loaded: reads everything (no up_to)', () => {
    act(() => root.render(<Chat id="conv" messages={[]} />));
    act(() => root.unmount());
    expect(markConversationRead).toHaveBeenCalledWith('conv', undefined);
  });

  it('switching chats reads the one being left, not the next one', () => {
    act(() => root.render(<Chat id="a" messages={[SYSTEM_ROW]} />));
    act(() => root.render(<Chat id="b" messages={[OLDER]} />));
    expect(markConversationRead).toHaveBeenCalledWith('a', SYSTEM_ROW.created_at);
    expect(markConversationRead).not.toHaveBeenCalledWith('b', expect.anything());
    act(() => root.unmount());
  });
});

describe('readToSendOnLeave', () => {
  it('sends what is newer, everything when nothing was sent, else nothing', () => {
    expect(readToSendOnLeave('b', null)).toEqual({ upTo: 'b' });
    expect(readToSendOnLeave('b', 'a')).toEqual({ upTo: 'b' });
    expect(readToSendOnLeave('b', 'b')).toBeNull();
    expect(readToSendOnLeave(null, null)).toEqual({});
    expect(readToSendOnLeave(null, 'a')).toBeNull();
  });
});
