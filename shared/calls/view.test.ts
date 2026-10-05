import { describe, expect, it } from 'vitest';
import {
  applyView, bringLabel, inviteText, nextSharedView, sameStage, sanitizeStageView, shouldSendView, theyLookAroundText, viewChipLabel, viewForShow,
  viewOf, viewStep, type SharedView, type StageView,
} from './view';
import { DEFAULT_LAYOUT, arrangeTiles, layoutReducer, layoutRects, type CallLayout } from './layout';

const T = 'tutor';
const S = 'student';

/** Two people's layouts with different per-device choices. */
const tutorLayout: CallLayout = { ...DEFAULT_LAYOUT, selfCorner: 'bl', pairCorner: 'tr', pairScale: 1.5, pip: 'separate', remoteFloat: false };
const studentLayout: CallLayout = { ...DEFAULT_LAYOUT };

function shared(view: StageView, seq: number, by: string, cid: string, extra: Partial<SharedView> = {}): SharedView {
  return { ...view, seq, by, name: by === T ? 'Minghui' : 'Jerome', cid, at: seq, ...extra };
}

describe('view: what is shared', () => {
  it('the stage and the board page travel; cameras and the faces box stay per device', () => {
    const t = layoutReducer(tutorLayout, { type: 'drop', tile: 'text', zone: 'left' });
    const v = viewOf(t, 'p2');
    expect(v).toEqual({ mode: 'split', main: 'text', second: 'remote', ratio: 0.5, dir: 'row', open: ['remote', 'text', 'self'], page: 'p2' });
    const s = applyView(studentLayout, v);
    expect(s.mode).toBe('split');
    expect([s.main, s.second]).toEqual(['text', 'remote']);
    // The student's own camera choices are untouched.
    expect(s.pairCorner).toBe(DEFAULT_LAYOUT.pairCorner);
    expect(s.pip).toBe('pair');
    expect(s.remoteFloat).toBe(true);
    expect(viewOf(s, 'p2')).toEqual(v);
  });

  it('the same logical layout is drawn for each screen size (layoutRects per device)', () => {
    const v = viewOf(layoutReducer(DEFAULT_LAYOUT, { type: 'drop', tile: 'screen', zone: 'left' }), null);
    const desk = applyView(tutorLayout, v);
    const phone = applyView(studentLayout, v);
    const a = { screen: true };
    expect(arrangeTiles(desk, a, 1280).stage).toEqual(['screen', 'remote']);
    expect(arrangeTiles(phone, a, 412).stage).toEqual(['screen']); // a phone shows one tile (screen + camera isn't a phone split)
    expect(layoutRects(phone, arrangeTiles(phone, a, 412), { w: 412, h: 800 }).tiles.screen.role).toBe('stage');
  });

  it('compares stages, ignoring a page nobody knows', () => {
    const a = viewOf({ ...DEFAULT_LAYOUT, main: 'text', open: ['remote', 'text', 'self'] }, 'p1');
    expect(sameStage(a, { ...a })).toBe(true);
    expect(sameStage(a, { ...a, page: null })).toBe(true);
    expect(sameStage(a, { ...a, page: 'p2' })).toBe(false);
    expect(sameStage(a, { ...a, main: 'draw' })).toBe(false);
    expect(sameStage(a, { ...a, second: 'chat' })).toBe(true); // focus: the second tile doesn't show
    expect(sameStage({ ...a, mode: 'split' }, { ...a, mode: 'split', second: 'chat' })).toBe(false);
    expect(sameStage({ ...a, mode: 'grid' }, { ...a, mode: 'grid', main: 'chat' })).toBe(true);
    expect(sameStage(a, { ...a, open: ['remote', 'self'] })).toBe(false);
    expect(sameStage(a, { ...a, ratio: a.ratio + 0.001 })).toBe(true);
  });

  it('cleans what clients send', () => {
    expect(sanitizeStageView({ mode: 'split', main: 'text', second: 'screen', ratio: 5, dir: 'column', open: ['chat', 'bogus'], page: 'p1' })).toEqual({
      mode: 'split', main: 'text', second: 'screen', ratio: 0.8, dir: 'column', open: ['remote', 'chat', 'self'], page: 'p1',
    });
    expect(sanitizeStageView({ mode: 'focus', main: 'nope' })).toBeNull();
    expect(sanitizeStageView({ mode: 'wide', main: 'text' })).toBeNull();
    expect(sanitizeStageView({ mode: 'focus', main: 'text', page: 'x'.repeat(65) })?.page).toBeNull();
    expect(sanitizeStageView(null)).toBeNull();
  });
});

describe('view: the room', () => {
  it('counts changes; a view without a page keeps the current page', () => {
    const v = viewOf(DEFAULT_LAYOUT, 'p1');
    const a = nextSharedView(null, v, { userId: T, name: 'Minghui' }, 'c1', false, 10);
    expect(a).toEqual({ ...v, seq: 1, by: T, name: 'Minghui', cid: 'c1', at: 10 });
    const b = nextSharedView(a, { ...v, page: null, main: 'chat' }, { userId: S, name: 'Jerome' }, 'c2', true, 11);
    expect(b).toMatchObject({ seq: 2, by: S, page: 'p1', main: 'chat', bring: true });
  });

  it('an older app’s "Show for student" focuses that tile on the shared stage', () => {
    const cur = viewOf({ ...DEFAULT_LAYOUT, mode: 'split', main: 'remote', second: 'chat', open: ['remote', 'chat', 'self'] }, 'p1');
    expect(viewForShow(cur, { kind: 'text', page: 'p3' })).toMatchObject({ mode: 'focus', main: 'text', page: 'p3', open: ['remote', 'text', 'chat', 'self'] });
    expect(viewForShow(cur, { kind: 'screen' })).toMatchObject({ mode: 'focus', main: 'screen', page: 'p1' });
    expect(viewForShow(null, { kind: 'draw' })).toMatchObject({ mode: 'focus', main: 'draw', page: null });
  });
});

describe('view: each device', () => {
  const v = viewOf(DEFAULT_LAYOUT, null);

  it('on Same view: another person’s change applies; my newest echo applies, an older one is skipped', () => {
    const opts = { myId: S, lastSentCid: 'c2', mode: 'same' as const, appliedSeq: 0 };
    expect(viewStep(shared(v, 1, T, 'x'), opts)).toBe('apply');
    expect(viewStep(shared(v, 1, S, 'c1'), opts)).toBe('skip');
    expect(viewStep(shared(v, 2, S, 'c2'), opts)).toBe('apply');
    expect(viewStep(shared(v, 2, T, 'x'), { ...opts, appliedSeq: 2 })).toBe('skip'); // already applied
    expect(viewStep(null, opts)).toBe('skip');
  });

  it('two changes at once end the same on both screens (the room’s order wins)', () => {
    // The tutor opens the board while the student opens the chat; the room takes the tutor's first.
    const board = viewOf(layoutReducer(DEFAULT_LAYOUT, { type: 'focus', tile: 'text' }), null);
    const chat = viewOf(layoutReducer(DEFAULT_LAYOUT, { type: 'focus', tile: 'chat' }), null);
    const order = [shared(board, 1, T, 't1'), shared(chat, 2, S, 's1')];
    const screens: Record<string, { layout: CallLayout; last: string; seq: number }> = { [T]: { layout: applyView(DEFAULT_LAYOUT, board), last: 't1', seq: 0 }, [S]: { layout: applyView(DEFAULT_LAYOUT, chat), last: 's1', seq: 0 } };
    for (const msg of order) {
      for (const who of [T, S]) {
        const me = screens[who];
        if (viewStep(msg, { myId: who, lastSentCid: me.last, mode: 'same', appliedSeq: me.seq }) === 'apply') me.layout = applyView(me.layout, msg);
        me.seq = Math.max(me.seq, msg.seq);
      }
    }
    expect(screens[T].layout.main).toBe('chat');
    expect(screens[S].layout.main).toBe('chat');
  });

  it('on my own view nothing is applied; "Bring … to my view" from them is an invitation', () => {
    const opts = { myId: S, lastSentCid: null, mode: 'own' as const, appliedSeq: 0 };
    expect(viewStep(shared(v, 1, T, 'x'), opts)).toBe('skip');
    expect(viewStep(shared(v, 2, T, 'x', { bring: true }), opts)).toBe('invite');
    expect(viewStep(shared(v, 3, S, 'c', { bring: true }), opts)).toBe('skip');
    // On Same view a bring simply applies.
    expect(viewStep(shared(v, 2, T, 'x', { bring: true }), { ...opts, mode: 'same' })).toBe('apply');
  });

  it('sends only on Same view, only a change', () => {
    expect(shouldSendView('same', null, v)).toBe(true);
    expect(shouldSendView('same', v, { ...v })).toBe(false);
    expect(shouldSendView('same', v, { ...v, main: 'text' })).toBe(true);
    expect(shouldSendView('own', v, { ...v, main: 'text' })).toBe(false);
  });

  it('words', () => {
    expect(viewChipLabel('same')).toBe('👥 Same view ✓');
    expect(viewChipLabel('own')).toBe('👤 My own view');
    expect(bringLabel('Jerome Swannack')).toBe('Bring Jerome to my view');
    expect(inviteText('Minghui')).toBe('Minghui wants you to see their view');
    expect(theyLookAroundText('')).toBe('The other person is looking around on their own');
  });
});

describe('view: pressing a toggle the other person just used', () => {
  it('keeps a tile they put on the stage a moment ago', async () => {
    const { keepJustShared, stageTilesOf, JUST_SHARED_MS } = await import('./view');
    const board = viewOf({ ...DEFAULT_LAYOUT, main: 'text', open: ['remote', 'text', 'self'] }, null);
    const theirs = { at: 1000, tiles: stageTilesOf(board) };
    expect(keepJustShared(theirs, 'text', 1000 + JUST_SHARED_MS - 1)).toBe(true);
    expect(keepJustShared(theirs, 'text', 1000 + JUST_SHARED_MS)).toBe(false);
    expect(keepJustShared(theirs, 'chat', 1500)).toBe(false);
    expect(keepJustShared(null, 'text', 1500)).toBe(false);
    expect(stageTilesOf({ ...board, mode: 'split', second: 'screen' })).toEqual(['text', 'screen']);
    expect(stageTilesOf({ ...board, mode: 'grid' })).toEqual(['remote', 'text', 'self']);
    const { theirLastView } = await import('./view');
    const cam = viewOf(DEFAULT_LAYOUT, null);
    expect(theirLastView(cam, board, 5)).toEqual({ at: 5, tiles: ['text'] });
    // A page turn on a board already up brings nothing new: my 📝 press then closes it as usual.
    expect(theirLastView(board, { ...board, page: 'p9' }, 6).tiles).toEqual([]);
  });
});
