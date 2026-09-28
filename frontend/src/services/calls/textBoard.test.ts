import { describe, it, expect } from 'vitest';
import { TextDoc, type TextOp } from '@shared/calls';
import { TextBoardSession } from './textBoard';

/** Two sessions joined through a fake room that relays in order. */
function pair() {
  const room = new TextDoc('room');
  const inbox: Record<string, TextOp[]> = { a: [], b: [] };
  let aOnline = true;
  const mk = (me: 'a' | 'b', other: 'a' | 'b', online: () => boolean) =>
    new TextBoardSession(me === 'a' ? 'user-a' : 'user-b', (m) => {
      if (!online()) return false;
      if (m.type === 'text') {
        m.ops.forEach((op) => room.apply(op));
        inbox[other].push(...m.ops);
      }
      return true;
    });
  const a = mk('a', 'b', () => aOnline);
  const b = mk('b', 'a', () => true);
  const deliver = () => {
    a.applyRemote(inbox.a.splice(0));
    b.applyRemote(inbox.b.splice(0));
  };
  return { a, b, room, deliver, setAOnline: (v: boolean) => (aOnline = v) };
}

describe('TextBoardSession', () => {
  it('sends local edits and applies the other side\'s', () => {
    const { a, b, deliver } = pair();
    a.localEdit('我要一杯咖啡', 6);
    deliver();
    expect(b.text).toBe('我要一杯咖啡');
    b.localEdit('我要一杯热咖啡', 5);
    deliver();
    expect(a.text).toBe('我要一杯热咖啡');
  });

  it('sends nothing mid-composition and holds incoming edits until it ends', () => {
    const { a, b, deliver } = pair();
    a.localEdit('你好', 2);
    deliver();
    // b starts typing pinyin: the textarea shows "你好ni" while composing.
    b.setComposing(true);
    b.localEdit('你好ni', 4); // ignored: input events during composition
    // a edits meanwhile.
    a.localEdit('!你好', 1);
    deliver();
    expect(b.text).toBe('你好'); // held, the IME is undisturbed
    // Composition ends with 你们 at the end.
    b.setComposing(false, '你好你们', 4);
    b.flushHeld();
    deliver();
    expect(b.text).toBe('!你好你们');
    expect(a.text).toBe('!你好你们');
  });

  it('replays edits made while the socket was down after rejoining', () => {
    const { a, b, room, deliver, setAOnline } = pair();
    a.localEdit('上课', 2);
    deliver();
    setAOnline(false);
    a.localEdit('上课了', 3); // not delivered
    setAOnline(true);
    a.load(room.snapshot(), []);
    deliver();
    expect(room.text()).toBe('上课了');
    expect(b.text).toBe('上课了');
  });

  it('tracks the other person\'s caret by anchor', () => {
    const { a, b, deliver } = pair();
    a.localEdit('abc', 3);
    deliver();
    b.setCursor({ client_id: 'c-a', user_id: 'user-a', name: 'A', sel: { anchor: a.anchorAt(1), head: a.anchorAt(1) } });
    expect(b.indexOf(b.remoteCarets[0].sel.head)).toBe(1);
    a.localEdit('XXabc', 2);
    deliver();
    expect(b.indexOf(b.remoteCarets[0].sel.head)).toBe(3);
    b.dropCursor('c-a');
    expect(b.remoteCarets).toHaveLength(0);
  });
});
