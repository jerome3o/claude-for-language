/**
 * The reader scrubber's restart point, moving with the audio block by block.
 *
 * A pure state machine shared in shape with the Lab app (android-lab core
 * `BlockPlayback.kt`, parity-tested against this file). The UI feeds it events
 * and does what the result says (`seekToMs`); the anchor is where the next play
 * starts and where the playhead parks while stopped.
 *
 * Rules:
 * - **play** starts from the anchor.
 * - **tick** (while playing): when playback enters a block that starts after
 *   the anchor, the anchor advances to that block's start — so the restart
 *   point follows the audio phrase by phrase. A hand-placed anchor wins until
 *   playback moves past its block.
 * - **pause**: the anchor stays at the start of the block that was playing
 *   (or the hand-placed point inside it), so play again replays that phrase —
 *   EXCEPT within the first `graceMs` (1 s) of a block playback just crossed
 *   into: then he paused because he missed the previous phrase, so the anchor
 *   goes back to the previous block (or the hand-placed point in it).
 * - **ended**: like a pause at the very end, without the grace (the clip just
 *   finished): the anchor is the last block, or a hand-placed point in it.
 * - **place** (drag on the waveform): a free, hand-placed anchor; seeks live
 *   while playing.
 * - **jump** (tap a block): that block's start becomes the anchor.
 * - **step** (⏮ / ⏭): ⏭ = next block. ⏮ = the start of the current block when
 *   past its first second while playing (or a hand-placed anchor mid-block while
 *   stopped), otherwise the previous block — the usual media-player convention,
 *   with the same 1 s grace.
 *
 * With one block (no pauses found, or the clip couldn't be decoded) every rule
 * reduces to the old scrubber: play from the anchor, stop returns to it.
 */

import { blockIndexAt, type AudioBlock } from './audioBlocks';

export interface BlockPlayState {
  /** Where the next play starts (ms). */
  anchorMs: number;
  /** The anchor was placed by hand (drag) rather than by a block. */
  manual: boolean;
  playing: boolean;
  /**
   * The anchor before playback last advanced it in this run (for the pause
   * grace); null when playback hasn't crossed a block boundary since play.
   */
  crossedFromMs: number | null;
}

export type BlockPlayEvent =
  | { type: 'play' }
  | { type: 'tick'; posMs: number }
  | { type: 'pause'; posMs: number }
  | { type: 'ended' }
  | { type: 'place'; ms: number }
  | { type: 'jump'; index: number }
  | { type: 'step'; dir: -1 | 1; posMs: number };

export interface BlockPlayResult {
  state: BlockPlayState;
  /** Seek / start the audio here (ms); null = leave the audio as it is. */
  seekToMs: number | null;
}

/** Pausing this soon after crossing into a block restarts from the previous one. */
export const BLOCK_GRACE_MS = 1000;

export const INITIAL_BLOCK_PLAY_STATE: BlockPlayState = {
  anchorMs: 0,
  manual: false,
  playing: false,
  crossedFromMs: null,
};

function clampIndex(blocks: AudioBlock[], index: number): number {
  return Math.max(0, Math.min(blocks.length - 1, index));
}

function startOf(blocks: AudioBlock[], index: number): number {
  return blocks.length === 0 ? 0 : blocks[clampIndex(blocks, index)].startMs;
}

function endOf(blocks: AudioBlock[]): number {
  return blocks.length === 0 ? 0 : blocks[blocks.length - 1].endMs;
}

/** Advance the anchor when playback has entered a later block. */
function advance(state: BlockPlayState, blocks: AudioBlock[], posMs: number): BlockPlayState {
  if (!state.playing || blocks.length === 0) return state;
  const start = startOf(blocks, blockIndexAt(blocks, posMs));
  if (start <= state.anchorMs) return state;
  return { ...state, anchorMs: start, manual: false, crossedFromMs: state.anchorMs };
}

function settle(state: BlockPlayState, anchorMs: number, manual: boolean): BlockPlayState {
  return { anchorMs, manual, playing: state.playing, crossedFromMs: null };
}

export function blockPlayback(
  state: BlockPlayState,
  event: BlockPlayEvent,
  blocks: AudioBlock[],
  graceMs: number = BLOCK_GRACE_MS,
): BlockPlayResult {
  switch (event.type) {
    case 'play':
      return { state: { ...state, playing: true, crossedFromMs: null }, seekToMs: state.anchorMs };

    case 'tick':
      return { state: advance(state, blocks, event.posMs), seekToMs: null };

    case 'pause': {
      const s = advance(state, blocks, event.posMs);
      const idx = blockIndexAt(blocks, event.posMs);
      const start = startOf(blocks, idx);
      let anchorMs = s.anchorMs;
      let manual = s.manual;
      if (s.crossedFromMs !== null && idx > 0 && s.anchorMs === start && event.posMs - start < graceMs) {
        const prev = startOf(blocks, idx - 1);
        anchorMs = Math.max(s.crossedFromMs, prev);
        manual = anchorMs !== prev;
      }
      return { state: { anchorMs, manual, playing: false, crossedFromMs: null }, seekToMs: null };
    }

    case 'ended': {
      const s = advance(state, blocks, Math.max(0, endOf(blocks) - 1));
      return { state: { anchorMs: s.anchorMs, manual: s.manual, playing: false, crossedFromMs: null }, seekToMs: null };
    }

    case 'place': {
      const ms = Math.max(0, Math.min(endOf(blocks), Math.round(event.ms)));
      return { state: settle(state, ms, true), seekToMs: state.playing ? ms : null };
    }

    case 'jump': {
      const ms = startOf(blocks, event.index);
      return { state: settle(state, ms, false), seekToMs: state.playing ? ms : null };
    }

    case 'step': {
      const ref = state.playing ? event.posMs : state.anchorMs;
      const idx = blockIndexAt(blocks, ref);
      const into = ref - startOf(blocks, idx);
      let target: number;
      if (event.dir > 0) target = idx + 1;
      else target = into > (state.playing ? graceMs : 0) ? idx : idx - 1;
      const ms = startOf(blocks, target);
      return { state: settle(state, ms, false), seekToMs: state.playing ? ms : null };
    }
  }
}

/** The block to highlight: the one playing, else the anchor's. */
export function activeBlockIndex(state: BlockPlayState, blocks: AudioBlock[], posMs: number): number {
  if (blocks.length === 0) return -1;
  return blockIndexAt(blocks, state.playing ? posMs : state.anchorMs);
}
