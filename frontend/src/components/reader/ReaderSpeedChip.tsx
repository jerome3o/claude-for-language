import { nextReaderSpeed, readerSpeedLabel } from '@shared/reader/speed';
import { cycleReaderSpeed, useReaderSpeed } from '../../services/readerSpeed';
import './ReaderSpeedChip.css';

/**
 * The reader's playback-speed chip: one tap cycles 1× → 0.75× → 0.5× → 1×.
 * The speed applies at playback (pitch kept, never regenerated) to the page
 * narration and the word ▶ in every reader view, and is remembered on the
 * device. Lit while slowed, so a slowed reader is obvious at a glance.
 */
export function ReaderSpeedChip({ className = '' }: { className?: string }) {
  const speed = useReaderSpeed();
  const slowed = speed !== 1;
  return (
    <button
      type="button"
      className={`reader-speed-chip${slowed ? ' slowed' : ''}${className ? ` ${className}` : ''}`}
      onClick={e => {
        // Inside tappable reader blocks: never also toggle what's behind it
        e.stopPropagation();
        cycleReaderSpeed();
      }}
      aria-label={`Playback speed ${readerSpeedLabel(speed)} — tap for ${readerSpeedLabel(nextReaderSpeed(speed))}`}
      title="Playback speed"
      data-testid="reader-speed-chip"
    >
      {readerSpeedLabel(speed)}
    </button>
  );
}
