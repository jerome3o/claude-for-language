/**
 * Records THIS participant's microphone during a call, for the transcript.
 *
 * - A fresh MediaRecorder every PIECE_MS, so each piece is a standalone file
 *   the transcriber can read on its own (timeslice chunks of one recorder
 *   are only valid concatenated from the first one).
 * - Each recorder emits a chunk every CHUNK_MS; chunks go straight to
 *   IndexedDB via the upload queue, never to the network directly.
 * - Piece start times are on the SERVER clock (clockOffset from the room's
 *   welcome), so both participants' transcripts line up.
 */

import { db } from '../../db/database';
import { enqueueCallUpload } from './uploads';

export const PIECE_MS = 5 * 60_000;
export const CHUNK_MS = 10_000;
const AUDIO_BITS = 32_000;

export function pickRecordingMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

function newPieceId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

interface ActivePiece {
  id: string;
  index: number;
  recorder: MediaRecorder;
  startedAtLocal: number;
  chunks: number;
  /** Serialises chunk writes so their indexes stay in order. */
  writes: Promise<void>;
}

export class CallRecorder {
  private piece: ActivePiece | null = null;
  private nextIndex = 0;
  private rotateTimer: ReturnType<typeof setInterval> | null = null;
  private stream: MediaStream | null = null;
  private readonly mime: string;

  constructor(
    private readonly callId: string,
    /** serverTime − localTime, in ms. */
    private readonly clockOffset: () => number,
    private readonly onChunk?: () => void,
  ) {
    this.mime = pickRecordingMime() ?? 'audio/webm';
  }

  get recording(): boolean {
    return this.piece !== null;
  }

  static supported(): boolean {
    return pickRecordingMime() !== null;
  }

  /** Start recording the given audio track (the mic). Resumes piece numbering from earlier pieces of this call. */
  async start(track: MediaStreamTrack): Promise<void> {
    if (this.piece) return;
    const earlier = await db.callPieces.where('call_id').equals(this.callId).toArray();
    this.nextIndex = Math.max(this.nextIndex, ...earlier.map((p) => p.piece_index + 1), 0);
    // Pieces from this call already in the server's hands are keyed by id, so
    // a new tab simply continues at the next index.
    this.stream = new MediaStream([track]);
    await this.startPiece();
    this.rotateTimer = setInterval(() => void this.rotate(), PIECE_MS);
  }

  /** Swap the mic track (e.g. after switching devices) — starts a new piece. */
  async replaceTrack(track: MediaStreamTrack): Promise<void> {
    if (!this.piece) return;
    this.stream = new MediaStream([track]);
    await this.rotate();
  }

  async stop(): Promise<void> {
    if (this.rotateTimer) clearInterval(this.rotateTimer);
    this.rotateTimer = null;
    const piece = this.piece;
    this.piece = null;
    if (piece) await this.finishPiece(piece);
  }

  private async rotate(): Promise<void> {
    const old = this.piece;
    if (!old) return;
    // Start the next piece before stopping the old one so no words fall in a gap.
    await this.startPiece();
    await this.finishPiece(old);
  }

  private async startPiece(): Promise<void> {
    if (!this.stream) return;
    const recorder = new MediaRecorder(this.stream, { mimeType: this.mime, audioBitsPerSecond: AUDIO_BITS });
    const piece: ActivePiece = {
      id: newPieceId(),
      index: this.nextIndex++,
      recorder,
      startedAtLocal: Date.now(),
      chunks: 0,
      writes: Promise.resolve(),
    };
    const startedAt = Math.round(piece.startedAtLocal + this.clockOffset());
    await db.transaction('rw', db.callPieces, db.callUploads, async () => {
      await db.callPieces.put({ id: piece.id, call_id: this.callId, piece_index: piece.index, started_at: startedAt, chunk_count: 0, status: 'open' });
      await db.callUploads.add({ kind: 'register', call_id: this.callId, piece_id: piece.id, piece_index: piece.index, started_at: startedAt, mime_type: this.mime });
    });
    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      const blob = event.data;
      piece.writes = piece.writes.then(async () => {
        const idx = piece.chunks++;
        await db.transaction('rw', db.callPieces, db.callUploads, async () => {
          await db.callUploads.add({ kind: 'chunk', call_id: this.callId, piece_id: piece.id, idx, blob });
          await db.callPieces.update(piece.id, { chunk_count: piece.chunks });
        });
        this.onChunk?.();
      }).catch((err) => console.error('[calls] saving a recording chunk failed:', err));
    };
    recorder.start(CHUNK_MS);
    this.piece = piece;
  }

  private finishPiece(piece: ActivePiece): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = async () => {
        await piece.writes;
        await db.transaction('rw', db.callPieces, db.callUploads, async () => {
          await enqueueCallUpload({
            kind: 'close',
            call_id: this.callId,
            piece_id: piece.id,
            chunk_count: piece.chunks,
            duration_ms: Date.now() - piece.startedAtLocal,
          });
          await db.callPieces.update(piece.id, { status: 'closed', chunk_count: piece.chunks });
        });
        this.onChunk?.();
        resolve();
      };
      if (piece.recorder.state === 'inactive') {
        void done();
        return;
      }
      // The final dataavailable fires before onstop.
      piece.recorder.onstop = () => void done();
      try {
        piece.recorder.stop();
      } catch {
        void done();
      }
    });
  }
}
