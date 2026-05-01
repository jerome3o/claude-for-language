import { useState, useEffect } from 'react';
import type { VocabularyDefinition } from '../types';
import { defineVocabulary } from '../api/client';
import { db } from '../db/database';

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
  const [fromCache, setFromCache] = useState(false);
  const [existingDeckName, setExistingDeckName] = useState<string | null>(null);

  useEffect(() => {
    const fetchDefinition = async () => {
      setIsLoading(true);
      setError(null);
      setFromCache(false);
      try {
        // Check local cache first
        const cached = await db.characterDefinitions.get(hanzi);
        if (cached) {
          setDefinition({
            hanzi: cached.hanzi,
            pinyin: cached.pinyin,
            english: cached.english,
            fun_facts: cached.fun_facts || undefined,
            example: cached.example || undefined,
          });
          setFromCache(true);
          setIsLoading(false);
          return;
        }

        // Cache miss - fetch from API
        const result = await defineVocabulary(hanzi, context);
        setDefinition(result);

        // Store in cache for next time
        await db.characterDefinitions.put({
          hanzi: result.hanzi,
          pinyin: result.pinyin,
          english: result.english,
          fun_facts: result.fun_facts || null,
          example: result.example || null,
          cached_at: Date.now(),
        });
      } catch (err) {
        console.error('Failed to fetch definition:', err);
        setError('Failed to load definition. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchDefinition();
  }, [hanzi, context]);

  useEffect(() => {
    const checkDuplicate = async () => {
      const existing = await db.notes.filter((n) => n.hanzi === hanzi).first();
      if (existing) {
        const deck = await db.decks.get(existing.deck_id);
        setExistingDeckName(deck?.name ?? 'a deck');
      } else {
        setExistingDeckName(null);
      }
    };
    checkDuplicate().catch(() => {});
  }, [hanzi]);

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

            {existingDeckName && (
              <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: '#fff3cd', color: '#856404', borderRadius: '6px', fontSize: '0.85rem' }}>
                Already in "{existingDeckName}"
              </div>
            )}

            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-primary"
                onClick={() => onSave(definition)}
              >
                {existingDeckName ? 'Add anyway' : 'Add to Flashcards'}
              </button>
              {fromCache && (
                <button
                  className="btn btn-secondary"
                  onClick={async () => {
                    setIsLoading(true);
                    setFromCache(false);
                    try {
                      const result = await defineVocabulary(hanzi, context, true);
                      setDefinition(result);
                      await db.characterDefinitions.put({
                        hanzi: result.hanzi,
                        pinyin: result.pinyin,
                        english: result.english,
                        fun_facts: result.fun_facts || null,
                        example: result.example || null,
                        cached_at: Date.now(),
                      });
                    } catch {
                      setError('Failed to refresh definition.');
                    } finally {
                      setIsLoading(false);
                    }
                  }}
                >
                  Refresh
                </button>
              )}
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
