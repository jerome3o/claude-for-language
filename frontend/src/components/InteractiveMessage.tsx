import { useState, useEffect } from 'react';
import type { MessageWithSender, SentenceBreakdown, VocabularyDefinition } from '../types';
import { translateMessageSegmented } from '../api/client';
import { SegmentedMessage } from './SegmentedMessage';
import { WordDefinitionPopup } from './WordDefinitionPopup';
import { describeError } from './chat/InlineNotice';

interface InteractiveMessageProps {
  message: MessageWithSender;
  /** When true, load (or reuse) the segmented word-by-word translation and show it. */
  showTranslation: boolean;
  onSaveWord: (definition: VocabularyDefinition) => void;
  /** Reports a failed translation load to the page's inline notice instead of alert(). */
  onError?: (text: string) => void;
}

/**
 * A received Chinese message. Plain text until the page asks for the
 * word-by-word view (from the message's ⋯ sheet), then tappable segments
 * with the English underneath. Tapping a segment opens its definition.
 */
export function InteractiveMessage({ message, showTranslation, onSaveWord, onError }: InteractiveMessageProps) {
  const [segmentation, setSegmentation] = useState<SentenceBreakdown | null>(null);
  const [selectedWord, setSelectedWord] = useState<{ hanzi: string; context: string } | null>(null);
  const [isLoadingTranslation, setIsLoadingTranslation] = useState(false);

  useEffect(() => {
    if (!showTranslation || segmentation) return;
    let cancelled = false;

    (async () => {
      setIsLoadingTranslation(true);
      try {
        if (message.translation && message.segmentation) {
          setSegmentation(JSON.parse(message.segmentation));
        } else {
          // Backfill: call API (it caches the result on the message server-side)
          const result = await translateMessageSegmented(message.id);
          if (!cancelled) setSegmentation(result.segmentation);
        }
      } catch (error) {
        console.error('Failed to load translation:', error);
        if (!cancelled) onError?.(describeError(error, "Couldn't load the word-by-word translation."));
      } finally {
        if (!cancelled) setIsLoadingTranslation(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTranslation, message.id]);

  const handleWordClick = (hanzi: string) => {
    setSelectedWord({ hanzi, context: message.content });
  };

  const showSegments = showTranslation && segmentation;

  return (
    <div className="interactive-message">
      {showSegments ? (
        <>
          <SegmentedMessage segmentation={segmentation} onWordClick={handleWordClick} />
          <div className="translation-overlay">
            {message.translation || segmentation.english}
          </div>
        </>
      ) : (
        <span>{message.content}</span>
      )}

      {isLoadingTranslation && (
        <span className="msg-status msg-status-inline" role="status">
          <span className="chat-spinner" aria-hidden="true" /> Translating…
        </span>
      )}

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
