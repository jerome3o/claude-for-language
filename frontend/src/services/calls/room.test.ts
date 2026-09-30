import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendLeaveBeacon = vi.fn(() => true);
vi.mock('../../api/calls', () => ({
  joinCall: vi.fn(async () => ({ ticket: 't', ws_path: '/api/calls/c1/ws', ice_servers: [], turn: false })),
  callSocketUrl: () => 'wss://example.test/api/calls/c1/ws?ticket=t',
  sendLeaveBeacon: (...a: unknown[]) => sendLeaveBeacon(...(a as [])),
}));

import { CallRoomSocket } from './room';

class FakeWs {
  static last: FakeWs | null = null;
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeWs.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code: number) {
    this.closedWith = code;
    this.readyState = 3;
  }
}

describe('CallRoomSocket leaving', () => {
  const realWs = globalThis.WebSocket;
  beforeEach(() => {
    (globalThis as { WebSocket: unknown }).WebSocket = FakeWs;
    sendLeaveBeacon.mockClear();
  });
  afterEach(() => {
    (globalThis as { WebSocket: unknown }).WebSocket = realWs;
  });

  async function openRoom() {
    const room = new CallRoomSocket('c1', { onMessage: () => {}, onStatus: () => {}, onFatal: () => {} });
    await room.connect();
    const ws = FakeWs.last!;
    ws.readyState = 1;
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify({ type: 'welcome', client_id: 'client-1', server_time: Date.now(), started_at: 0, peers: [], board: [], chat: [], leave_token: 'secret' }) });
    return { room, ws };
  }

  it('Leave tells the room "leave" before closing (the other side stops seeing me as calling at once)', async () => {
    const { room, ws } = await openRoom();
    room.close();
    expect(ws.sent.map((s) => JSON.parse(s).type)).toContain('leave');
    expect(ws.closedWith).toBe(1000);
    expect(sendLeaveBeacon).not.toHaveBeenCalled();
    room.close(); // twice is harmless
    expect(ws.sent.filter((s) => JSON.parse(s).type === 'leave')).toHaveLength(1);
  });

  it('closing the tab (pagehide) also sends the leave beacon with the room’s token', async () => {
    const { room } = await openRoom();
    room.close({ beacon: true });
    expect(sendLeaveBeacon).toHaveBeenCalledWith('c1', 'client-1', 'secret');
  });
});
