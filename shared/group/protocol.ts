/**
 * The group class room's WebSocket messages (EXPERIMENTAL; worker
 * durable/group-room.ts ⇄ frontend services/group/). Separate from the 1:1
 * call protocol (shared/calls/protocol.ts) on purpose: the prototype must not
 * change the 1:1 calls. The text board reuses the 1:1 board's CRDT ops
 * (shared/calls/textDoc.ts) and message shapes, so the same client session
 * class (`TextBoardSession`) drives it.
 */

import type { CallChatMessage, TextCursor, TextDocSnapshot, TextOp, TextSelection } from '../calls';
import type { GroupControl, GroupPeer, GroupPeerState, GroupRoomState } from './room';
import type { GroupQuizView, QuizSpec } from './quiz';

export type GroupClientMessage =
  | { type: 'signal'; to: string; data: unknown }
  | { type: 'state'; state: GroupPeerState }
  | { type: 'control'; control: GroupControl }
  | { type: 'text'; ops: TextOp[] }
  | { type: 'text_cursor'; sel: TextSelection | null; compose?: string | null }
  | { type: 'chat'; text: string }
  | { type: 'quiz_start'; quiz: QuizSpec }
  | { type: 'quiz_answer'; quiz_id: string; choice: number }
  | { type: 'quiz_reveal'; quiz_id: string }
  | { type: 'quiz_close' }
  | { type: 'ping'; t: number }
  | { type: 'leave' }
  | { type: 'end' };

export type GroupServerMessage =
  | {
      type: 'welcome';
      client_id: string;
      server_time: number;
      started_at: number;
      tutor_id: string;
      me: GroupPeer;
      peers: GroupPeer[];
      room: GroupRoomState;
      chat: CallChatMessage[];
      text: TextDocSnapshot;
      text_cursors: TextCursor[];
      quiz: GroupQuizView | null;
      leave_token: string;
    }
  | { type: 'peer_joined'; peer: GroupPeer }
  | { type: 'peer_left'; client_id: string }
  | { type: 'peer_state'; client_id: string; state: GroupPeerState }
  | { type: 'signal'; from: string; data: unknown }
  | { type: 'room'; room: GroupRoomState; by?: string; control?: GroupControl['kind'] }
  | { type: 'text'; from: string; ops: TextOp[] }
  | ({ type: 'text_cursor' } & TextCursor)
  | { type: 'chat'; message: CallChatMessage }
  | { type: 'quiz'; quiz: GroupQuizView | null }
  | { type: 'pong'; t: number; server_time: number }
  | { type: 'ended'; by: string | null }
  | { type: 'replaced' }
  | { type: 'error'; message: string };
