import { describe, it, expect } from 'vitest';
import {
  READER_SPEEDS,
  DEFAULT_READER_SPEED,
  parseReaderSpeed,
  nextReaderSpeed,
  readerSpeedLabel,
  blockGraceMsAt,
} from './speed';
import { blockPlayback, INITIAL_BLOCK_PLAY_STATE, type BlockPlayEvent, type BlockPlayState } from './blockPlayback';
import type { AudioBlock } from './audioBlocks';

describe('reader speed', () => {
  it('offers 1×, 0.75× and 0.5×, default 1×', () => {
    expect([...READER_SPEEDS]).toEqual([1, 0.75, 0.5]);
    expect(DEFAULT_READER_SPEED).toBe(1);
  });

  it('cycles 1× → 0.75× → 0.5× → 1×', () => {
    expect(nextReaderSpeed(1)).toBe(0.75);
    expect(nextReaderSpeed(0.75)).toBe(0.5);
    expect(nextReaderSpeed(0.5)).toBe(1);
    // An unknown value counts as the default
    expect(nextReaderSpeed(2)).toBe(0.75);
  });

  it('reads back what was stored and falls back to 1× for anything else', () => {
    expect(parseReaderSpeed('0.75')).toBe(0.75);
    expect(parseReaderSpeed(' 0.5 ')).toBe(0.5);
    expect(parseReaderSpeed(0.5)).toBe(0.5);
    expect(parseReaderSpeed('1')).toBe(1);
    for (const bad of [null, undefined, '', 'fast', '0.6', 2, NaN, Infinity, {}, '0.5x']) {
      expect(parseReaderSpeed(bad)).toBe(1);
    }
  });

  it('labels the chip', () => {
    expect(READER_SPEEDS.map(readerSpeedLabel)).toEqual(['1×', '0.75×', '0.5×']);
  });

  it('scales the 1 s grace to media time (a wall-clock second)', () => {
    expect(blockGraceMsAt(1)).toBe(1000);
    expect(blockGraceMsAt(0.75)).toBe(750);
    expect(blockGraceMsAt(0.5)).toBe(500);
  });
});

// The scrubber at 0.5×: blocks and positions are media time; only the grace changes.
describe('the phrase-block scrubber at 0.5×', () => {
  const blocks: AudioBlock[] = [
    { startMs: 0, endMs: 2000 },
    { startMs: 2000, endMs: 5000 },
    { startMs: 5000, endMs: 8000 },
  ];
  const grace = blockGraceMsAt(0.5);
  function run(events: BlockPlayEvent[], from: BlockPlayState = INITIAL_BLOCK_PLAY_STATE) {
    let state = from;
    let seekToMs: number | null = null;
    for (const e of events) ({ state, seekToMs } = blockPlayback(state, e, blocks, grace));
    return { state, seekToMs };
  }

  it('advances block by block exactly as at 1× (media time)', () => {
    let s = run([{ type: 'play' }, { type: 'tick', posMs: 1900 }]).state;
    expect(s.anchorMs).toBe(0);
    s = run([{ type: 'tick', posMs: 2020 }], s).state;
    expect(s.anchorMs).toBe(2000);
    s = run([{ type: 'tick', posMs: 5010 }], s).state;
    expect(s.anchorMs).toBe(5000);
  });

  it('stop → play replays the block he was in', () => {
    // 1.6 s of media into block 2 = 3.2 s of listening at 0.5×
    const { state } = run([{ type: 'play' }, { type: 'tick', posMs: 2010 }, { type: 'pause', posMs: 3600 }]);
    expect(state.anchorMs).toBe(2000);
    expect(run([{ type: 'play' }], state).seekToMs).toBe(2000);
  });

  it('stopping within a wall-clock second of a new block goes back to the previous one', () => {
    // 400 ms of media = 0.8 s of listening at 0.5× → still inside the grace
    const quick = run([{ type: 'play' }, { type: 'tick', posMs: 2010 }, { type: 'pause', posMs: 2400 }]).state;
    expect(quick.anchorMs).toBe(0);
    // 700 ms of media = 1.4 s of listening → past it: this block (at 1× it would still be in the grace)
    const late = run([{ type: 'play' }, { type: 'tick', posMs: 2010 }, { type: 'pause', posMs: 2700 }]).state;
    expect(late.anchorMs).toBe(2000);
    const at1x = blockPlayback(
      run([{ type: 'play' }, { type: 'tick', posMs: 2010 }]).state,
      { type: 'pause', posMs: 2700 },
      blocks,
      blockGraceMsAt(1),
    ).state;
    expect(at1x.anchorMs).toBe(0);
  });

  it('⏮ restarts the current block once a wall-clock second has passed', () => {
    const playing = run([{ type: 'play' }, { type: 'tick', posMs: 2010 }]).state;
    expect(blockPlayback(playing, { type: 'step', dir: -1, posMs: 2600 }, blocks, grace).seekToMs).toBe(2000);
    expect(blockPlayback(playing, { type: 'step', dir: -1, posMs: 2300 }, blocks, grace).seekToMs).toBe(0);
  });
});
