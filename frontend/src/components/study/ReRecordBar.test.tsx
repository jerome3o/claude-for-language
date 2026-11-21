/**
 * The card back's footer while a take is made again (Record again / Say it again / Say it practice):
 * the ratings are NOT rendered — the re-record's controls are, once — and they come back after
 * Submit / Back (the footer is given `rerecord: null` again).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StudyCardFooter, PEEK_RATINGS_LABEL, type ReRecordBarProps } from './ReRecordBar';
import { RatingButtons } from '../RatingButtons';
import { HardModeRatings } from './HardModeRatings';
import { PassAnswerButtons } from '../homework/PassAnswerButtons';
import type { GoodEasyGate } from '@shared/study/hardMode';
import type { IntervalPreview, Rating } from '../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const previews = Object.fromEntries(
  ([0, 1, 2, 3] as Rating[]).map((r) => [r, { intervalText: ['10m', '2w', '2.6w', '3.9w'][r] } as IntervalPreview]),
) as Record<Rating, IntervalPreview>;

function footer(rerecord: ReRecordBarProps | null, onRate = vi.fn()) {
  return (
    <StudyCardFooter
      rerecord={rerecord}
      actions={<div data-testid="study-action-row">Ask Claude · Edit card · ⋯</div>}
      ratings={<RatingButtons intervalPreviews={previews} onRate={onRate} disabled={false} />}
    />
  );
}

function render(node: React.ReactNode): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}
const rerender = (node: React.ReactNode) => act(() => root!.render(node));
const q = (id: string) => host!.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;
const ratings = () => host!.querySelectorAll('.rating-btn');
const click = (el: HTMLElement | null) => act(() => { el!.click(); });

describe('StudyCardFooter / ReRecordBar', () => {
  it('normal answer side: the action row and the four ratings', () => {
    render(footer(null));
    expect(ratings()).toHaveLength(4);
    expect(q('study-action-row')).not.toBeNull();
    expect(q('study-rerecord-bar')).toBeNull();
  });

  it('a Say it again on review: no ratings, no action row — Back · Retry · Edit and ONE Submit; ratings back after Submit', () => {
    const onSubmit = vi.fn();
    const onRetry = vi.fn();
    const onEdit = vi.fn();
    const onRate = vi.fn();
    render(footer({ step: 'review', onBack: vi.fn(), onSubmit, onRetry, onEdit }, onRate));
    expect(ratings()).toHaveLength(0);
    expect(q('study-action-row')).toBeNull();
    expect(host!.querySelectorAll('[data-testid="spoken-review-submit"]')).toHaveLength(1);
    click(q('spoken-review-retry'));
    click(q('spoken-review-edit'));
    click(q('spoken-review-submit'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onRate).not.toHaveBeenCalled();
    // Submitted: the card is back on the answer, the page passes no re-record any more.
    rerender(footer(null, onRate));
    expect(ratings()).toHaveLength(4);
    expect(q('study-rerecord-bar')).toBeNull();
  });

  it('Record again: ⏹ Stop where the ratings were and ← Back; Back returns the ratings', () => {
    const onBack = vi.fn();
    const onStop = vi.fn();
    render(footer({ step: 'recording', onBack, onStop }));
    expect(ratings()).toHaveLength(0);
    click(q('rerecord-stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
    click(q('rerecord-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
    rerender(footer(null));
    expect(ratings()).toHaveLength(4);
  });

  it('the microphone still opening: Stop does nothing yet', () => {
    const onStop = vi.fn();
    render(footer({ step: 'starting', onBack: vi.fn(), onStop }));
    expect(q('rerecord-stop')!.getAttribute('aria-disabled')).toBe('true');
    click(q('rerecord-stop'));
    expect(onStop).not.toHaveBeenCalled();
  });

  it('practice review has no Edit; editing has Retry + Check (disabled while empty); a take that gave nothing has one Retry', () => {
    render(footer({ step: 'review', practice: true, onBack: vi.fn(), onSubmit: vi.fn() }));
    expect(q('spoken-review-edit')).toBeNull();

    const onCheck = vi.fn();
    rerender(footer({ step: 'editing', canCheck: false, onBack: vi.fn(), onCheck, onRetry: vi.fn() }));
    expect(q('spoken-review-retry')).not.toBeNull();
    click(q('spoken-edit-check'));
    expect(onCheck).not.toHaveBeenCalled();
    rerender(footer({ step: 'editing', canCheck: true, onBack: vi.fn(), onCheck, onRetry: vi.fn() }));
    click(q('spoken-edit-check'));
    expect(onCheck).toHaveBeenCalledTimes(1);

    rerender(footer({ step: 'failed', onBack: vi.fn(), onRetry: vi.fn() }));
    expect(host!.querySelectorAll('[data-testid="spoken-review-retry"]')).toHaveLength(1);
    expect(q('spoken-review-submit')).toBeNull();
    expect(ratings()).toHaveLength(0);
  });
});

/**
 * Peek: the revealed card turned back to its question. The ratings stay in place (dimmed) but never rate —
 * a tap on any of them turns the card back to the answer instead; on the answer side they rate again at once.
 */
describe('StudyCardFooter — peeking at the question', () => {
  type Peek = { onFlipBack: () => void } | null;
  const peekFooter = (peek: Peek, ratingsNode: React.ReactNode) => (
    <StudyCardFooter rerecord={null} peek={peek} actions={<div data-testid="study-action-row" />} ratings={ratingsNode} />
  );

  it('a tap on a dimmed rating rates nothing and flips back; back on the answer it rates', () => {
    const onRate = vi.fn();
    const onFlipBack = vi.fn();
    const node = (peek: Peek) => peekFooter(peek, <RatingButtons intervalPreviews={previews} onRate={onRate} disabled={false} />);
    render(node({ onFlipBack }));
    // Still four buttons with their intervals (no layout jump), in a dimmed group.
    expect(ratings()).toHaveLength(4);
    expect(host!.textContent).toContain('2.6w');
    const group = q('study-ratings')!;
    expect(group.dataset.peeking).toBe('true');
    expect(group.className).toContain('is-peeking');
    expect(group.getAttribute('aria-label')).toBe(PEEK_RATINGS_LABEL);
    for (const r of ['again', 'hard', 'good', 'easy']) click(q(`rating-${r}`));
    expect(onRate).not.toHaveBeenCalled();
    expect(onFlipBack).toHaveBeenCalledTimes(4);

    // Flipped back to the answer (the page passes no peek): the same buttons rate at once.
    rerender(node(null));
    expect(q('study-ratings')!.dataset.peeking).toBeUndefined();
    click(q('rating-good'));
    expect(onRate).toHaveBeenCalledWith(2);
  });

  it("Hard mode's greyed Good is neither armed nor rated by taps while peeking", () => {
    const onRate = vi.fn();
    const onArmed = vi.fn();
    const onFlipBack = vi.fn();
    const goodEasy: GoodEasyGate = { state: 'suggest_lower', reason: 'gave_up', label: 'You looked at the answer', gaveUp: true };
    const node = (peek: Peek) =>
      peekFooter(peek, <HardModeRatings goodEasy={goodEasy} intervalPreviews={previews} onRate={onRate} onArmed={onArmed} disabled={false} />);
    render(node({ onFlipBack }));
    click(q('rating-good'));
    click(q('rating-good'));
    expect(onArmed).not.toHaveBeenCalled();
    expect(onRate).not.toHaveBeenCalled();
    expect(onFlipBack).toHaveBeenCalledTimes(2);
    // On the answer side its own rule is unchanged: the first tap arms, the second rates.
    rerender(node(null));
    click(q('rating-good'));
    expect(onArmed).toHaveBeenCalledTimes(1);
    expect(onRate).not.toHaveBeenCalled();
    click(q('rating-good'));
    expect(onRate).toHaveBeenCalledWith(2);
  });

  it("the homework pass's Not yet / Got it don't answer while peeking", () => {
    const onAnswer = vi.fn();
    const onFlipBack = vi.fn();
    const node = (peek: Peek) => peekFooter(peek, <PassAnswerButtons suggested={null} onAnswer={onAnswer} />);
    render(node({ onFlipBack }));
    click(q('hw-notyet'));
    click(q('hw-gotit'));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(onFlipBack).toHaveBeenCalledTimes(2);
    rerender(node(null));
    click(q('hw-gotit'));
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it('the action row (Ask Claude · Edit card · ⋯) keeps its taps while peeking', () => {
    const onAsk = vi.fn();
    const onFlipBack = vi.fn();
    render(
      <StudyCardFooter
        rerecord={null}
        peek={{ onFlipBack }}
        actions={<button type="button" data-testid="ask" onClick={onAsk}>Ask Claude</button>}
        ratings={<RatingButtons intervalPreviews={previews} onRate={vi.fn()} disabled={false} />}
      />,
    );
    click(q('ask'));
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onFlipBack).not.toHaveBeenCalled();
  });
});
