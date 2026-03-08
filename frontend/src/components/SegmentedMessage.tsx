import type { SentenceBreakdown } from '../types';

interface SegmentedMessageProps {
  segmentation: SentenceBreakdown;
  onWordClick: (hanzi: string) => void;
}

export function SegmentedMessage({ segmentation, onWordClick }: SegmentedMessageProps) {
  return (
    <div className="segmented-message">
      {segmentation.chunks.map((chunk, idx) => (
        <span
          key={idx}
          className="word-segment"
          onClick={() => onWordClick(chunk.hanzi)}
        >
          {chunk.hanzi}
        </span>
      ))}
    </div>
  );
}
