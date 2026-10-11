import type { KeyboardEvent } from 'react';

/**
 * Enter sends from a chat-like voice-first box's typing textarea (Shift+Enter = new line, never while an
 * IME is composing) — the old Ask / Send boxes did, and `VoiceTextInput`'s multiline box doesn't by itself.
 * Put it on a wrapper: the key bubbles up from the textarea.
 */
export function enterToSubmit(submit: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    if (!(e.target instanceof HTMLTextAreaElement)) return;
    e.preventDefault();
    submit();
  };
}
