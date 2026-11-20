/**
 * The slim answer feedback (AnswerDiff): his own pinyin under "You said" with his wrong syllables marked, and the small
 * "💬 Ask Claude" link when the check gave no reason (shared/cards/answer-why.ts `answerAskOffered`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AnswerDiff } from './AnswerDiff';
import { AnswerAskContext } from './answerAsk';
import { YouSaid, YouSaidRow } from './YouSaid';

vi.mock('../../services/analytics', () => ({ track: vi.fn() }));

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
const WRONG = { tone: 'wrong' as const, label: 'Not quite' };

describe('AnswerDiff — pinyin under "You said"', () => {
  it('shows his own syllables, the wrong one marked like its character', () => {
    const el = render(<AnswerDiff said="他捂住了我" expected="他侮辱了我" expectedPinyin="Tā wǔrǔle wǒ" verdict={WRONG} />);
    const py = q(el, 'answer-diff-said-pinyin')!;
    expect(py.textContent).toBe('tā wǔ zhù le wǒ');
    const marked = [...py.querySelectorAll('[data-kind]')].map((n) => `${n.textContent}:${(n as HTMLElement).dataset.kind}`);
    expect(marked).toEqual(['zhù:wrong']);
    // The homophone 捂 (wǔ, as in 侮) counts as right: no mark on it.
    expect(py.innerHTML).not.toContain('sound');
  });

  it('an extra character’s syllable is marked extra; a missing one has no syllable', () => {
    const el = render(<AnswerDiff said="我们去了北京" expected="我们去北京吗" verdict={WRONG} />);
    const py = q(el, 'answer-diff-said-pinyin')!;
    expect(py.textContent).toBe('wǒ men qù le běi jīng');
    expect([...py.querySelectorAll('[data-kind]')].map((n) => n.textContent)).toEqual(['le']);
  });

  it('a WRITTEN answer has no pinyin line (its homophones are wrong characters)', () => {
    const el = render(<AnswerDiff said="图书官" expected="图书馆" written saidLabel="You wrote" />);
    expect(q(el, 'answer-diff-said-pinyin')).toBeNull();
  });

  it('punctuation in the transcript never shows as a difference', () => {
    const el = render(<AnswerDiff said="“我去”～" expected="我去。" />);
    expect(q(el, 'answer-diff-text')!.textContent).toBe('Right');
    expect(q(el, 'answer-diff-chars')!.querySelectorAll('[data-kind]')).toHaveLength(0);
    expect(q(el, 'answer-diff-said-pinyin')!.querySelectorAll('[data-kind]')).toHaveLength(0);
  });
});

describe('AnswerDiff — 💬 Ask Claude when nothing explains a wrong answer', () => {
  it('offers the link (one small text link) when online and the check gave no reason; it asks the card’s thread', () => {
    // (No homophone either: "Same sounds — written differently" would be the device's own why.)
    const ask = vi.fn();
    const el = render(
      <AnswerAskContext.Provider value={{ ask }}>
        <AnswerDiff said="他打了我" expected="他侮辱了我" showExpected={false} verdict={WRONG} askPrompt="He insulted me" />
      </AnswerAskContext.Provider>,
    );
    const link = q(el, 'answer-ask-claude')!;
    expect(link.textContent).toBe('💬 Ask Claude');
    expect(q(el, 'answer-why-more')).toBeNull();
    act(() => link.click());
    expect(ask).toHaveBeenCalledWith('I was asked to say “He insulted me”. I said “他打了我” but the answer is “他侮辱了我”. What did I get wrong?');
  });

  it('never when a why line is there (its "Explain more ›" asks instead), never for a right answer, never offline', () => {
    const ask = vi.fn();
    const withWhy = render(
      <AnswerAskContext.Provider value={{ ask }}>
        <AnswerDiff said="他捂住了我" expected="他侮辱了我" verdict={WRONG} check={{ headline: 'Wrong verb — 捂住 means cover up, not insult.' }} />
      </AnswerAskContext.Provider>,
    );
    expect(q(withWhy, 'answer-ask-claude')).toBeNull();
    expect(q(withWhy, 'answer-why-text')!.textContent).toContain('Wrong verb');
    act(() => q(withWhy, 'answer-why-more')!.click());
    expect(ask).toHaveBeenCalledTimes(1);
    act(() => root?.unmount());

    const right = render(
      <AnswerAskContext.Provider value={{ ask }}>
        <AnswerDiff said="他侮辱了我" expected="他侮辱了我" />
      </AnswerAskContext.Provider>,
    );
    expect(q(right, 'answer-ask-claude')).toBeNull();
    act(() => root?.unmount());

    const offline = render(<AnswerDiff said="他打了我" expected="他侮辱了我" verdict={WRONG} />);
    expect(q(offline, 'answer-ask-claude')).toBeNull();
  });

  it('not while the answer is still hidden or Claude is still checking (askable={false})', () => {
    const el = render(
      <AnswerAskContext.Provider value={{ ask: vi.fn() }}>
        <AnswerDiff said="他打了我" expected="他侮辱了我" showExpected={false} verdict={WRONG} askable={false} />
      </AnswerAskContext.Provider>,
    );
    expect(q(el, 'answer-ask-claude')).toBeNull();
  });
});

describe('"You said" rows mark the pinyin too', () => {
  it('the read take’s box: his pinyin with the wrong syllable marked', () => {
    const el = render(<YouSaid hanzi="他捂住了我" pinyin="tā wǔ zhù le wǒ" isMatch={false} containsExpected={false} expected="他侮辱了我" />);
    const py = q(el, 'you-said-pinyin-marked')!;
    expect(py.textContent).toBe('tā wǔ zhù le wǒ');
    expect([...py.querySelectorAll('[data-kind]')].map((n) => n.textContent)).toEqual(['zhù']);
  });

  it('the typing card’s compact row (close / didn’t match)', () => {
    const el = render(<YouSaidRow transcript="他捂住了我" correct="他侮辱了我" verdict="wrong" />);
    const py = q(el, 'spoken-result-pinyin-marked')!;
    expect(py.textContent).toBe('tā wǔ zhù le wǒ');
    expect([...py.querySelectorAll('[data-kind]')].map((n) => n.textContent)).toEqual(['zhù']);
  });
});
