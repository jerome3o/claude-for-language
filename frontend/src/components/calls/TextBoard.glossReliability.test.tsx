/**
 * The board's tab-complete must not be killed by what goes on around it (23 Oct 2026: it
 * worked now and then for Jerome and not at all for Minghui): the other person typing while
 * my answer is on its way, a slow server, a failed one. The device's own gloss covers the wait.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TextDoc, type TextOp } from '@shared/calls';

const track = vi.fn();
vi.mock('../../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: () => {} }));

import { TextBoardSession } from '../../services/calls/textBoard';
import { TextBoard } from './TextBoard';
import type { GlossFetcher, LocalGlossFetcher } from './useBoardGloss';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let other: TextDoc;

function mount(fetchGloss: GlossFetcher, localGloss: LocalGlossFetcher | null = null) {
  const session = new TextBoardSession('user-tutor', (m) => {
    if (m.type === 'text') m.ops.forEach((op: TextOp) => other.apply(op));
    return true;
  });
  act(() => {
    root.render(<TextBoard session={session} gloss={{ callId: 'c1', userId: 'user-tutor', fetchGloss, localGloss }} />);
  });
  const ta = host.querySelector('textarea')!;
  act(() => ta.focus());
  return { session, ta };
}

const type = (ta: HTMLTextAreaElement, value: string) =>
  act(() => {
    ta.value = value;
    ta.setSelectionRange(value.length, value.length);
    ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  });

async function pause(ms = 600) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const ghost = () => host.querySelector('[data-testid="text-board-ghost"]') as HTMLElement | null;

beforeEach(() => {
  vi.useFakeTimers();
  track.mockReset();
  other = new TextDoc('student:x');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('board tab-complete reliability', () => {
  it('the other person typing (even above my line) while my answer is on its way: it still shows, asked once', async () => {
    let answer: (v: unknown) => void = () => {};
    const fetchGloss = vi.fn(() => new Promise((r) => (answer = r))) as unknown as GlossFetcher;
    const { session, ta } = mount(fetchGloss);
    type(ta, '你好');
    await pause();
    expect(fetchGloss).toHaveBeenCalledTimes(1);
    // Minghui types a line ABOVE mine, keystroke by keystroke, while the answer is on its way.
    for (const t of ['老', '老师', '老师好']) {
      act(() => session.applyRemote(other.replaceText(`${t}\n你好`)));
      await pause(200);
    }
    expect(ta.value).toBe('老师好\n你好');
    await act(async () => {
      answer({ gloss: { pinyin: 'nǐ hǎo', english: 'hello' }, outcome: 'server', status: 0 });
    });
    expect(ghost()?.textContent).toContain('nǐ hǎo - hello');
    expect(fetchGloss).toHaveBeenCalledTimes(1);
    // Tab types it at MY caret (the line moved down).
    act(() => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(ta.value).toBe('老师好\n你好 - nǐ hǎo - hello');
    expect(track).toHaveBeenCalledWith('call.board_gloss_lookup', expect.objectContaining({ outcome: 'server', shown: 'server', direction: 'zh' }));
    expect(track).toHaveBeenCalledWith('call.board_gloss', { direction: 'zh', via: 'tab', source: 'server' });
  });

  it('a shown suggestion survives the other person typing elsewhere', async () => {
    const fetchGloss = vi.fn(async () => ({ pinyin: 'xièxie', english: 'thanks' })) as unknown as GlossFetcher;
    const { session, ta } = mount(fetchGloss);
    type(ta, '谢谢');
    await pause();
    expect(ghost()?.textContent).toContain('xièxie - thanks');
    act(() => session.applyRemote(other.replaceText('好\n谢谢')));
    expect(ghost()?.textContent).toContain('xièxie - thanks');
  });

  it('the device gloss shows at once and the server\'s replaces it', async () => {
    let answer: (v: unknown) => void = () => {};
    const fetchGloss = vi.fn(() => new Promise((r) => (answer = r))) as unknown as GlossFetcher;
    const localGloss = vi.fn(async () => ({ pinyin: 'yínháng', english: 'bank' }));
    const { ta } = mount(fetchGloss, localGloss);
    type(ta, '银行');
    await pause();
    expect(localGloss).toHaveBeenCalledWith('银行');
    expect(ghost()?.textContent).toContain('yínháng - bank');
    expect(ghost()?.dataset.source).toBe('local');
    await act(async () => {
      answer({ pinyin: 'yínháng', english: 'a bank' });
    });
    expect(ghost()?.textContent).toContain('yínháng - a bank');
    expect(ghost()?.dataset.source).toBe('server');
  });

  it('pinyin without a meaning waits a little for the server; when the server fails it shows anyway', async () => {
    let fail: (v: unknown) => void = () => {};
    const fetchGloss = vi.fn(() => new Promise((r) => (fail = r))) as unknown as GlossFetcher;
    const localGloss = vi.fn(async () => ({ pinyin: 'wǒ xiǎng qù', english: '' }));
    const { ta } = mount(fetchGloss, localGloss);
    type(ta, '我想去');
    await pause(); // the debounce
    expect(ghost()).toBeNull();
    await pause(1_000); // GLOSS_LOCAL_AFTER_MS later: the device's pinyin
    expect(ghost()?.textContent).toContain(' - wǒ xiǎng qù');
    await act(async () => {
      fail({ gloss: null, outcome: 'unavailable', status: 503 });
    });
    expect(ghost()?.textContent).toContain(' - wǒ xiǎng qù');
    expect(track).toHaveBeenCalledWith('call.board_gloss_lookup', expect.objectContaining({ outcome: 'unavailable', status: 503, shown: 'local' }));
  });

  it('a fast failure shows the device gloss straight away', async () => {
    const fetchGloss = vi.fn(async () => ({ gloss: null, outcome: 'rate_limited', status: 429 })) as unknown as GlossFetcher;
    const localGloss = vi.fn(async () => ({ pinyin: 'wǒ xiǎng qù', english: '' }));
    const { ta } = mount(fetchGloss, localGloss);
    type(ta, '我想去');
    await pause();
    expect(ghost()?.textContent).toContain(' - wǒ xiǎng qù');
  });

  it('my segment changing drops the wait (reported as superseded)', async () => {
    const fetchGloss = vi.fn(() => new Promise(() => {})) as unknown as GlossFetcher;
    const { ta } = mount(fetchGloss);
    type(ta, '你');
    await pause();
    type(ta, '你好');
    await pause();
    expect(fetchGloss).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenCalledWith('call.board_gloss_lookup', expect.objectContaining({ outcome: 'superseded', shown: 'none' }));
  });
});
