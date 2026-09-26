/**
 * Video calls (experimental). Mounted under /api in index.ts after the auth
 * middleware — except the WebSocket, which authenticates with a join ticket
 * and is registered before it (see mountCallSocket).
 *
 *   GET    /calls/ice-servers                         STUN (+ TURN when configured)
 *   GET    /calls?relationship_id=&live=1             my calls, newest first
 *   POST   /calls                                     { relationship_id?, title? } → 201 call
 *   GET    /calls/:id                                 call + participants + pieces + transcript + report
 *   DELETE /calls/:id                                 the creator deletes a call and its audio
 *   POST   /calls/:id/join                            → { ticket, ws_path, ice_servers }
 *   POST   /calls/:id/end                             end for everyone (idempotent)
 *   POST   /calls/:id/pieces                          register a recording piece { id, piece_index, started_at, mime_type }
 *   PUT    /calls/:id/pieces/:pieceId/chunks/:idx     raw audio bytes
 *   POST   /calls/:id/pieces/:pieceId/close           { chunk_count, duration_ms }
 *   POST   /calls/:id/process                         "Process now": close stale pieces, retry failures, redo the report
 *   POST   /calls/:id/flashcards                      { deck_id? | deck_name?, words: [...] } → notes made from the report
 *   GET    /calls/:id/ws?ticket=                      WebSocket into the CallRoom
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import * as content from '../services/content';
import { ContentError } from '../services/content';
import { mergeTranscript, type BoardItem, type CallChatMessage } from '@shared/calls';
import {
  CallError,
  createCall,
  deleteCallRows,
  getParticipants,
  listCalls,
  markCallEnded,
  requireCall,
} from '../services/calls/store';
import { closePiece, forceClosePieces, listPieces, registerPiece, storeChunk } from '../services/calls/recording';
import { advanceCallProcessing, reprocessCall } from '../services/calls/processing';
import { createJoinTicket, verifyJoinTicket } from '../services/calls/ticket';
import { getIceServers } from '../services/calls/ice';
import { pickTranscriber } from '../services/calls/transcribe';
import type { CallReport, CallReportWord } from '../services/calls/report';

const calls = new Hono<{ Bindings: Env }>();

function errorResponse(c: { json: (body: unknown, status?: number) => Response }, error: unknown, fallback: string): Response {
  if (error instanceof CallError) return c.json({ error: error.message }, error.status);
  if (error instanceof ContentError) return c.json({ error: error.message, problems: error.problems }, error.status as 400);
  console.error('[calls]', error);
  return c.json({ error: fallback }, 500);
}

function frontendOrigin(req: Request): string {
  const origin = req.headers.get('Origin');
  if (origin && /^https?:\/\//.test(origin)) return origin;
  return req.url.startsWith('https') ? 'https://chinese-learning-2x9.pages.dev' : 'http://localhost:3000';
}

calls.get('/calls/ice-servers', async (c) => c.json(await getIceServers(c.env)));

calls.get('/calls', async (c) => {
  try {
    const list = await listCalls(c.env.DB, c.get('user').id, {
      relationshipId: c.req.query('relationship_id') || undefined,
      liveOnly: c.req.query('live') === '1',
    });
    return c.json({ calls: list });
  } catch (error) {
    return errorResponse(c, error, 'Failed to load calls');
  }
});

calls.post('/calls', async (c) => {
  try {
    if (!c.env.CALL_ROOM) throw new CallError(503, 'Video calls are not set up on this server');
    const body = await c.req.json<{ relationship_id?: string | null; title?: string | null }>().catch(() => ({}));
    const origin = frontendOrigin(c.req.raw);
    const call = await createCall(c.env.DB, c.get('user').id, body, { joinUrl: (id) => `${origin}/calls/${id}` });
    return c.json({ call }, 201);
  } catch (error) {
    return errorResponse(c, error, 'Failed to start the call');
  }
});

calls.get('/calls/:id', async (c) => {
  try {
    const call = await requireCall(c.env.DB, c.req.param('id'), c.get('user').id);
    const [participants, pieces, segments] = await Promise.all([
      getParticipants(c.env.DB, call),
      listPieces(c.env.DB, call.id),
      c.env.DB
        .prepare('SELECT id, piece_id, user_id, start_ms, end_ms, text, language, pinyin, translation FROM call_transcript_segments WHERE call_id = ? ORDER BY start_ms')
        .bind(call.id)
        .all(),
    ]);
    const { board_json, chat_json, summary_json, ...rest } = call;
    return c.json({
      call: rest,
      participants,
      board: board_json ? (JSON.parse(board_json) as BoardItem[]) : [],
      chat: chat_json ? (JSON.parse(chat_json) as CallChatMessage[]) : [],
      report: summary_json ? (JSON.parse(summary_json) as CallReport) : null,
      pieces: pieces.map((p) => ({
        id: p.id,
        user_id: p.user_id,
        piece_index: p.piece_index,
        started_at: p.started_at,
        duration_ms: p.duration_ms,
        status: p.status,
        error: p.error,
        provider: p.provider,
        audio_url: p.audio_key ? `/api/audio/${p.audio_key}` : null,
      })),
      transcript: mergeTranscript((segments.results ?? []) as Array<{ id: string; start_ms: number; end_ms: number }>),
      transcriber: pickTranscriber(c.env),
    });
  } catch (error) {
    return errorResponse(c, error, 'Failed to load the call');
  }
});

calls.delete('/calls/:id', async (c) => {
  try {
    const user = c.get('user');
    const call = await requireCall(c.env.DB, c.req.param('id'), user.id);
    if (call.created_by !== user.id) throw new CallError(403, 'Only the person who started the call can delete it');
    if (call.status === 'live' && c.env.CALL_ROOM) {
      await c.env.CALL_ROOM.get(c.env.CALL_ROOM.idFromName(call.id)).end(call.id, user.id);
    }
    const keys = await deleteCallRows(c.env.DB, call.id);
    for (let i = 0; i < keys.length; i += 500) await c.env.AUDIO_BUCKET.delete(keys.slice(i, i + 500));
    return c.json({ ok: true });
  } catch (error) {
    return errorResponse(c, error, 'Failed to delete the call');
  }
});

calls.post('/calls/:id/join', async (c) => {
  try {
    const user = c.get('user');
    const call = await requireCall(c.env.DB, c.req.param('id'), user.id);
    if (call.status !== 'live') throw new CallError(409, 'This call has ended');
    const [ticket, ice] = await Promise.all([createJoinTicket(c.env, call.id, user.id), getIceServers(c.env)]);
    return c.json({ ticket, ws_path: `/api/calls/${call.id}/ws`, ice_servers: ice.iceServers, turn: ice.turn });
  } catch (error) {
    return errorResponse(c, error, 'Failed to join the call');
  }
});

calls.post('/calls/:id/end', async (c) => {
  try {
    const user = c.get('user');
    const call = await requireCall(c.env.DB, c.req.param('id'), user.id);
    if (call.status === 'live') {
      if (c.env.CALL_ROOM) await c.env.CALL_ROOM.get(c.env.CALL_ROOM.idFromName(call.id)).end(call.id, user.id);
      else {
        await markCallEnded(c.env.DB, call.id);
        await advanceCallProcessing(c.env, call.id);
      }
    }
    return c.json({ ok: true });
  } catch (error) {
    return errorResponse(c, error, 'Failed to end the call');
  }
});

calls.post('/calls/:id/pieces', async (c) => {
  try {
    const user = c.get('user');
    const call = await requireCall(c.env.DB, c.req.param('id'), user.id);
    const piece = await registerPiece(c.env.DB, call, user.id, await c.req.json());
    return c.json({ piece: { id: piece.id, status: piece.status } });
  } catch (error) {
    return errorResponse(c, error, 'Failed to register the recording');
  }
});

calls.put('/calls/:id/pieces/:pieceId/chunks/:idx', async (c) => {
  try {
    const user = c.get('user');
    const call = await requireCall(c.env.DB, c.req.param('id'), user.id);
    const body = await c.req.arrayBuffer();
    const piece = await storeChunk(c.env, call, user.id, c.req.param('pieceId'), Number(c.req.param('idx')), body);
    if (piece.status === 'ready') c.executionCtx.waitUntil(advanceCallProcessing(c.env, call.id));
    return c.json({ ok: true, status: piece.status });
  } catch (error) {
    return errorResponse(c, error, 'Failed to upload the recording');
  }
});

calls.post('/calls/:id/pieces/:pieceId/close', async (c) => {
  try {
    const user = c.get('user');
    const call = await requireCall(c.env.DB, c.req.param('id'), user.id);
    const piece = await closePiece(c.env.DB, call, user.id, c.req.param('pieceId'), await c.req.json());
    c.executionCtx.waitUntil(advanceCallProcessing(c.env, call.id));
    return c.json({ ok: true, status: piece.status });
  } catch (error) {
    return errorResponse(c, error, 'Failed to close the recording');
  }
});

calls.post('/calls/:id/process', async (c) => {
  try {
    const user = c.get('user');
    const call = await requireCall(c.env.DB, c.req.param('id'), user.id);
    if (call.status === 'live') throw new CallError(409, 'End the call first');
    const closed = await forceClosePieces(c.env.DB, call.id);
    await reprocessCall(c.env, call.id, { pieces: true, report: true });
    return c.json({ ok: true, closed });
  } catch (error) {
    return errorResponse(c, error, 'Failed to process the call');
  }
});

calls.post('/calls/:id/flashcards', async (c) => {
  try {
    const user = c.get('user');
    const call = await requireCall(c.env.DB, c.req.param('id'), user.id);
    const body = await c.req.json<{ deck_id?: string; deck_name?: string; words?: CallReportWord[] }>();
    const words = (body.words ?? []).filter((w) => w && w.hanzi && w.pinyin && w.english).slice(0, 100);
    if (words.length === 0) throw new CallError(400, 'Pick at least one word');
    let deckId = body.deck_id;
    if (deckId) {
      const deck = await c.env.DB.prepare('SELECT id FROM decks WHERE id = ? AND user_id = ?').bind(deckId, user.id).first();
      if (!deck) throw new CallError(404, 'Deck not found');
    } else {
      const date = new Date(call.started_at ?? Date.now()).toISOString().slice(0, 10);
      const name = (body.deck_name || '').trim().slice(0, 120) || `Lesson ${date}`;
      deckId = (await content.createDeck(c.env.DB, user.id, { name, description: call.title ? `From the video lesson "${call.title}"` : 'From a video lesson' })).id;
    }
    const made = await content.createNotes(
      c.env,
      user.id,
      deckId,
      words.map((w) => ({
        hanzi: w.hanzi,
        pinyin: w.pinyin,
        english: w.english,
        fun_facts: w.fun_facts,
        sentence_clue: w.sentence_clue,
        sentence_clue_pinyin: w.sentence_clue_pinyin,
        sentence_clue_translation: w.sentence_clue_translation,
      })),
      { audio: 'background', sentences: true, bg: c.executionCtx },
    );
    return c.json({ deck_id: deckId, created: made.created.length, failed: made.failed }, 201);
  } catch (error) {
    return errorResponse(c, error, 'Failed to make the flashcards');
  }
});

export default calls;

/** The WebSocket route — registered BEFORE the auth middleware (it uses a join ticket instead). */
export function mountCallSocket(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/calls/:id/ws', async (c) => {
    if (c.req.header('Upgrade') !== 'websocket') return c.json({ error: 'Expected a WebSocket' }, 426);
    if (!c.env.CALL_ROOM) return c.json({ error: 'Video calls are not set up on this server' }, 503);
    const callId = c.req.param('id');
    const claims = await verifyJoinTicket(c.env, c.req.query('ticket'), callId);
    if (!claims) return c.json({ error: 'Unauthorized' }, 401);
    const user = await c.env.DB
      .prepare('SELECT id, name, email, picture_url FROM users WHERE id = ?')
      .bind(claims.userId)
      .first<{ id: string; name: string | null; email: string; picture_url: string | null }>();
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const headers = new Headers(c.req.raw.headers);
    headers.set('X-Call-Id', callId);
    headers.set('X-User-Id', user.id);
    headers.set('X-User-Name', encodeURIComponent(user.name || user.email.split('@')[0]));
    if (user.picture_url) headers.set('X-User-Picture', user.picture_url);
    const stub = c.env.CALL_ROOM.get(c.env.CALL_ROOM.idFromName(callId));
    return stub.fetch(new Request(c.req.raw.url, { headers }));
  });
}
