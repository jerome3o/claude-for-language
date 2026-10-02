/**
 * ChatHub — one Durable Object per user (idFromName(userId)) holding every
 * live chat socket that user has open: web tabs, the Lab app in the
 * foreground (docs/CHAT.md §4). WebSocket Hibernation API, so an idle hub
 * costs nothing.
 *
 * The worker authenticates the socket with a `live` ticket and passes the
 * user in `X-User-Id`; the hub trusts it because only the worker can reach it.
 *
 *   worker → hub   RPC broadcast(event)                     → every socket
 *   client → hub   {"type":"ping"}                          → {"type":"pong"}
 *                  {"type":"typing","conversation_id"}      → the other participant's hub
 *   hub → client   hello · message · message_updated · read · typing
 */

import { DurableObject } from 'cloudflare:workers';
import { CLAUDE_AI_USER_ID, type Env } from '../types';

interface Attachment {
  connId: string;
  userId: string;
  /** Epoch ms of the last typing frame forwarded from this socket. */
  typedAt?: number;
}

/** More sockets than this for one person: the oldest is closed. */
export const MAX_HUB_SOCKETS = 20;
/** A socket's typing frames are forwarded at most this often. */
export const TYPING_FORWARD_MS = 1500;
const MAX_FRAME = 2000;
/** Conversation → its two participants (null = not a human chat), kept for this long. */
const MEMBERSHIP_TTL_MS = 10 * 60_000;

export class ChatHub extends DurableObject<Env> {
  private members = new Map<string, { users: [string, string] | null; at: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Pings answered without waking the object.
    try {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
    } catch {
      /* not available (tests) */
    }
  }

  private sockets(): Array<{ ws: WebSocket; a: Attachment | null }> {
    return this.ctx.getWebSockets().map((ws) => {
      let a: Attachment | null = null;
      try {
        a = ws.deserializeAttachment() as Attachment | null;
      } catch {
        a = null;
      }
      return { ws, a };
    });
  }

  private send(ws: WebSocket, event: unknown): boolean {
    try {
      ws.send(JSON.stringify(event));
      return true;
    } catch {
      return false;
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const userId = request.headers.get('X-User-Id') || '';
    if (!userId) return new Response('Missing user', { status: 400 });

    // Keep the newest sockets: a phone that dropped off without closing doesn't pile up forever.
    const open = this.sockets();
    if (open.length >= MAX_HUB_SOCKETS) {
      for (const { ws } of open.slice(0, open.length - MAX_HUB_SOCKETS + 1)) {
        try {
          ws.close(4002, 'Too many connections');
        } catch {
          /* already gone */
        }
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: Attachment = { connId: crypto.randomUUID(), userId };
    this.ctx.acceptWebSocket(server, [attachment.connId]);
    server.serializeAttachment(attachment);
    this.send(server, { type: 'hello', user_id: userId, server_time: new Date().toISOString() });
    return new Response(null, { status: 101, webSocket: client });
  }

  /** RPC from the worker: send `event` to every open socket. Returns how many got it. */
  async broadcast(event: unknown): Promise<number> {
    let sent = 0;
    for (const { ws } of this.sockets()) if (this.send(ws, event)) sent++;
    return sent;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > MAX_FRAME) return;
    let frame: { type?: unknown; conversation_id?: unknown };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!frame || typeof frame !== 'object') return;
    if (frame.type === 'ping') {
      this.send(ws, { type: 'pong' });
      return;
    }
    if (frame.type === 'typing' && typeof frame.conversation_id === 'string' && /^[\w-]{1,64}$/.test(frame.conversation_id)) {
      let a: Attachment | null = null;
      try {
        a = ws.deserializeAttachment() as Attachment | null;
      } catch {
        a = null;
      }
      if (!a?.userId) return;
      const now = Date.now();
      if (a.typedAt && now - a.typedAt < TYPING_FORWARD_MS) return;
      a.typedAt = now;
      try {
        ws.serializeAttachment(a);
      } catch {
        /* closed */
      }
      await this.forwardTyping(a.userId, frame.conversation_id);
    }
  }

  private async participants(conversationId: string): Promise<[string, string] | null> {
    const cached = this.members.get(conversationId);
    if (cached && Date.now() - cached.at < MEMBERSHIP_TTL_MS) return cached.users;
    const row = await this.env.DB
      .prepare(
        `SELECT r.requester_id, r.recipient_id, r.status, c.is_ai_conversation
           FROM conversations c JOIN tutor_relationships r ON r.id = c.relationship_id
          WHERE c.id = ?`,
      )
      .bind(conversationId)
      .first<{ requester_id: string; recipient_id: string; status: string; is_ai_conversation: number | null }>();
    const users: [string, string] | null =
      row && row.status === 'active' && !row.is_ai_conversation ? [row.requester_id, row.recipient_id] : null;
    if (this.members.size > 200) this.members.clear();
    this.members.set(conversationId, { users, at: Date.now() });
    return users;
  }

  private async forwardTyping(userId: string, conversationId: string): Promise<void> {
    try {
      const users = await this.participants(conversationId);
      if (!users || !users.includes(userId)) return;
      const other = users[0] === userId ? users[1] : users[0];
      if (!other || other === userId || other === CLAUDE_AI_USER_ID) return;
      const stub = this.env.CHAT_HUB.get(this.env.CHAT_HUB.idFromName(other));
      await stub.broadcast({ type: 'typing', conversation_id: conversationId, user_id: userId });
    } catch (err) {
      console.error('[chat-hub] typing forward failed:', err);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close(1000, 'Closed');
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, 'Error');
    } catch {
      /* already closed */
    }
  }
}
