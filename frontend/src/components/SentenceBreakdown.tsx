import { useState, useCallback, useRef, useEffect } from 'react';
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const totalChunks = breakdown.chunks.length;

  // Ref to track if we should continue playing all
  const playAllRef = useRef(false);
  const currentPlayIdRef = useRef(0);

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

  // Stop any ongoing speech synthesis
  const stopSpeech = useCallback(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    playAllRef.current = false;
    currentPlayIdRef.current++;
    setIsPlaying(false);
    setIsPlayingAll(false);
  }, []);

  // Speak a single chunk's hanzi
  const speakChunk = useCallback((text: string, onEnd?: () => void) => {
    if (!('speechSynthesis' in window)) return;

    const playId = ++currentPlayIdRef.current;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.8;

    // Try to find a Chinese voice
    const voices = window.speechSynthesis.getVoices();
    const chineseVoice = voices.find(
      (v) => v.lang.startsWith('zh') || v.lang.includes('Chinese')
    );
    if (chineseVoice) {
      utterance.voice = chineseVoice;
    }

    utterance.onstart = () => {
      if (currentPlayIdRef.current === playId) {
        setIsPlaying(true);
      }
    };

    utterance.onend = () => {
      if (currentPlayIdRef.current === playId) {
        setIsPlaying(false);
        onEnd?.();
      }
    };

    utterance.onerror = () => {
      if (currentPlayIdRef.current === playId) {
        setIsPlaying(false);
        onEnd?.();
      }
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  // Play the current chunk
  const playCurrentChunk = useCallback(() => {
    speakChunk(currentChunk.hanzi);
  }, [speakChunk, currentChunk.hanzi]);

  // Play all chunks in sequence with auto-advance
  const playAll = useCallback(() => {
    playAllRef.current = true;
    setIsPlayingAll(true);
    setCurrentChunkIndex(0);

    const playChunkAtIndex = (index: number) => {
      if (!playAllRef.current || index >= totalChunks) {
        playAllRef.current = false;
        setIsPlayingAll(false);
        return;
      }

      setCurrentChunkIndex(index);
      speakChunk(breakdown.chunks[index].hanzi, () => {
        // Small delay between chunks for natural pacing
        setTimeout(() => {
          playChunkAtIndex(index + 1);
        }, 300);
      });
    };

    playChunkAtIndex(0);
  }, [speakChunk, breakdown.chunks, totalChunks]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, [stopSpeech]);

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

      {/* Audio controls */}
      <div className="sentence-audio-controls">
        {isPlayingAll ? (
          <button
            className="btn btn-secondary"
            onClick={stopSpeech}
          >
            Stop
          </button>
        ) : (
          <button
            className="btn btn-secondary"
            onClick={playAll}
            disabled={isPlaying}
          >
            Play All
          </button>
        )}
        <button
          className="btn btn-secondary"
          onClick={playCurrentChunk}
          disabled={isPlaying || isPlayingAll}
        >
          Play "{currentChunk.hanzi}"
        </button>
      </div>

      {/* Navigation controls - placed above explainer for stable button position */}
      <div className="sentence-navigation">
        <button
          className="btn btn-secondary"
          onClick={goToPrevious}
          disabled={currentChunkIndex === 0 || isPlayingAll}
        >
          Previous
        </button>

        {/* Chunk indicators */}
        <div className="sentence-chunk-indicators">
          {breakdown.chunks.map((_, idx) => (
            <button
              key={idx}
              className={`sentence-chunk-dot ${idx === currentChunkIndex ? 'active' : ''}`}
              onClick={() => !isPlayingAll && goToChunk(idx)}
              aria-label={`Go to chunk ${idx + 1}`}
              disabled={isPlayingAll}
            />
          ))}
        </div>

        <button
          className="btn btn-secondary"
          onClick={goToNext}
          disabled={currentChunkIndex === totalChunks - 1 || isPlayingAll}
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
