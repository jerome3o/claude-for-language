/**
 * The study card's 📚 deck pill: the name is cut to one line (ellipsis class), a tap shows the
 * FULL name with "Open deck →", a tap elsewhere / Escape closes it, and no tap on it ever reaches
 * the card underneath (so it never peeks back at the question). Where it sits — the answer side
 * only, never the question — is StudyPage's; e2e study-deck-pill.spec.ts covers it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DeckPill } from './DeckPill';

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
const LONG = '课堂生词 Lesson words – 12 Oct (from tutor)';

describe('DeckPill', () => {
  it('shows the name on one truncated line with the full name as its label', () => {
    const el = render(<DeckPill name={LONG} />);
    const pill = q(el, 'study-deck-pill')!;
    expect(pill.getAttribute('aria-label')).toBe(`Deck: ${LONG}`);
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    const label = q(el, 'study-deck-pill-label')!;
    expect(label.classList.contains('deck-pill__name')).toBe(true);
    expect(label.textContent).toBe(LONG);
    expect(q(el, 'study-deck-pill-full')).toBeNull();
  });

  it('a tap shows the full name and never reaches the card underneath', () => {
    const onCardClick = vi.fn();
    const onCardDown = vi.fn();
    const el = render(
      <div onClick={onCardClick} onPointerDown={onCardDown}>
        <DeckPill name={LONG} onOpenDeck={() => {}} />
      </div>,
    );
    const pill = q(el, 'study-deck-pill')!;
    act(() => {
      pill.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      pill.click();
    });
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    expect(q(el, 'study-deck-pill-name')!.textContent).toBe(LONG);
    expect(q(el, 'study-deck-pill-open')!.textContent).toContain('Open deck');
    // The full name keeps "(from tutor)" — nothing is cut in the popover.
    expect(q(el, 'study-deck-pill-name')!.textContent).toContain('(from tutor)');
    act(() => q(el, 'study-deck-pill-name')!.click());
    expect(onCardClick).not.toHaveBeenCalled();
    expect(onCardDown).not.toHaveBeenCalled();
  });

  it('a tap elsewhere or Escape closes it; tapping the pill again too', () => {
    const el = render(<DeckPill name={LONG} />);
    const pill = q(el, 'study-deck-pill')!;
    act(() => pill.click());
    expect(q(el, 'study-deck-pill-full')).not.toBeNull();
    act(() => { document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(q(el, 'study-deck-pill-full')).toBeNull();
    act(() => pill.click());
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(q(el, 'study-deck-pill-full')).toBeNull();
    act(() => pill.click());
    act(() => pill.click());
    expect(q(el, 'study-deck-pill-full')).toBeNull();
  });

  it('"Open deck →" opens the deck and closes the popover; no link without a handler', () => {
    const onOpenDeck = vi.fn();
    const el = render(<DeckPill name="HSK 3" onOpenDeck={onOpenDeck} />);
    act(() => q(el, 'study-deck-pill')!.click());
    act(() => q(el, 'study-deck-pill-open')!.click());
    expect(onOpenDeck).toHaveBeenCalledTimes(1);
    expect(q(el, 'study-deck-pill-full')).toBeNull();
    act(() => root?.unmount());
    root = null;
    const el2 = render(<DeckPill name="HSK 3" />);
    act(() => q(el2, 'study-deck-pill')!.click());
    expect(q(el2, 'study-deck-pill-open')).toBeNull();
  });
});
