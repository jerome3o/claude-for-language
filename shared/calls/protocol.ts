/**
 * Messages between the call page and the call room (a Durable Object that
 * relays WebRTC signalling, holds the whiteboard and the in-call chat).
 * Media itself goes peer to peer; only these small JSON messages go through
 * the room.
 */

import type { BoardItem, BoardOp, BoardPoint } from './board';

export interface CallPeer {
  client_id: string;
  user_id: string;
  name: string;
  picture_url: string | null;
  state: PeerMediaState;
}

export interface PeerMediaState {
  mic: boolean;
  cam: boolean;
  screen: boolean;
  recording: boolean;
}

export interface CallChatMessage {
  id: string;
  user_id: string;
  name: string;
  text: string;
  at: number;
}

export interface LiveStroke {
  id: string;
  color: string;
  width: number;
  points: BoardPoint[];
}

/** Client → room. */
export type ClientMessage =
  | { type: 'signal'; to: string; data: unknown }
  | { type: 'board'; op: BoardOp }
  | { type: 'board_live'; stroke: LiveStroke | null }
  | { type: 'chat'; text: string }
  | { type: 'state'; state: PeerMediaState }
  | { type: 'ping'; t: number }
  | { type: 'end' };

/** Room → client. */
export type ServerMessage =
  | {
      type: 'welcome';
      client_id: string;
      server_time: number;
      started_at: number;
      peers: CallPeer[];
      board: BoardItem[];
      chat: CallChatMessage[];
    }
  | { type: 'peer_joined'; peer: CallPeer }
  | { type: 'peer_left'; client_id: string }
  | { type: 'peer_state'; client_id: string; state: PeerMediaState }
  | { type: 'signal'; from: string; data: unknown }
  | { type: 'board'; op: BoardOp }
  | { type: 'board_live'; from: string; stroke: LiveStroke | null }
  | { type: 'chat'; message: CallChatMessage }
  | { type: 'pong'; t: number; server_time: number }
  | { type: 'ended'; by: string }
  | { type: 'replaced' }
  | { type: 'error'; message: string };

export const MAX_CHAT_LENGTH = 1000;
export const MAX_CHAT_MESSAGES = 500;
/** Two people per call (tutor + student); a third connection is refused. */
export const MAX_CALL_PEERS = 2;
