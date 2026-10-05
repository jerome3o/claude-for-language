/**
 * Messages between the call page and the call room (a Durable Object that
 * relays WebRTC signalling, holds the whiteboard and the in-call chat).
 * Media itself goes peer to peer; only these small JSON messages go through
 * the room.
 */

import type { BoardItem, BoardOp, BoardPoint } from './board';
import type { TextDocSnapshot, TextOp, TextSelection } from './textDoc';
import type { AnnotStroke, AnnotText, KeptAnnotations } from './annotate';
import type { PresentedMaterial } from '../materials';
import type { ActivityAction, ActivitySession } from '../call-activities/types';
import type { CallDiagEvent } from './connection';
import type { BoardPageMeta } from './pages';
import type { ShowView, ShownState } from './follow';
import type { SharedView, StageView, ViewMode } from './view';

export interface CallPeer {
  client_id: string;
  user_id: string;
  name: string;
  picture_url: string | null;
  state: PeerMediaState;
  /**
   * One per page load / app session (the socket URL's `instance`). A peer whose
   * socket dropped and came back with the SAME instance is the same WebRTC
   * connection — keep it (and its picture) instead of starting over. Absent
   * from older clients.
   */
  instance?: string;
}

export interface PeerMediaState {
  mic: boolean;
  cam: boolean;
  screen: boolean;
  /** My share carries sound (a tab's / the system's; ./share.ts). Only with `screen`; absent = no sound. */
  screen_audio?: boolean;
  recording: boolean;
  /** "Same view" or "My own view" (./view.ts; absent from an older app = same). */
  view?: ViewMode;
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
  /**
   * What they are composing in a pinyin IME right now (not yet in the text) —
   * shown next to their caret so their typing is visible before they commit.
   */
  compose?: string | null;
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
  /**
   * Edits to the shared text (site = "<my user id>:<random>", the same for the whole page load).
   * `page`: the board page they belong to (absent from older clients = the call's opening page).
   */
  | { type: 'text'; ops: TextOp[]; page?: string }
  | { type: 'text_cursor'; sel: TextSelection | null; compose?: string | null; page?: string }
  /** Board pages (./pages.ts): look at a page (the room answers with `page_doc`). */
  | { type: 'page_open'; page: string }
  /** A new page at the end / a copy right after `page`; the room opens it for the sender. */
  | { type: 'page_new' }
  | { type: 'page_duplicate'; page: string }
  | { type: 'page_rename'; page: string; title: string | null }
  /** Refused for the last page left. */
  | { type: 'page_delete'; page: string }
  /** "Bring <name> here": move the other person to this page. */
  | { type: 'page_summon'; page: string }
  /** Connection events for the call's diagnostics log (shared/calls/connection.ts). */
  | { type: 'diag'; events: CallDiagEvent[] }
  /** Drawing on the other person's shared screen (relayed, never stored). */
  /** `target` (round 4): absent = the shared screen; `material:<id>:<page>` = a presented material's page. */
  | { type: 'annot'; stroke: AnnotStroke; target?: string }
  | { type: 'annot_clear'; target?: string }
  /** Place / edit / move a text box on the shared screen (round 4). */
  | { type: 'annot_text'; text: AnnotText; target?: string }
  | { type: 'annot_text_delete'; id: string; target?: string }
  | { type: 'annot_ping'; x: number; y: number; target?: string }
  /** Lesson materials (round 4): present one (both see it; page turns are shared), turn its page, stop. */
  | { type: 'material_open'; material_id: string; page?: number }
  | { type: 'material_page'; page: number }
  | { type: 'material_close' }
  /**
   * In-call activities (shared/call-activities): start one from the catalogue (replaces any
   * running one), act in the running one (`session_id` must match), close it (its result is kept
   * with the lesson). The room runs the state machine and answers with `activity` to everyone.
   */
  | { type: 'activity_start'; activity_id: string }
  | { type: 'activity_action'; session_id: string; action: ActivityAction }
  | { type: 'activity_close'; session_id?: string }
  /** Keep drawings on the shared screen (true) or let them fade (false) — one setting for both. */
  | { type: 'annot_mode'; persist: boolean }
  | { type: 'chat'; text: string }
  /**
   * Round 5 (shared/calls/follow.ts), the relationship's tutor only: put `view` on the student's
   * stage (null = stop showing). `follow` = an automatic follow-up of what is shown (her board page
   * turned) — the same show, not a new one.
   */
  | { type: 'show'; view: ShowView | null; follow?: boolean }
  /**
   * "Same view" (./view.ts): my stage changed — the room makes it the shared view and tells
   * everyone (me included). `cid` identifies this change; `bring` = "Bring <name> to my view".
   */
  | { type: 'view'; view: StageView; cid: string; bring?: boolean }
  /** The tutor stops the other person's screen share (refused for anyone else). */
  | { type: 'stop_share' }
  | { type: 'state'; state: PeerMediaState }
  | { type: 'ping'; t: number }
  /** I'm leaving (the call goes on for the other person): I stop counting as present at once. */
  | { type: 'leave' }
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
      /** Drawings on a shared screen are kept rather than fading (absent = fade). */
      annot_persist?: boolean;
      /** Drawings and texts on a shared screen the room kept (round 4; only while kept). */
      annots?: KeptAnnotations;
      /** A lesson material being presented (round 4), and its current page's kept drawings / text. */
      material?: PresentedMaterial | null;
      material_annots?: { target: string; annots: KeptAnnotations } | null;
      /** The in-call activity being played (absent / null = none). */
      activity?: ActivitySession | null;
      /** Board pages of the relationship, in strip order (absent from an older room). */
      pages?: BoardPageMeta[];
      /** The page `text` is — the one this call opened on. */
      page?: string;
      /** Which page each other client is looking at. */
      page_views?: Record<string, string>;
      /**
       * Secret for `POST /api/calls/:id/leave` { client_id, token } — the page's
       * sendBeacon on pagehide, which can't carry the session header.
       */
      leave_token?: string;
      /** The relationship's tutor (null = a solo call; absent from an older room). Leads "Show for student" / "Stop their share". */
      tutor_id?: string | null;
      /** What the tutor last showed (shared/calls/follow.ts; older apps). */
      shown?: ShownState | null;
      /** The shared view (./view.ts): what is on the stage for everyone on "Same view" (null = nobody set one yet). */
      view?: SharedView | null;
    }
  | { type: 'peer_joined'; peer: CallPeer }
  | { type: 'peer_left'; client_id: string }
  | { type: 'peer_state'; client_id: string; state: PeerMediaState }
  | { type: 'signal'; from: string; data: unknown }
  | { type: 'board'; op: BoardOp }
  | { type: 'board_live'; from: string; stroke: LiveStroke | null }
  | { type: 'text'; from: string; ops: TextOp[]; page?: string }
  | ({ type: 'text_cursor'; page?: string } & TextCursor)
  /** The page list changed (new / renamed / duplicated / deleted / moved). */
  | { type: 'pages'; pages: BoardPageMeta[] }
  /** The page I asked for (page_open, or one I just made): its document and the carets on it. */
  | { type: 'page_doc'; page: string; text: TextDocSnapshot; text_cursors: TextCursor[] }
  /** Someone now looks at `page`. */
  | { type: 'page_view'; client_id: string; page: string }
  /** A page's thumbnail text changed (sent at most every few hundred ms). */
  | { type: 'page_preview'; page: string; preview: string; chars: number; updated_at: number }
  /** `page` was deleted; whoever was on it goes to `fallback`. */
  | { type: 'page_deleted'; page: string; fallback: string; by: string }
  /** The other person brought me to `page`. */
  | { type: 'page_summon'; from: string; name: string; page: string }
  | { type: 'annot'; from: string; name: string; stroke: AnnotStroke; target?: string }
  | { type: 'annot_clear'; from: string; target?: string }
  | { type: 'annot_text'; from: string; name: string; text: AnnotText; target?: string }
  | { type: 'annot_text_delete'; from: string; id: string; target?: string }
  | { type: 'annot_ping'; from: string; name: string; x: number; y: number; target?: string }
  /** What is being presented now (null = nothing), after an open / page turn / close. */
  | { type: 'material'; presenting: PresentedMaterial | null; from?: string; name?: string }
  /** The kept drawings / text of a material page (on opening or turning to it). */
  | { type: 'material_annots'; target: string; annots: KeptAnnotations }
  | { type: 'annot_mode'; from: string; name: string; persist: boolean }
  /** The in-call activity after a start / action / close (null = closed). `from` = the client whose message caused it. */
  | { type: 'activity'; session: ActivitySession | null; from?: string; name?: string }
  | { type: 'chat'; message: CallChatMessage }
  /** What the tutor shows now (after a `show`). */
  | { type: 'shown'; shown: ShownState | null }
  /** The shared view changed (after a `view`, or an older app's `show`). */
  | { type: 'view'; view: SharedView }
  /** To the person sharing: the tutor stopped your screen share — stop capturing. */
  | { type: 'share_stopped'; by: string; name: string }
  | { type: 'pong'; t: number; server_time: number }
  | { type: 'ended'; by: string }
  | { type: 'replaced' }
  | { type: 'error'; message: string };

export const MAX_CHAT_LENGTH = 1000;
export const MAX_CHAT_MESSAGES = 500;
/** Two people per call (tutor + student); a third connection is refused. */
export const MAX_CALL_PEERS = 2;
