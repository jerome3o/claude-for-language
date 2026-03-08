import { useState, useRef } from 'react';
import type { MessageWithSender, SentenceBreakdown, VocabularyDefinition } from '../types';
import { translateMessageSegmented } from '../api/client';
import { SegmentedMessage } from './SegmentedMessage';
import { WordDefinitionPopup } from './WordDefinitionPopup';

interface InteractiveMessageProps {
  message: MessageWithSender;
  onSaveWord: (definition: VocabularyDefinition) => void;
}

export function InteractiveMessage({ message, onSaveWord }: InteractiveMessageProps) {
  const [showTranslation, setShowTranslation] = useState(false);
  const [segmentation, setSegmentation] = useState<SentenceBreakdown | null>(null);
  const [selectedWord, setSelectedWord] = useState<{ hanzi: string; context: string } | null>(null);
  const [isLoadingTranslation, setIsLoadingTranslation] = useState(false);

  const touchStartTime = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);

  // Long-press detection (500ms threshold)
  const handleTouchStart = () => {
    touchStartTime.current = Date.now();
    longPressTimer.current = window.setTimeout(() => {
      loadTranslation();
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // Mouse equivalents for desktop
  const handleMouseDown = () => {
    touchStartTime.current = Date.now();
    longPressTimer.current = window.setTimeout(() => {
      loadTranslation();
    }, 500);
  };

  const handleMouseUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const loadTranslation = async () => {
    if (showTranslation) return; // Already showing

    setIsLoadingTranslation(true);

    try {
      // Check if already translated
      if (message.translation && message.segmentation) {
        setSegmentation(JSON.parse(message.segmentation));
        setShowTranslation(true);
      } else {
        // Backfill: call API
        const result = await translateMessageSegmented(message.id);
        setSegmentation(result.segmentation);
        setShowTranslation(true);
        // Note: The message object won't be updated here, but the API caches it in the DB
      }
    } catch (error) {
      console.error('Failed to load translation:', error);
      alert('Failed to load translation. Please try again.');
    } finally {
      setIsLoadingTranslation(false);
    }
  };

  const handleWordClick = (hanzi: string) => {
    setSelectedWord({ hanzi, context: message.content });
  };

  return (
    <div
      className="interactive-message"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {showTranslation && segmentation ? (
        <>
          <SegmentedMessage segmentation={segmentation} onWordClick={handleWordClick} />
          <div className="translation-overlay">
            {message.translation || segmentation.english}
          </div>
        </>
      ) : (
        <span>{message.content}</span>
      )}

      {isLoadingTranslation && <span style={{ fontSize: '0.75rem', color: '#999' }}> (Loading...)</span>}

      {selectedWord && (
        <WordDefinitionPopup
          hanzi={selectedWord.hanzi}
          context={selectedWord.context}
          onSave={onSaveWord}
          onClose={() => setSelectedWord(null)}
        />
      )}
    </div>
  );
}
