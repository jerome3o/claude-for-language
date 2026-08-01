import { useState, useRef } from 'react';
import { QueueCounts } from '../types';
import { copyQueueCountsImage } from '../utils/queue-counts-image';

/**
 * Study top-bar queue counts (new + secondary + learning + review).
 * Tapping it copies the counts as a shareable image.
 */
export function QueueCountsHeader({ counts, activeQueue, activeIsSecondary }: { counts: QueueCounts; activeQueue?: number; activeIsSecondary?: boolean }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();

  const total = counts.new + counts.secondaryNew + counts.learning + counts.review;

  if (total === 0) {
    return null;
  }

  // CardQueue.NEW = 0, CardQueue.LEARNING = 1, CardQueue.REVIEW = 2, CardQueue.RELEARNING = 3
  const isNewActive = activeQueue === 0 && !activeIsSecondary;
  const isSecondaryActive = activeQueue === 0 && !!activeIsSecondary;
  const isLearningActive = activeQueue === 1 || activeQueue === 3; // Learning or Relearning
  const isReviewActive = activeQueue === 2;

  const handleCopy = async () => {
    try {
      await copyQueueCountsImage(counts);
      setCopyState('copied');
    } catch (err) {
      console.error('Failed to copy queue counts image', err);
      setCopyState('error');
    }
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState('idle'), 1500);
  };

  return (
    <button
      type="button"
      className="queue-counts"
      onClick={handleCopy}
      aria-label="Copy progress as image"
    >
      <span className={`count-new ${isNewActive ? 'count-active' : ''}`} title="New cards">{counts.new}</span>
      <span className="count-separator">+</span>
      <span className={`count-secondary ${isSecondaryActive ? 'count-active' : ''}`} title="Secondary new cards (word already started)">{counts.secondaryNew}</span>
      <span className="count-separator">+</span>
      <span className={`count-learning ${isLearningActive ? 'count-active' : ''}`} title="Learning cards">{counts.learning}</span>
      <span className="count-separator">+</span>
      <span className={`count-review ${isReviewActive ? 'count-active' : ''}`} title="Review cards">{counts.review}</span>
      {copyState !== 'idle' && (
        <span className="queue-counts-toast">
          {copyState === 'copied' ? 'Copied!' : 'Copy failed'}
        </span>
      )}
    </button>
  );
}
