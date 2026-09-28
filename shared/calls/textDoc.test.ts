import { describe, it, expect } from 'vitest';
import {
  TextDoc,
  charToCodeUnitIndex,
  codeUnitToCharIndex,
  diffChars,
  presenceColor,
  sanitizeSelection,
  sanitizeTextOp,
  sanitizeTextSnapshot,
  snapshotText,
  type TextOp,
} from './textDoc';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('TextDoc basics', () => {
  it('types, deletes and reads back', () => {
    const d = new TextDoc('a');
    d.localInsert(0, '你好');
    d.localInsert(2, '世界');
    d.localInsert(2, '，');
    expect(d.text()).toBe('你好，世界');
    d.localDelete(2, 1);
    expect(d.text()).toBe('你好世界');
    expect(d.length).toBe(4);
  });

  it('replays remote ops idempotently', () => {
    const a = new TextDoc('a');
    const b = new TextDoc('b');
    const op = a.localInsert(0, 'hello')!;
    expect(b.apply(op)).toBe(true);
    expect(b.apply(op)).toBe(false);
    expect(b.text()).toBe('hello');
  });

  it('holds an op until what it depends on arrives', () => {
    const a = new TextDoc('a');
    const first = a.localInsert(0, 'ab')!;
    const second = a.localInsert(2, 'cd')!;
    const del = a.localDelete(1, 2)!;
    const b = new TextDoc('b');
    expect(b.apply(del)).toBe(false);
    expect(b.apply(second)).toBe(false);
    expect(b.apply(first)).toBe(true);
    expect(b.text()).toBe('ad');
  });

  it('keeps emoji and surrogate pairs whole', () => {
    const d = new TextDoc('a');
    d.localInsert(0, '好😀好');
    expect(d.length).toBe(3);
    d.localDelete(1, 1);
    expect(d.text()).toBe('好好');
  });

  it('round-trips through a snapshot in runs', () => {
    const d = new TextDoc('a');
    d.localInsert(0, '我想要一杯咖啡');
    d.localDelete(3, 2);
    const snap = d.snapshot();
    expect(snap.runs.length).toBeLessThanOrEqual(3);
    const copy = new TextDoc('b', snap);
    expect(copy.text()).toBe('我想要咖啡');
    expect(snapshotText(snap)).toBe('我想要咖啡');
    expect(copy.clock).toBe(d.clock);
    // Editing the copy continues cleanly on both sides.
    const op = copy.localInsert(3, '热');
    d.apply(op!);
    expect(d.text()).toBe(copy.text());
  });
});

describe('anchors (carets that survive the other person typing)', () => {
  it('a caret stays after its character while text is inserted before it', () => {
    const me = new TextDoc('me');
    const them = new TextDoc('them');
    them.apply(me.localInsert(0, 'abc')!);
    const caret = me.anchorAt(2); // between b and c
    me.apply(them.localInsert(0, 'XYZ')!);
    expect(me.indexOfAnchor(caret)).toBe(5);
  });

  it('a caret after a deleted character falls back to its nearest visible predecessor', () => {
    const d = new TextDoc('a');
    d.localInsert(0, 'abcd');
    const caret = d.anchorAt(3); // after c
    d.localDelete(1, 2); // b, c
    expect(d.text()).toBe('ad');
    expect(d.indexOfAnchor(caret)).toBe(1);
    expect(d.indexOfAnchor(null)).toBe(0);
    expect(d.anchorAt(0)).toBeNull();
  });
});

describe('diffChars / replaceText (from a textarea)', () => {
  it('finds the single edit', () => {
    expect(diffChars([...'hello'], [...'help'])).toEqual({ index: 3, remove: 2, insert: 'p' });
    expect(diffChars([...'abc'], [...'abc'])).toEqual({ index: 3, remove: 0, insert: '' });
    expect(diffChars([], [...'你好'])).toEqual({ index: 0, remove: 0, insert: '你好' });
  });

  it('uses the caret to place an ambiguous insert or delete', () => {
    expect(diffChars([...'aa'], [...'aaa'], 1)).toEqual({ index: 0, remove: 0, insert: 'a' });
    expect(diffChars([...'aa'], [...'aaa'])).toEqual({ index: 2, remove: 0, insert: 'a' });
    expect(diffChars([...'aaa'], [...'aa'], 0)).toEqual({ index: 0, remove: 1, insert: '' });
  });

  it('turns a whole textarea change into ops that replay elsewhere', () => {
    const a = new TextDoc('a');
    const b = new TextDoc('b');
    const send = (ops: TextOp[]) => ops.forEach((o) => b.apply(o));
    send(a.replaceText('一杯咖啡'));
    send(a.replaceText('一杯热咖啡', 3));
    send(a.replaceText('两杯热咖啡', 1));
    expect(b.text()).toBe('两杯热咖啡');
    expect(a.text()).toBe('两杯热咖啡');
  });

  it('converts textarea offsets to character indexes around emoji', () => {
    expect(codeUnitToCharIndex('a😀b', 3)).toBe(2);
    expect(charToCodeUnitIndex('a😀b', 2)).toBe(3);
  });
});

describe('convergence under concurrent edits', () => {
  /**
   * Three people type, delete and paste at random. Each one's ops reach the
   * room (in the order they were made) after a random delay; the room applies
   * them in arrival order and forwards them to everyone else in that order,
   * again with random delays per link (FIFO). After everything is delivered,
   * all replicas — and the room — must read the same text.
   */
  function simulate(seed: number, steps: number) {
    const r = rng(seed);
    const sites = ['s1', 's2', 's3'];
    const docs = sites.map((s) => new TextDoc(s));
    const room = new TextDoc('room');
    const up: TextOp[][] = sites.map(() => []); // client → room, FIFO
    const down: TextOp[][] = sites.map(() => []); // room → client, FIFO
    const origin = new Map<TextOp, number>();
    const alphabet = ['a', 'b', '你', '好', ' ', '\n', '😀'];

    const pump = (maxMoves: number) => {
      for (let m = 0; m < maxMoves; m++) {
        const k = Math.floor(r() * sites.length);
        if (r() < 0.5 && up[k].length) {
          const op = up[k].shift()!;
          room.apply(op);
          sites.forEach((_, j) => j !== origin.get(op) && down[j].push(op));
        } else if (down[k].length) {
          docs[k].apply(down[k].shift()!);
        }
      }
    };

    for (let step = 0; step < steps; step++) {
      const k = Math.floor(r() * sites.length);
      const d = docs[k];
      const len = d.length;
      let op: TextOp | null = null;
      const roll = r();
      if (roll < 0.55 || len === 0) {
        const n = 1 + Math.floor(r() * (r() < 0.1 ? 12 : 3));
        const text = Array.from({ length: n }, () => alphabet[Math.floor(r() * alphabet.length)]).join('');
        op = d.localInsert(Math.floor(r() * (len + 1)), text);
      } else if (roll < 0.9) {
        const at = Math.floor(r() * len);
        op = d.localDelete(at, 1 + Math.floor(r() * Math.min(4, len - at)));
      } else {
        // A whole "textarea" edit: replace a slice.
        const t = Array.from(d.text());
        const at = Math.floor(r() * t.length);
        t.splice(at, Math.floor(r() * 3), ...'换');
        d.replaceText(t.join('')).forEach((o) => {
          origin.set(o, k);
          up[k].push(o);
        });
      }
      if (op) {
        origin.set(op, k);
        up[k].push(op);
      }
      pump(Math.floor(r() * 4));
    }
    // Deliver everything.
    while (up.some((q) => q.length) || down.some((q) => q.length)) pump(50);
    return { docs, room };
  }

  for (const seed of [1, 2, 3, 42, 2026, 90210, 7, 8]) {
    it(`three typists converge (seed ${seed})`, () => {
      const { docs, room } = simulate(seed, 400);
      const texts = docs.map((d) => d.text());
      expect(texts[1]).toBe(texts[0]);
      expect(texts[2]).toBe(texts[0]);
      expect(room.text()).toBe(texts[0]);
      // A late joiner from the room's snapshot sees the same, and can keep typing.
      const late = new TextDoc('late', room.snapshot());
      expect(late.text()).toBe(texts[0]);
      expect(late.localInsert(0, 'x')!.id[0]).toBeGreaterThan(Math.max(...docs.map((d) => d.clock)) - 1);
    });
  }

  it('two people typing at the same spot keep each word together', () => {
    const a = new TextDoc('a');
    const b = new TextDoc('b');
    const base = a.localInsert(0, '[]')!;
    b.apply(base);
    const ta = a.localInsert(1, '你好')!;
    const tb = b.localInsert(1, 'hello')!;
    a.apply(tb);
    b.apply(ta);
    expect(a.text()).toBe(b.text());
    expect(['[你好hello]', '[hello你好]']).toContain(a.text());
  });
});

describe('wire validation', () => {
  it('accepts well-formed ops and refuses junk', () => {
    expect(sanitizeTextOp({ t: 'ins', id: [3, 's'], after: [2, 's'], text: 'x' }, 's')).toEqual({ t: 'ins', id: [3, 's'], after: [2, 's'], text: 'x' });
    expect(sanitizeTextOp({ t: 'ins', id: [3, 's'], after: null, text: 'x' })).not.toBeNull();
    expect(sanitizeTextOp({ t: 'ins', id: [3, 's'], after: null, text: 'x' }, 'other')).toBeNull();
    expect(sanitizeTextOp({ t: 'ins', id: [3, 's'], after: [3, 't'], text: 'x' })).toBeNull();
    expect(sanitizeTextOp({ t: 'ins', id: [0, 's'], after: null, text: 'x' })).toBeNull();
    expect(sanitizeTextOp({ t: 'ins', id: [1, 's'], after: null, text: '' })).toBeNull();
    expect(sanitizeTextOp({ t: 'ins', id: [1, 's'], after: null, text: 'x'.repeat(5001) })).toBeNull();
    expect(sanitizeTextOp({ t: 'del', ids: [[1, 's']] })).toEqual({ t: 'del', ids: [[1, 's']] });
    expect(sanitizeTextOp({ t: 'del', ids: [] })).toBeNull();
    expect(sanitizeTextOp({ t: 'del', ids: [['1', 's']] })).toBeNull();
    expect(sanitizeTextOp(null)).toBeNull();
    expect(sanitizeTextOp({ t: 'nope' })).toBeNull();
  });

  it('checks snapshots and selections', () => {
    expect(sanitizeTextSnapshot({ v: 1, runs: [[1, 's', 'ab', 0]] })).toEqual({ v: 1, runs: [[1, 's', 'ab', 0]] });
    expect(sanitizeTextSnapshot({ runs: [[1, 's', 'ab', 2]] })).toBeNull();
    expect(sanitizeSelection({ anchor: null, head: [2, 's'] })).toEqual({ anchor: null, head: [2, 's'] });
    expect(sanitizeSelection({ anchor: 'x', head: null })).toBeNull();
    expect(sanitizeSelection(null)).toBeNull();
  });

  it('gives each person a stable colour', () => {
    expect(presenceColor('user-1')).toBe(presenceColor('user-1'));
    expect(presenceColor('user-1')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
