/**
 * The chat composer's voice side: each state shows its buttons, the dictation 🎤 and the voice-message
 * waveform are never the same control, and every button reaches its action.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DictationComposer } from './DictationComposer';
import { enterToSubmit } from '../voice/enterToSubmit';
import type { DictationState } from '@shared/voice/dictation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const actions = () => ({ say: vi.fn(), stop: vi.fn(), cancel: vi.fn(), retake: vi.fn(), retryUpload: vi.fn(), edit: vi.fn(), type: vi.fn(), submit: vi.fn() });
const state = (s: Partial<DictationState>): DictationState => ({ mode: 'voice', phase: 'idle', failure: null, blocked: null, ...s });

function render(s: DictationState, a = actions(), extra: { onCheck?: (() => void) | null; finalText?: string; partialText?: string } = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <DictationComposer
        state={s}
        finalText={extra.finalText ?? ''}
        partialText={extra.partialText ?? ''}
        actions={a}
        attach={<button data-testid="attach">+</button>}
        onCheck={extra.onCheck ?? null}
      />,
    );
  });
  const q = (id: string) => host!.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  return { q, a };
}

describe('DictationComposer', () => {
  it('idle: [+] [⌨️] [🎤 Say it] — Say it dictates, ⌨️ types', () => {
    const { q, a } = render(state({}));
    expect(q('attach')).not.toBeNull();
    expect(q('chat-say-btn')!.textContent).toContain('Say it');
    act(() => q('chat-say-btn')!.click());
    act(() => q('chat-type-btn')!.click());
    expect(a.say).toHaveBeenCalledTimes(1);
    expect(a.type).toHaveBeenCalledTimes(1);
    // The voice-message button is NOT part of the dictation row (ChatPage renders it once).
    expect(host!.querySelector('[data-testid="chat-mic-btn"]')).toBeNull();
  });

  it('listening: the words as they come (final + grey tail), ✕ cancels, ⏹ stops', () => {
    const { q, a } = render(state({ phase: 'listening' }), actions(), { finalText: '我明天', partialText: '下午' });
    expect(q('chat-dictate-live')!.textContent).toBe('我明天下午');
    expect(host!.querySelector('.chat-dictate-interim')!.textContent).toBe('下午');
    act(() => q('chat-dictate-stop')!.click());
    act(() => q('chat-dictate-cancel')!.click());
    expect(a.stop).toHaveBeenCalled();
    expect(a.cancel).toHaveBeenCalled();
  });

  it('finishing: Stop turns into a spinner and does nothing', () => {
    const { q } = render(state({ phase: 'finishing' }));
    expect((q('chat-dictate-stop') as HTMLButtonElement).disabled).toBe(true);
  });

  it('review: the text (tap = edit), ✏️, ✓ Check when it applies, ➤ sends, 🔁 again', () => {
    const onCheck = vi.fn();
    const { q, a } = render(state({ phase: 'review' }), actions(), { finalText: '我明天下午有空', onCheck });
    expect(q('chat-dictate-review-text')!.textContent).toBe('我明天下午有空');
    act(() => q('chat-dictate-review-text')!.click());
    act(() => q('chat-dictate-edit')!.click());
    act(() => q('chat-dictate-check')!.click());
    act(() => q('chat-dictate-send')!.click());
    act(() => q('chat-dictate-retake')!.click());
    expect(a.edit).toHaveBeenCalledTimes(2);
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(a.submit).toHaveBeenCalledTimes(1);
    expect(a.retake).toHaveBeenCalledTimes(1);
  });

  it('review without Check (not the learner / no Chinese): no ✓', () => {
    const { q } = render(state({ phase: 'review' }), actions(), { finalText: 'see you then' });
    expect(q('chat-dictate-check')).toBeNull();
  });

  it('failed: "Couldn\'t transcribe — tap to retry" retries the same take; nothing heard has no retry box', () => {
    const { q, a } = render(state({ phase: 'failed', failure: 'failed' }));
    act(() => q('chat-dictate-retry-upload')!.click());
    expect(a.retryUpload).toHaveBeenCalled();
    act(() => root!.unmount());
    host!.remove();
    const empty = render(state({ phase: 'failed', failure: 'empty' }));
    expect(empty.q('chat-dictate-retry-upload')).toBeNull();
    expect(empty.q('chat-dictate-empty')).not.toBeNull();
  });
});

describe('enterToSubmit', () => {
  const key = (init: KeyboardEventInit, target: EventTarget, composing = false) =>
    ({ key: init.key, shiftKey: !!init.shiftKey, target, nativeEvent: { isComposing: composing }, preventDefault: vi.fn() }) as unknown as React.KeyboardEvent<HTMLElement>;
  it('Enter in the textarea submits; Shift+Enter, IME composing and other elements do not', () => {
    const submit = vi.fn();
    const handler = enterToSubmit(submit);
    const ta = document.createElement('textarea');
    handler(key({ key: 'Enter' }, ta));
    handler(key({ key: 'Enter', shiftKey: true }, ta));
    handler(key({ key: 'Enter' }, ta, true));
    handler(key({ key: 'Enter' }, document.createElement('button')));
    handler(key({ key: 'a' }, ta));
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
