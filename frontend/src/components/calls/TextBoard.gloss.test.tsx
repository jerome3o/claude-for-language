/**
 * The board's tab-complete must come back after every way an IME can commit.
 * Browsers / IMEs disagree on the order of the last events: the spec (and the
 * Linux CDP IME in our E2E) sends input(isComposing) → compositionend, but
 * some macOS IMEs in Chrome send compositionend FIRST and the input event
 * carrying the committed text (isComposing: true) after it. Since round 4 that
 * trailing input re-opened the composition on our side and nothing ever closed
 * it again — no suggestion was ever asked for (Minghui, 5 Oct 2026).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TextBoardSession } from '../../services/calls/textBoard';
import { TextBoard } from './TextBoard';
import type { GlossFetcher } from './useBoardGloss';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let fetchGloss: ReturnType<typeof vi.fn>;
let sent: unknown[];

function mount() {
  const session = new TextBoardSession('user-tutor', (m) => {
    sent.push(m);
    return true;
  });
  act(() => {
    root.render(<TextBoard session={session} gloss={{ callId: 'c1', userId: 'user-tutor', fetchGloss: fetchGloss as unknown as GlossFetcher }} />);
  });
  const ta = host.querySelector('textarea')!;
  act(() => ta.focus());
  return { session, ta };
}

const comp = (ta: HTMLTextAreaElement, type: 'compositionstart' | 'compositionupdate' | 'compositionend', data: string) =>
  act(() => {
    ta.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }));
  });

const input = (ta: HTMLTextAreaElement, value: string, isComposing: boolean) =>
  act(() => {
    ta.value = value;
    ta.setSelectionRange(value.length, value.length);
    ta.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing, inputType: isComposing ? 'insertCompositionText' : 'insertText', data: value }));
  });

async function pause(ms = 600) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  fetchGloss = vi.fn(async (segment: string) => ({ pinyin: segment === '你好' ? 'nǐ hǎo' : 'xièxie', english: segment === '你好' ? 'hello' : 'thanks' }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('board tab-complete after an IME commit', () => {
  it('spec order: input(isComposing) → compositionend → a suggestion after the pause', async () => {
    const { session, ta } = mount();
    comp(ta, 'compositionstart', '');
    comp(ta, 'compositionupdate', 'nihao');
    input(ta, 'nihao', true);
    comp(ta, 'compositionupdate', '你好');
    input(ta, '你好', true);
    comp(ta, 'compositionend', '你好');
    expect(session.isComposing).toBe(false);
    await pause();
    expect(fetchGloss).toHaveBeenCalledWith('你好', expect.anything());
    expect(host.querySelector('[data-testid="text-board-ghost"]')?.textContent).toContain('nǐ hǎo - hello');
  });

  it('compositionend BEFORE the committing input event (macOS IMEs in Chrome): still a suggestion, and the text goes out', async () => {
    const { session, ta } = mount();
    comp(ta, 'compositionstart', '');
    comp(ta, 'compositionupdate', 'nihao');
    input(ta, 'nihao', true);
    comp(ta, 'compositionend', '你好');
    input(ta, '你好', true); // the committed text arrives after compositionend, still flagged isComposing
    expect(session.isComposing).toBe(false);
    expect(session.text).toBe('你好');
    await pause();
    expect(fetchGloss).toHaveBeenCalledWith('你好', expect.anything());
    expect(host.querySelector('[data-testid="text-board-ghost"]')?.textContent).toContain('nǐ hǎo - hello');

    // …and the next word, typed the same way, gets one too.
    comp(ta, 'compositionstart', '');
    comp(ta, 'compositionupdate', 'xiexie');
    input(ta, '你好\nxiexie', true);
    comp(ta, 'compositionend', '谢谢');
    input(ta, '你好\n谢谢', true);
    await pause();
    expect(fetchGloss).toHaveBeenCalledWith('谢谢', expect.anything());
  });

  it('nothing is asked while a composition is really open', async () => {
    const { ta } = mount();
    comp(ta, 'compositionstart', '');
    comp(ta, 'compositionupdate', 'nihao');
    input(ta, '你好nihao', true);
    await pause(2000);
    expect(fetchGloss).not.toHaveBeenCalled();
  });
});

describe('board tab-complete: the ghost sits at the caret', () => {
  it('the ghost layer holds the whole text (invisible after the caret), so it scrolls exactly like the textarea', async () => {
    const { ta } = mount();
    // A long board; the caret at the end of a line in the middle (the ghost only comes at a line's end).
    const below = Array.from({ length: 40 }, (_, i) => `第${i + 1}行`).join('\n');
    act(() => {
      ta.value = `开始\n你好\n${below}`;
      ta.setSelectionRange(5, 5); // after 你好
      ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '好' }));
    });
    await pause();
    const ghost = host.querySelector('[data-testid="text-board-ghost"]')!;
    expect(ghost.textContent).toContain('nǐ hǎo - hello');
    const layer = ghost.parentElement!;
    // Before the ghost: exactly the text up to the caret; after it: the rest — the layer is as tall as the textarea's text.
    expect(layer.firstChild?.textContent).toBe('开始\n你好');
    expect(layer.querySelector('.tb-ghost-after')?.textContent).toBe(`\n${below}`);
    // …and it follows the textarea's scroll.
    act(() => {
      ta.scrollTop = 300;
      ta.dispatchEvent(new Event('scroll'));
    });
    expect(layer.scrollTop).toBe(ta.scrollTop);
  });
});
