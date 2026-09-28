/**
 * Messages between the call page and the call room (a Durable Object that
 * relays WebRTC signalling, holds the whiteboard and the in-call chat).
 * Media itself goes peer to peer; only these small JSON messages go through
 * the room.
 */

import type { BoardItem, BoardOp, BoardPoint } from './board';
import type { TextDocSnapshot, TextOp, TextSelection } from './textDoc';
import type { AnnotStroke } from './annotate';

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

/** Someone's caret / selection on the shared text board. */
export interface TextCursor {
  client_id: string;
  user_id: string;
  name: string;
  sel: TextSelection | null;
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
  /** Edits to the shared text (site = "<my user id>:<random>", the same for the whole page load). */
  | { type: 'text'; ops: TextOp[] }
  | { type: 'text_cursor'; sel: TextSelection | null }
  /** Drawing on the other person's shared screen (relayed, never stored). */
  | { type: 'annot'; stroke: AnnotStroke }
  | { type: 'annot_clear' }
  | { type: 'annot_ping'; x: number; y: number }
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
      /** The shared text board (absent from an older room). */
      text?: TextDocSnapshot;
      text_cursors?: TextCursor[];
    }
  | { type: 'peer_joined'; peer: CallPeer }
  | { type: 'peer_left'; client_id: string }
  | { type: 'peer_state'; client_id: string; state: PeerMediaState }
  | { type: 'signal'; from: string; data: unknown }
  | { type: 'board'; op: BoardOp }
  | { type: 'board_live'; from: string; stroke: LiveStroke | null }
  | { type: 'text'; from: string; ops: TextOp[] }
  | ({ type: 'text_cursor' } & TextCursor)
  | { type: 'annot'; from: string; name: string; stroke: AnnotStroke }
  | { type: 'annot_clear'; from: string }
  | { type: 'annot_ping'; from: string; name: string; x: number; y: number }
  | { type: 'chat'; message: CallChatMessage }
  | { type: 'pong'; t: number; server_time: number }
  | { type: 'ended'; by: string }
  | { type: 'replaced' }
  | { type: 'error'; message: string };

export const MAX_CHAT_LENGTH = 1000;
export const MAX_CHAT_MESSAGES = 500;
/** Two people per call (tutor + student); a third connection is refused. */
export const MAX_CALL_PEERS = 2;
