/**
 * The video-call recording upload queue (IndexedDB `callUploads`).
 *
 * The recorder never talks to the network: it appends register / chunk /
 * close ops here, and `drainCallUploads` sends them in order — every few
 * seconds during the call, then from every sync, so a lesson recorded on a
 * bad connection (or a closed tab) still arrives. Ops are idempotent on the
 * server, so a retry after a lost response is harmless.
 */

import { db, type LocalCallUpload } from '../../db/database';
import { closePiece, registerPiece, uploadChunk } from '../../api/calls';

/** Give up on an op after this many HTTP 4xx answers (the call was deleted, a bad chunk). */
const MAX_CLIENT_ERRORS = 3;

let draining: Promise<DrainResult> | null = null;

export interface DrainResult {
  sent: number;
  remaining: number;
  error?: string;
}

export async function enqueueCallUpload(op: LocalCallUpload): Promise<void> {
  await db.callUploads.add(op);
}

export async function pendingCallUploads(callId?: string): Promise<number> {
  return callId ? db.callUploads.where('call_id').equals(callId).count() : db.callUploads.count();
}

async function send(op: LocalCallUpload): Promise<void> {
  switch (op.kind) {
    case 'register':
      await registerPiece(op.call_id, { id: op.piece_id, piece_index: op.piece_index, started_at: op.started_at, mime_type: op.mime_type });
      return;
    case 'chunk':
      await uploadChunk(op.call_id, op.piece_id, op.idx, op.blob);
      return;
    case 'close':
      await closePiece(op.call_id, op.piece_id, { chunk_count: op.chunk_count, duration_ms: op.duration_ms });
      return;
  }
}

async function drainOnce(): Promise<DrainResult> {
  let sent = 0;
  for (;;) {
    const op = await db.callUploads.orderBy('seq').first();
    if (!op) return { sent, remaining: 0 };
    try {
      await send(op);
      await db.callUploads.delete(op.seq!);
      sent++;
    } catch (err) {
      const status = (err as { status?: number }).status;
      const message = err instanceof Error ? err.message : String(err);
      if (status && status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429) {
        const attempts = (op.attempts ?? 0) + 1;
        if (attempts >= MAX_CLIENT_ERRORS) {
          console.warn('[calls] dropping upload op after repeated errors:', op.kind, message);
          await db.callUploads.delete(op.seq!);
          continue;
        }
        await db.callUploads.update(op.seq!, { attempts });
      }
      // Network error / server error / auth: stop and try again on the next drain.
      return { sent, remaining: await db.callUploads.count(), error: message };
    }
  }
}

/** Send everything queued, in order. Concurrent callers share one run. */
export function drainCallUploads(): Promise<DrainResult> {
  if (!draining) {
    draining = drainOnce().finally(() => {
      draining = null;
    });
  }
  return draining;
}

/**
 * Pieces left open by a tab that was closed mid-call: queue their close with
 * the chunks this device did save, so the server can transcribe them.
 * `activeCallId` is the call on screen right now (its pieces are still live).
 */
export async function closeOrphanPieces(activeCallId?: string | null): Promise<number> {
  const open = await db.callPieces.where('status').equals('open').toArray();
  let closed = 0;
  for (const piece of open) {
    if (piece.call_id === activeCallId) continue;
    await db.transaction('rw', db.callPieces, db.callUploads, async () => {
      await db.callUploads.add({ kind: 'close', call_id: piece.call_id, piece_id: piece.id, chunk_count: piece.chunk_count, duration_ms: 0 });
      await db.callPieces.update(piece.id, { status: 'closed' });
    });
    closed++;
  }
  // Forget closed pieces whose uploads are all done.
  const closedPieces = await db.callPieces.where('status').equals('closed').toArray();
  for (const piece of closedPieces) {
    if ((await db.callUploads.where('piece_id').equals(piece.id).count()) === 0) await db.callPieces.delete(piece.id);
  }
  return closed;
}
