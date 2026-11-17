/**
 * The "right" moment on the study card (shared/study/rightMoment.ts; docs/STUDY_SESSION.md "A right answer you can
 * see"): drop it inside the thing that was right (any `position: relative` element — the class `right-moment-host`
 * makes one). A soft green wash flashes in and settles to the host's own green result surface (index.css
 * .result-surface--right — the host shows its ✓: a chip, the exercise number, "✓ Right"; `mark` adds one at the top
 * right where it has none), and a small confetti burst (the lesson feedback's) flies from it. The haptic + sound are played where the verdict lands
 * (StudyFeel) — `feel` plays them here where nothing else does — so nothing is felt twice. Reduce motion: no
 * confetti, the tint at once.
 * Lab: `RightMoment` in ui/study/RightMomentUi.kt.
 */
import { useEffect, useState } from 'react';
import { studyFeel } from '../../services/studyFeel';
import { rightMoment, type RightMomentWhere } from '@shared/study/rightMoment';
import { ConfettiBurst } from '../ConfettiBurst';
import './RightMoment.css';

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function RightMoment({ where, roundDone = false, celebrated = false, feel = false, mark = false, testId = 'right-moment' }: {
  where: RightMomentWhere;
  /** The round's last right exercise ("2 / 2"): a slightly bigger burst. */
  roundDone?: boolean;
  /** Already celebrated on this showing: the tint only, no burst. */
  celebrated?: boolean;
  /** Also play the moment's feel (haptic + sound) — only where nothing else plays it (the typed answer on the back). */
  feel?: boolean;
  /** Show the ✓ at the top right — only where the host has no ✓ of its own (every study surface has one). */
  mark?: boolean;
  testId?: string;
}) {
  // Decided once, when it appears: a later re-render never fires the burst again.
  const [moment] = useState(() => rightMoment(where, { roundDone, reduceMotion: prefersReducedMotion(), celebrated }));
  useEffect(() => {
    if (feel) studyFeel(moment.feel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span
      className={`right-moment${moment.animate ? ' is-animated' : ''}`}
      style={{ ['--right-moment-ms' as string]: `${moment.durationMs}ms` }}
      aria-hidden="true"
      data-testid={testId}
      data-where={where}
      data-confetti={moment.confetti}
    >
      {mark && <span className="right-moment-check">✓</span>}
      {moment.confetti > 0 && (
        <span className="right-moment-burst">
          <ConfettiBurst count={moment.confetti} testId={`${testId}-burst`} />
        </span>
      )}
    </span>
  );
}
