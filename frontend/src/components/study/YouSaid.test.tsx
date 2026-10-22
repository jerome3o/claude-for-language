/**
 * The "You said" box: what was said (hanzi, tidy pinyin) with a verdict chip; ▶ / ✎ as round
 * buttons in equal side columns (✎ Check in Coach only on the yellow box); every waiting state uses
 * the same shell; Couldn't transcribe retries the take.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { YouSaid, YouSaidFailed, YouSaidPending, YouSaidRow, tidyPinyin } from './YouSaid';

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

  it('the yellow box: "Contains the answer" and a round, named Check in Coach button', () => {
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

  it('each state has its own class, icon and words — the yellow "contains" never relies on colour alone', () => {
    const cases = [
      { props: { isMatch: true, containsExpected: false }, state: 'match', icon: 'check', words: 'Match' },
      { props: { isMatch: false, containsExpected: true }, state: 'contains', icon: 'approx', words: 'Contains the answer' },
      { props: { isMatch: false, containsExpected: false }, state: 'miss', icon: 'close', words: 'Didn’t match' },
    ] as const;
    const seen = new Set<string>();
    for (const c of cases) {
      const el = render(<YouSaid hanzi="一生救了他的命" pinyin="yì shēng jiù le tā de mìng" {...c.props} onPlay={() => {}} />);
      const box = q(el, 'you-said')!;
      expect(box.classList.contains(`you-said--${c.state}`)).toBe(true);
      expect(box.dataset.state).toBe(c.state);
      const chip = q(el, 'you-said-verdict')!;
      expect(chip.dataset.icon).toBe(c.icon);
      expect(chip.querySelector('svg')).not.toBeNull();
      expect(chip.textContent).toBe(c.words);
      seen.add(`${c.icon}|${c.words}`);
      act(() => root?.unmount());
      root = null;
    }
    expect(seen.size).toBe(3);
  });

  it('tidyPinyin drops the space before punctuation', () => {
    expect(tidyPinyin('céng jīng 。')).toBe('céng jīng。');
    expect(tidyPinyin('nǐ hǎo ， wǒ shì ？')).toBe('nǐ hǎo， wǒ shì？');
    expect(tidyPinyin('shì')).toBe('shì');
  });
});

/**
 * The spoken answer's ONE compact row (YouSaidRow): what was said, marked per character, with its
 * pinyin, and one verdict chip with its own icon and words; ▶ / ✎ round buttons; the whole row read
 * out as one sentence.
 */
describe('YouSaidRow', () => {
  const marks = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.spoken-mark')].map((m) => `${m.textContent}:${m.dataset.mark}`);
  const chip = (el: HTMLElement) => q(el, 'spoken-result-chip')!;

  it('exact: ✓ Match, nothing marked, ▶ but no ✎', () => {
    const play = vi.fn();
    const el = render(<YouSaidRow transcript="狼" correct="狼" verdict="exact" onPlay={play} onCoach={() => {}} />);
    expect(q(el, 'spoken-result')!.dataset.state).toBe('match');
    expect(chip(el).textContent).toBe('Match');
    expect(chip(el).dataset.icon).toBe('check');
    expect(marks(el)).toEqual(['狼:right']);
    expect(q(el, 'spoken-result-pinyin')!.textContent).toBe('láng');
    expect(q(el, 'you-said-coach')).toBeNull();
    act(() => q(el, 'you-said-play')!.click());
    expect(play).toHaveBeenCalledTimes(1);
    // A lone ▶ is balanced by an empty column on the right, so the text stays centred.
    expect(el.querySelectorAll('.spoken-result-side')).toHaveLength(1);
    expect(q(el, 'spoken-result-label')!.textContent).toBe('You said 狼 (láng). Match.');
  });

  it('sounded right (友 for 有): ✓ still, the character written differently marked yellow', () => {
    const el = render(<YouSaidRow transcript="友" correct="有" verdict="sound" onCoach={() => {}} />);
    expect(q(el, 'spoken-result')!.dataset.state).toBe('sound');
    expect(q(el, 'spoken-result')!.className).toContain('spoken-result--sound');
    expect(chip(el).textContent).toBe('Sounded right — written differently');
    expect(chip(el).dataset.icon).toBe('check');
    expect(marks(el)).toEqual(['友:differs']);
    expect(el.querySelector('.spoken-mark--differs')).not.toBeNull();
  });

  it('close (Jerome’s 狼 said 朗): ≈ Close — tones off, 朗 marked wrong, ✎ Open in Coach', () => {
    const coach = vi.fn();
    const el = render(<YouSaidRow transcript="朗" correct="狼" verdict="close" onPlay={() => {}} onCoach={coach} />);
    expect(q(el, 'spoken-result')!.dataset.state).toBe('close');
    expect(chip(el).textContent).toBe('Close — tones off');
    expect(chip(el).dataset.icon).toBe('approx');
    expect(chip(el).querySelector('svg')).not.toBeNull();
    expect(marks(el)).toEqual(['朗:wrong']);
    expect(q(el, 'spoken-result-pinyin')!.textContent).toBe('lǎng');
    expect(q(el, 'spoken-result-label')!.textContent).toBe('You said 朗 (lǎng). Close — the tones are off. Not in the answer: 朗.');
    // Said once: the transcript appears in exactly one visible place.
    expect(q(el, 'spoken-result-hanzi')!.textContent).toBe('朗');
    const btn = q(el, 'you-said-coach')!;
    expect(btn.getAttribute('aria-label')).toBe('Check in Coach');
    act(() => btn.click());
    expect(coach).toHaveBeenCalledTimes(1);
    expect(el.querySelectorAll('.spoken-result-side')).toHaveLength(0);
  });

  it('didn’t match: ✕, only the characters not in the answer marked; punctuation plain', () => {
    const el = render(<YouSaidRow transcript="我很好。" correct="你好" verdict="wrong" />);
    expect(q(el, 'spoken-result')!.dataset.state).toBe('wrong');
    expect(chip(el).textContent).toBe('Didn’t match');
    expect(chip(el).dataset.icon).toBe('close');
    expect(marks(el)).toEqual(['我:wrong', '很:wrong', '好:right', '。:plain']);
    expect(q(el, 'you-said-play')).toBeNull();
  });

  it('contains: ≈ Contains the answer, the answer’s characters right, the words around it plain', () => {
    const el = render(<YouSaidRow transcript="他长得很好" correct="长得" verdict="contains" />);
    expect(q(el, 'spoken-result')!.dataset.state).toBe('contains');
    expect(chip(el).textContent).toBe('Contains the answer');
    expect(marks(el)).toEqual(['他:plain', '长:right', '得:right', '很:plain', '好:plain']);
  });

  it('the visible parts are hidden from screen readers; the label says it all', () => {
    const el = render(<YouSaidRow transcript="猫" correct="狼" verdict="wrong" />);
    expect(el.querySelector('.spoken-result-said')!.getAttribute('aria-hidden')).toBe('true');
    expect(chip(el).getAttribute('aria-hidden')).toBe('true');
    expect(q(el, 'spoken-result-label')!.textContent).toBe('You said 猫 (māo). Didn’t match. Not in the answer: 猫.');
  });
});
