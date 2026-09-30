/**
 * One pronunciation take → an outcome for the card: the live (Soniox) text when the stream
 * gave one, else the take uploaded to POST /api/transcribe (Whisper → Soniox async → Gemini
 * on the server). Pure apart from the two injected calls, so every branch is unit-tested —
 * including the one that used to render NOTHING: live failed AND the upload failed.
 *
 * The live stream's failure reason travels with the upload (`live_error`), so the server's
 * logs say why the device's live path gave nothing.
 */
import type { TranscriptionResult } from '../api/client';

export type TakeOutcome =
  | { kind: 'done'; text: string; via: 'live' | 'upload'; result: TranscriptionResult; liveError: string | null }
  /** Offline: "Recording saved, will transcribe when online". */
  | { kind: 'offline'; liveError: string | null }
  /** Both paths failed: "Couldn't transcribe — tap to retry" (the take is still saved). */
  | { kind: 'failed'; liveError: string | null; reason: string };

export interface TakeTranscriptionDeps {
  /** The live transcriber's final text (rejects on error / timeout); null when the take wasn't streamed. */
  live?: Promise<string> | null;
  upload: (liveError: string | null) => Promise<TranscriptionResult>;
  isOnline: () => boolean;
}

export async function transcribeTakeOutcome({ live, upload, isOnline }: TakeTranscriptionDeps): Promise<TakeOutcome> {
  if (!live && !isOnline()) return { kind: 'offline', liveError: null };

  let liveError: string | null = null;
  if (live) {
    try {
      const text = await live;
      if (text.trim()) return { kind: 'done', text, via: 'live', result: { text, language: 'zh' }, liveError: null };
      liveError = 'live returned no text';
    } catch (err) {
      liveError = (err instanceof Error ? err.message : String(err)) || 'live failed';
    }
    if (!isOnline()) return { kind: 'offline', liveError };
  }

  try {
    const result = await upload(liveError);
    return { kind: 'done', text: result.text, via: 'upload', result, liveError };
  } catch (err) {
    return { kind: 'failed', liveError, reason: (err instanceof Error ? err.message : String(err)) || 'upload failed' };
  }
}
