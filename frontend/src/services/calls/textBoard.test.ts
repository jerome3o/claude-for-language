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

  it('a composing span that never closes (Gboard) never holds the other person back for good', () => {
    const { a, b, deliver } = pair();
    a.localEdit('今天', 2);
    deliver();
    // b's IME opens a span on the last word and keeps it open: the textarea says "今天hao".
    b.setComposing(true);
    // a keeps typing — all of it goes into b's document at once…
    a.localEdit('今天天气', 4);
    deliver();
    a.localEdit('今天天气很好', 6);
    deliver();
    expect(b.doc.text()).toBe('今天天气很好');
    expect(b.hasHeld).toBe(true);
    expect(b.text).toBe('今天'); // …while the textarea (the view) is left alone mid-composition
    // Idle / blur: b ends the composition from our side. What was composed counts as typed, after 今天.
    b.endComposition('今天hao', 5);
    deliver();
    expect(b.hasHeld).toBe(false);
    expect(b.isComposing).toBe(false);
    expect(b.text).toBe('今天hao天气很好');
    expect(a.text).toBe('今天hao天气很好');
  });

  it('an edit typed against an older view keeps what the other person added and removed meanwhile', () => {
    const { a, b, deliver } = pair();
    a.localEdit('abc def', 7);
    deliver();
    b.setComposing(true);
    a.localEdit('Xabc', 1); // a adds X at the start and deletes " def"
    deliver();
    // b's textarea still shows the old text with the composition committed in the middle.
    b.setComposing(false, 'abc 你 def', 5);
    b.flushHeld();
    deliver();
    expect(b.text).toBe('Xabc 你');
    expect(a.text).toBe('Xabc 你');
  });

  it('nothing waits when nobody composes; flushHeld is a no-op then', () => {
    const { a, b, deliver } = pair();
    a.localEdit('好', 1);
    deliver();
    expect(b.hasHeld).toBe(false);
    b.flushHeld();
    expect(b.text).toBe('好');
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

describe('TextBoardSession — board pages', () => {
  const PAGES = [
    { id: 'p1', title: null, preview: '', chars: 0, created_at: 1, updated_at: 1, call_id: null },
    { id: 'p2', title: 'Homework', preview: '', chars: 0, created_at: 2, updated_at: 2, call_id: null },
    { id: 'p3', title: null, preview: '', chars: 0, created_at: 3, updated_at: 3, call_id: null },
  ];
  type Sent = { type: string; page?: string; ops?: TextOp[] };
  function session(online = () => true) {
    const sent: Sent[] = [];
    const s = new TextBoardSession('me', (m) => {
      if (!online()) return false;
      sent.push(m as Sent);
      return true;
    });
    s.resetPeers([{ client_id: 'c-t', name: 'Minghui', user_id: 'tutor' }]);
    s.welcome({ text: { v: 1, runs: [] }, pages: PAGES, page: 'p3', page_views: { 'c-t': 'p3' } });
    return { s, sent };
  }

  it('opens on the page the room says; typing is tagged with it', () => {
    const { s, sent } = session();
    expect(s.page).toBe('p3');
    s.localEdit('你好', 2);
    expect(sent.at(-1)).toMatchObject({ type: 'text', page: 'p3' });
  });

  it('turning to another page asks the room for it and is read-only until it arrives; a seen page shows at once', () => {
    const { s, sent } = session();
    s.localEdit('第三页', 3);
    s.openPage('p1');
    expect(sent.at(-1)).toEqual({ type: 'page_open', page: 'p1' });
    expect(s.awaitingPage).toBe(true);
    expect(s.text).toBe('');
    const doc = new TextDoc('tutor:x');
    doc.replaceText('第一页');
    s.pageDoc('p1', doc.snapshot(), []);
    expect(s.awaitingPage).toBe(false);
    expect(s.text).toBe('第一页');
    // Back to page 3: shown from this call's copy straight away.
    s.openPage('p3');
    expect(s.awaitingPage).toBe(false);
    expect(s.text).toBe('第三页');
  });

  it('ignores keystrokes and carets for a page it is not on', () => {
    const { s } = session();
    const other = new TextDoc('tutor:x');
    s.applyRemote(other.replaceText('elsewhere'), 'p1');
    expect(s.text).toBe('');
    s.setCursor({ client_id: 'c-t', user_id: 'tutor', name: 'Minghui', sel: { anchor: null, head: null }, page: 'p1' });
    expect(s.remoteCarets).toHaveLength(0);
    s.applyRemote(new TextDoc('tutor:y').replaceText('here'), 'p3');
    expect(s.text).toBe('here');
  });

  it('follow: my view jumps with theirs; turning a page myself stops following', () => {
    const { s, sent } = session();
    s.follow('tutor');
    s.pageView('c-t', 'p2');
    expect(s.page).toBe('p2');
    expect(sent.at(-1)).toEqual({ type: 'page_open', page: 'p2' });
    expect(s.following).toBe('tutor');
    s.openPage('p1');
    expect(s.following).toBeNull();
    s.pageView('c-t', 'p3');
    expect(s.page).toBe('p1');
  });

  it('following survives their reconnect (a new client id, same user)', () => {
    const { s } = session();
    s.follow('tutor');
    s.dropPeer('c-t');
    s.setPeer('c-t2', 'Minghui', 'tutor');
    s.pageView('c-t2', 'p1');
    expect(s.page).toBe('p1');
  });

  it('"Bring me there" and a deleted page move me with a note', () => {
    const { s } = session();
    s.summoned('Minghui', 'p2');
    expect(s.page).toBe('p2');
    expect(s.notice?.text).toBe('Minghui brought you to Homework');
    s.summoned('Minghui', 'p1');
    expect(s.notice?.text).toBe('Minghui brought you to page 1');
    // The room sends the new list, then the deletion.
    s.setPages(PAGES.filter((p) => p.id !== 'p1'));
    s.pageDeleted('p1', 'p2', 'Minghui');
    expect(s.page).toBe('p2');
    expect(s.notice?.text).toBe('Minghui deleted page 1');
    expect(s.labelOf('p3')).toBe('Page 2');
  });

  it('a rejoin while on another page stays there; edits typed offline go out tagged with their page', () => {
    let online = true;
    const { s, sent } = session(() => online);
    s.openPage('p1');
    s.pageDoc('p1', { v: 1, runs: [] }, []);
    online = false;
    s.localEdit('离线', 2);
    online = true;
    sent.length = 0;
    s.welcome({ text: { v: 1, runs: [] }, pages: PAGES, page: 'p3', page_views: {} });
    expect(s.page).toBe('p1');
    expect(sent).toEqual([{ type: 'page_open', page: 'p1' }]);
    // The room's copy of p1 lacks them → they are replayed onto it and sent.
    s.pageDoc('p1', { v: 1, runs: [] }, []);
    expect(s.text).toBe('离线');
    expect(sent.at(-1)).toMatchObject({ type: 'text', page: 'p1' });
  });
});

describe('TextBoardSession — making a page', () => {
  it('a new page the room made for me opens; an unrelated late page_doc does not', () => {
    const sent: Array<{ type: string }> = [];
    const s = new TextBoardSession('me', (m) => (sent.push(m), true));
    s.welcome({ text: { v: 1, runs: [] }, pages: [{ id: 'p1', title: null, preview: '', chars: 0, created_at: 1, updated_at: 1, call_id: null }], page: 'p1' });
    s.pageDoc('p0', { v: 1, runs: [] }, []);
    expect(s.page).toBe('p1');
    s.newPage();
    expect(sent.at(-1)).toEqual({ type: 'page_new' });
    s.pageDoc('p2', { v: 1, runs: [] }, []);
    expect(s.page).toBe('p2');
    s.localEdit('新', 1);
    expect(sent.at(-1)).toMatchObject({ type: 'text', page: 'p2' });
  });
});
