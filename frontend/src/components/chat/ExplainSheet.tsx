import { useEffect, useState } from 'react';
import { autoPinyin } from '../../utils/autoPinyin';
import { breakdownSentenceCard } from '@shared/coach/actions';
import type { SentenceBriefExplanation } from '../../types';
import { getTextExplanation } from '../../services/sentence-sets';
import { SentenceWordBreakdown } from '../SentenceWordBreakdown';
import { AddChunkModal, type Chunk } from '../AddChunkModal';
import { describeError } from './InlineNotice';

/**
 * The message menu's **Explain** (docs/CHAT.md "Round 2"): the message, its
 * translation and the word-by-word breakdown the study card and the Coach use
 * (`POST /api/sentences/explain-text`, cached on the device by its text). A word
 * row adds that word as a card; "+ Add whole sentence as card" is the same as
 * the menu's **Save as flashcard** (`mode: 'save'` jumps straight to it).
 */
export function ExplainSheet({ text, mode, isOnline, onClose }: { text: string; mode: 'explain' | 'save'; isOnline: boolean; onClose: () => void }) {
  const [explanation, setExplanation] = useState<SentenceBriefExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Chunk | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sentencePinyin = autoPinyin(text, { nonZh: 'consecutive' }).replace(/\s+/g, ' ').trim();

  useEffect(() => {
    let live = true;
    setError(null);
    getTextExplanation({ hanzi: text, pinyin: sentencePinyin })
      .then((e) => {
        if (!live) return;
        setExplanation(e);
        if (mode === 'save') setAdding(sentenceChunk(text, sentencePinyin, e));
      })
      .catch((err) => live && setError(describeError(err, isOnline ? "Couldn't explain that just now." : 'Explaining needs internet the first time.')));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, attempt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !adding && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adding, onClose]);

  if (adding) {
    return (
      <AddChunkModal source="chat"
        chunk={adding}
        onClose={() => {
          setAdding(null);
          if (mode === 'save') onClose();
        }}
      />
    );
  }

  return (
    <div className="msg-sheet-overlay" onClick={onClose}>
      <div className="msg-sheet chat-explain-sheet" role="dialog" aria-label="Explain" data-testid="chat-explain-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="msg-sheet-handle" aria-hidden="true" />
        <div className="chat-explain-head">
          <div className="chat-explain-text" lang="zh">{text}</div>
          <div className="chat-explain-pinyin">{explanation ? sentenceChunk(text, sentencePinyin, explanation).pinyin : sentencePinyin}</div>
          {explanation?.translation && <div className="chat-explain-translation">{explanation.translation}</div>}
        </div>
        {!explanation && !error && (
          <div className="chat-explain-loading" role="status">
            <span className="chat-spinner" aria-hidden="true" /> {mode === 'save' ? 'Making the card…' : 'Explaining…'}
          </div>
        )}
        {error && (
          <div className="chat-explain-error" role="alert">
            {error}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </button>
          </div>
        )}
        {explanation && (
          <>
            <div className="chat-explain-tip">Tap a word to add it as a card</div>
            <SentenceWordBreakdown explanation={explanation} onWord={(w) => setAdding({ hanzi: w.hanzi, pinyin: w.pinyin, english: w.gloss })} />
            <button
              type="button"
              className="btn btn-primary chat-explain-save"
              onClick={() => setAdding(sentenceChunk(text, sentencePinyin, explanation))}
            >
              🃏 Save as flashcard
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The whole message as one card, to the card standard for a sentence (shared with the Coach). */
export function sentenceChunk(text: string, fallbackPinyin: string, e: SentenceBriefExplanation): Chunk {
  // Word-spaced pinyin (the card standard) from the breakdown; the device's own as a fallback.
  const fromWords = e.words.map((w) => w.pinyin.trim()).filter(Boolean).join(' ');
  const pinyin = fromWords || fallbackPinyin;
  const card = breakdownSentenceCard({ hanzi: text, pinyin, translation: e.translation ?? null, words: e.words, construction: e.construction });
  return { hanzi: card.hanzi, pinyin: card.pinyin, english: card.english, ...(card.fun_facts ? { fun_facts: card.fun_facts } : {}) };
}
