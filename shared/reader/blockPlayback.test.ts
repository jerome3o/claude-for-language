import { describe, it, expect } from 'vitest';
import {
  blockPlayback,
  activeBlockIndex,
  INITIAL_BLOCK_PLAY_STATE,
  type BlockPlayEvent,
  type BlockPlayState,
} from './blockPlayback';
import type { AudioBlock } from './audioBlocks';

// Three phrases: 0–2 s, 2–5 s, 5–8 s
const blocks: AudioBlock[] = [
  { startMs: 0, endMs: 2000 },
  { startMs: 2000, endMs: 5000 },
  { startMs: 5000, endMs: 8000 },
];

function run(events: BlockPlayEvent[], from: BlockPlayState = INITIAL_BLOCK_PLAY_STATE, b = blocks) {
  let state = from;
  let seekToMs: number | null = null;
  for (const e of events) ({ state, seekToMs } = blockPlayback(state, e, b));
  return { state, seekToMs };
}

describe('blockPlayback', () => {
  it('plays from the anchor', () => {
    const { state, seekToMs } = run([{ type: 'place', ms: 1234 }, { type: 'play' }]);
    expect(seekToMs).toBe(1234);
    expect(state.playing).toBe(true);
  });

  it('advances the restart point to each block as playback enters it', () => {
    let s = run([{ type: 'play' }, { type: 'tick', posMs: 1500 }]).state;
    expect(s.anchorMs).toBe(0);
    s = run([{ type: 'tick', posMs: 2040 }], s).state;
    expect(s.anchorMs).toBe(2000);
    s = run([{ type: 'tick', posMs: 5100 }], s).state;
    expect(s.anchorMs).toBe(5000);
  });

  it('pausing mid-block restarts that block', () => {
    const { state } = run([{ type: 'play' }, { type: 'tick', posMs: 2100 }, { type: 'pause', posMs: 3600 }]);
    expect(state).toEqual({ anchorMs: 2000, manual: false, playing: false, crossedFromMs: null });
    expect(run([{ type: 'play' }], state).seekToMs).toBe(2000);
  });

  it('pausing within 1 s of crossing into a block goes back to the previous block', () => {
    const { state } = run([{ type: 'play' }, { type: 'tick', posMs: 2100 }, { type: 'tick', posMs: 5200 }, { type: 'pause', posMs: 5700 }]);
    expect(state.anchorMs).toBe(2000);
    // …also when the pause lands before a tick saw the new block
    expect(run([{ type: 'play' }, { type: 'tick', posMs: 1900 }, { type: 'pause', posMs: 2300 }]).state.anchorMs).toBe(0);
  });

  it('no grace right after pressing play at a block start', () => {
    const start = run([{ type: 'jump', index: 1 }]).state;
    const { state } = run([{ type: 'play' }, { type: 'tick', posMs: 2300 }, { type: 'pause', posMs: 2400 }], start);
    expect(state.anchorMs).toBe(2000);
  });

  it('a hand-placed anchor wins until playback moves past its block', () => {
    let s = run([{ type: 'place', ms: 3100 }, { type: 'play' }, { type: 'tick', posMs: 4000 }, { type: 'pause', posMs: 4500 }]).state;
    expect(s).toMatchObject({ anchorMs: 3100, manual: true });
    s = run([{ type: 'play' }, { type: 'tick', posMs: 5300 }, { type: 'pause', posMs: 6800 }], s).state;
    expect(s).toMatchObject({ anchorMs: 5000, manual: false });
  });

  it('the grace returns to a hand-placed point in the previous block', () => {
    const { state } = run([{ type: 'place', ms: 3100 }, { type: 'play' }, { type: 'tick', posMs: 5100 }, { type: 'pause', posMs: 5400 }]);
    expect(state).toMatchObject({ anchorMs: 3100, manual: true });
  });

  it('dragging while playing seeks live and becomes the anchor', () => {
    const playing = run([{ type: 'play' }, { type: 'tick', posMs: 2500 }]).state;
    const { state, seekToMs } = run([{ type: 'place', ms: 600 }], playing);
    expect(seekToMs).toBe(600);
    expect(state).toMatchObject({ anchorMs: 600, manual: true, playing: true, crossedFromMs: null });
  });

  it('tapping a block makes its start the anchor (seeking only while playing)', () => {
    expect(run([{ type: 'jump', index: 2 }])).toEqual({ state: { anchorMs: 5000, manual: false, playing: false, crossedFromMs: null }, seekToMs: null });
    expect(run([{ type: 'play' }, { type: 'jump', index: 1 }]).seekToMs).toBe(2000);
    expect(run([{ type: 'jump', index: 9 }]).state.anchorMs).toBe(5000);
  });

  it('⏭ / ⏮ step between blocks with the media-player convention', () => {
    // Stopped at a block start: ⏮ = previous block, ⏭ = next
    const at1 = run([{ type: 'jump', index: 1 }]).state;
    expect(run([{ type: 'step', dir: -1, posMs: 0 }], at1).state.anchorMs).toBe(0);
    expect(run([{ type: 'step', dir: 1, posMs: 0 }], at1).state.anchorMs).toBe(5000);
    // Stopped with a hand-placed anchor mid-block: ⏮ = start of that block
    const mid = run([{ type: 'place', ms: 3000 }]).state;
    expect(run([{ type: 'step', dir: -1, posMs: 0 }], mid).state.anchorMs).toBe(2000);
    // Playing, 2 s into a block: ⏮ restarts it; 0.5 s in: the previous one
    const playing = run([{ type: 'play' }, { type: 'tick', posMs: 4000 }]).state;
    expect(run([{ type: 'step', dir: -1, posMs: 4000 }], playing).seekToMs).toBe(2000);
    expect(run([{ type: 'step', dir: -1, posMs: 2500 }], playing).seekToMs).toBe(0);
    // Clamped at both ends
    expect(run([{ type: 'step', dir: -1, posMs: 0 }]).state.anchorMs).toBe(0);
    expect(run([{ type: 'jump', index: 2 }, { type: 'step', dir: 1, posMs: 0 }]).state.anchorMs).toBe(5000);
  });

  it('when the clip ends, the anchor is the last block', () => {
    expect(run([{ type: 'play' }, { type: 'tick', posMs: 2100 }, { type: 'ended' }]).state).toEqual({ anchorMs: 5000, manual: false, playing: false, crossedFromMs: null });
    expect(run([{ type: 'place', ms: 6000 }, { type: 'play' }, { type: 'ended' }]).state.anchorMs).toBe(6000);
  });

  it('one block behaves like the old scrubber', () => {
    const one = [{ startMs: 0, endMs: 8000 }];
    let s = run([{ type: 'place', ms: 2500 }, { type: 'play' }, { type: 'tick', posMs: 6000 }, { type: 'pause', posMs: 6100 }], INITIAL_BLOCK_PLAY_STATE, one).state;
    expect(s.anchorMs).toBe(2500);
    s = run([{ type: 'play' }, { type: 'ended' }], s, one).state;
    expect(s.anchorMs).toBe(2500);
  });

  it('highlights the playing block, else the anchor’s', () => {
    const playing = run([{ type: 'play' }]).state;
    expect(activeBlockIndex(playing, blocks, 5500)).toBe(2);
    expect(activeBlockIndex(run([{ type: 'place', ms: 2500 }]).state, blocks, 7000)).toBe(1);
    expect(activeBlockIndex(INITIAL_BLOCK_PLAY_STATE, [], 0)).toBe(-1);
  });
});
