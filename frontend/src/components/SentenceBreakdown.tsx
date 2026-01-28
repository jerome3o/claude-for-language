import { useState, useCallback } from 'react';
import { SentenceBreakdown as SentenceBreakdownType } from '../types';

interface SentenceBreakdownProps {
  breakdown: SentenceBreakdownType;
  onClose?: () => void;
}

/**
 * Reusable component to display a sentence breakdown with aligned chunks.
 * Users can step through each chunk to see how the Chinese maps to English.
 */
export function SentenceBreakdown({ breakdown, onClose }: SentenceBreakdownProps) {
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const totalChunks = breakdown.chunks.length;

  const goToPrevious = useCallback(() => {
    setCurrentChunkIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const goToNext = useCallback(() => {
    setCurrentChunkIndex((prev) => Math.min(totalChunks - 1, prev + 1));
  }, [totalChunks]);

  const goToChunk = useCallback((index: number) => {
    setCurrentChunkIndex(index);
  }, []);

  const currentChunk = breakdown.chunks[currentChunkIndex];

  // Render chunks with highlighting for hanzi/pinyin (built from chunks)
  const renderChunksHighlight = (
    chunks: SentenceBreakdownType['chunks'],
    field: 'hanzi' | 'pinyin',
    currentIndex: number
  ) => {
    const addSpace = field === 'pinyin';

    return (
      <span className="sentence-text-chunks">
        {chunks.map((chunk, idx) => (
          <span
            key={idx}
            className={`sentence-text-segment sentence-chunk ${idx === currentIndex ? 'sentence-chunk-active' : ''}`}
            onClick={() => goToChunk(idx)}
          >
            {chunk[field]}
            {addSpace && idx < chunks.length - 1 ? ' ' : ''}
          </span>
        ))}
      </span>
    );
  };

  // Render English with index-based highlighting (preserves natural sentence)
  const renderEnglishHighlight = (
    fullEnglish: string,
    chunks: SentenceBreakdownType['chunks'],
    currentIndex: number
  ) => {
    const currentChunkData = chunks[currentIndex];
    const { englishStart, englishEnd } = currentChunkData;

    // Build the English sentence with the current chunk highlighted
    const before = fullEnglish.slice(0, englishStart);
    const highlighted = fullEnglish.slice(englishStart, englishEnd);
    const after = fullEnglish.slice(englishEnd);

    return (
      <span className="sentence-text-english">
        {before}
        <span className="sentence-chunk-active">{highlighted}</span>
        {after}
      </span>
    );
  };

  return (
    <div className="sentence-breakdown">
      {/* Header with close button */}
      {onClose && (
        <div className="sentence-breakdown-header">
          <h3>Sentence Breakdown</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
      )}

      {/* Full sentence display with highlighting */}
      <div className="sentence-full-display">
        {/* Hanzi row */}
        <div className="sentence-row sentence-row-hanzi">
          {renderChunksHighlight(breakdown.chunks, 'hanzi', currentChunkIndex)}
        </div>

        {/* Pinyin row */}
        <div className="sentence-row sentence-row-pinyin">
          {renderChunksHighlight(breakdown.chunks, 'pinyin', currentChunkIndex)}
        </div>

        {/* English row - uses index-based highlighting to preserve natural sentence */}
        <div className="sentence-row sentence-row-english">
          {renderEnglishHighlight(breakdown.english, breakdown.chunks, currentChunkIndex)}
        </div>
      </div>

      {/* Navigation controls - placed above explainer for stable button position */}
      <div className="sentence-navigation">
        <button
          className="btn btn-secondary"
          onClick={goToPrevious}
          disabled={currentChunkIndex === 0}
        >
          Previous
        </button>

        {/* Chunk indicators */}
        <div className="sentence-chunk-indicators">
          {breakdown.chunks.map((_, idx) => (
            <button
              key={idx}
              className={`sentence-chunk-dot ${idx === currentChunkIndex ? 'active' : ''}`}
              onClick={() => goToChunk(idx)}
              aria-label={`Go to chunk ${idx + 1}`}
            />
          ))}
        </div>

        <button
          className="btn btn-secondary"
          onClick={goToNext}
          disabled={currentChunkIndex === totalChunks - 1}
        >
          Next
        </button>
      </div>

      {/* Current chunk detail */}
      <div className="sentence-chunk-detail">
        <div className="sentence-chunk-detail-header">
          <span className="sentence-chunk-counter">
            {currentChunkIndex + 1} / {totalChunks}
          </span>
        </div>

        <div className="sentence-chunk-content">
          <div className="sentence-chunk-hanzi">{currentChunk.hanzi}</div>
          <div className="sentence-chunk-pinyin">{currentChunk.pinyin}</div>
          <div className="sentence-chunk-english">{currentChunk.english}</div>
          {currentChunk.note && (
            <div className="sentence-chunk-note">{currentChunk.note}</div>
          )}
        </div>
      </div>

      {/* Grammar notes if present */}
      {breakdown.grammarNotes && (
        <div className="sentence-grammar-notes">
          <h4>Grammar Notes</h4>
          <p>{breakdown.grammarNotes}</p>
        </div>
      )}
    </div>
  );
}

export default SentenceBreakdown;
