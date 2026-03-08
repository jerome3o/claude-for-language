import { useState, useEffect } from 'react';
import type { VocabularyDefinition } from '../types';
import { defineVocabulary } from '../api/client';

interface WordDefinitionPopupProps {
  hanzi: string;
  context: string;
  onSave: (definition: VocabularyDefinition) => void;
  onClose: () => void;
}

export function WordDefinitionPopup({ hanzi, context, onSave, onClose }: WordDefinitionPopupProps) {
  const [definition, setDefinition] = useState<VocabularyDefinition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDefinition = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await defineVocabulary(hanzi, context);
        setDefinition(result);
      } catch (err) {
        console.error('Failed to fetch definition:', err);
        setError('Failed to load definition. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchDefinition();
  }, [hanzi, context]);

  return (
    <div className="word-definition-popup" onClick={onClose}>
      <div className="popup-content" onClick={(e) => e.stopPropagation()}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>Loading...</div>
        ) : error ? (
          <div style={{ color: 'red', padding: '1rem' }}>{error}</div>
        ) : definition ? (
          <>
            <div className="definition-hanzi">{definition.hanzi}</div>
            <div className="definition-pinyin">{definition.pinyin}</div>
            <div className="definition-english">{definition.english}</div>
            {definition.fun_facts && (
              <div className="definition-notes">{definition.fun_facts}</div>
            )}
            {definition.example && (
              <div className="definition-example">{definition.example}</div>
            )}

            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-primary"
                onClick={() => onSave(definition)}
              >
                Add to Flashcards
              </button>
              <button className="btn btn-secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
