/**
 * The "You said" box: what was said (hanzi, tidy pinyin) with a verdict chip; ▶ / ✎ as round
 * buttons in equal side columns (✎ Check in Coach only on the orange box); every waiting state uses
 * the same shell; Couldn't transcribe retries the take.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { YouSaid, YouSaidFailed, YouSaidPending, tidyPinyin } from './YouSaid';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
function render(node: React.ReactNode): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const q = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe('YouSaid', () => {
  it('shows the hanzi, the pinyin under it and a Match chip — no Coach button on a match', () => {
    const el = render(<YouSaid hanzi="曾" pinyin="céng" isMatch containsExpected={false} onCoach={() => {}} onPlay={() => {}} />);
    expect(q(el, 'you-said')!.dataset.state).toBe('match');
    expect(q(el, 'you-said-hanzi')!.textContent).toBe('曾');
    expect(q(el, 'you-said-pinyin')!.textContent).toBe('céng');
    expect(q(el, 'you-said-verdict')!.textContent).toBe('Match');
    expect(q(el, 'you-said-coach')).toBeNull();
    // ▶ on the left keeps an (empty) column on the right too, so the text stays centred.
    expect(q(el, 'you-said')!.classList.contains('you-said--sides')).toBe(true);
    expect(el.querySelectorAll('.you-said-side')).toHaveLength(2);
  });

  it('the orange box: "Contains the answer" and a round, named Check in Coach button', () => {
    const coach = vi.fn();
    const play = vi.fn();
    const el = render(<YouSaid hanzi="我曾经去过中国。" pinyin="wǒ céng jīng qù guò zhōng guó 。" isMatch={false} containsExpected onCoach={coach} onPlay={play} />);
    expect(q(el, 'you-said-verdict')!.textContent).toBe('Contains the answer');
    expect(q(el, 'you-said-pinyin')!.textContent).toBe('wǒ céng jīng qù guò zhōng guó。');
    const btn = q(el, 'you-said-coach')!;
    expect(btn.getAttribute('aria-label')).toBe('Check in Coach');
    expect(btn.className).toBe('you-said-round');
    act(() => btn.click());
    act(() => q(el, 'you-said-play')!.click());
    expect(coach).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('a miss says so; without ▶ or ✎ there are no side columns', () => {
    const el = render(<YouSaid hanzi="已经" pinyin="yǐ jīng" isMatch={false} containsExpected={false} onCoach={() => {}} />);
    expect(q(el, 'you-said')!.dataset.state).toBe('miss');
    expect(q(el, 'you-said-verdict')!.textContent).toBe('Didn’t match');
    expect(q(el, 'you-said-coach')).toBeNull();
    expect(el.querySelectorAll('.you-said-side')).toHaveLength(0);
  });

  it('Transcribing… is the same shell', () => {
    const pending = render(<YouSaidPending />);
    expect(pending.querySelector('.you-said')!.textContent).toContain('Transcribing…');
  });

  it('Couldn\'t transcribe is the same shell, and the whole box retries', () => {
    const retry = vi.fn();
    const el = render(<YouSaidFailed onRetry={retry} />);
    const box = q(el, 'transcription-retry')!;
    expect(box.classList.contains('you-said')).toBe(true);
    expect(box.textContent).toContain('Couldn’t transcribe');
    expect(box.textContent).toContain('Tap to retry · your recording is saved');
    act(() => box.click());
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('tidyPinyin drops the space before punctuation', () => {
    expect(tidyPinyin('céng jīng 。')).toBe('céng jīng。');
    expect(tidyPinyin('nǐ hǎo ， wǒ shì ？')).toBe('nǐ hǎo， wǒ shì？');
    expect(tidyPinyin('shì')).toBe('shì');
  });
});
