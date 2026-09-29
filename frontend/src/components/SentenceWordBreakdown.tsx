import type { SentenceBriefExplanation } from '../types';

export interface BreakdownWord {
  hanzi: string;
  pinyin: string;
  gloss: string;
}

/**
 * "What's going on here?" — the brief breakdown of one sentence: one word per
 * row (hanzi · pinyin · meaning), then a line on the construction. Each word
 * row is a button that adds that word as a card (the caller opens
 * AddChunkModal). Shared by the study card's sentence list and the Sentence
 * Coach's Explain result, so both look and behave the same.
 */
export function SentenceWordBreakdown({
  explanation,
  onWord,
  disabled = false,
}: {
  explanation: SentenceBriefExplanation;
  onWord: (word: BreakdownWord) => void;
  disabled?: boolean;
}) {
  return (
    <div className="sentence-set-explanation" data-testid="sentence-word-breakdown">
      {/* Each word is tappable: the breakdown doubles as the old
          tap-a-word-to-make-a-card affordance. */}
      <ul className="sentence-set-words">
        {explanation.words.map((word, i) => (
          <li key={i}>
            <button
              type="button"
              className="sentence-set-word"
              onClick={() => onWord(word)}
              disabled={disabled}
              title="Add this word as a card"
              aria-label={`Add ${word.hanzi} as a card`}
            >
              <span className="hanzi">{word.hanzi}</span>
              <span className="sentence-set-word-pinyin">{word.pinyin}</span>
              <span className="sentence-set-word-gloss">{word.gloss}</span>
            </button>
          </li>
        ))}
      </ul>
      {explanation.construction && (
        <p className="sentence-set-construction">{explanation.construction}</p>
      )}
    </div>
  );
}

export default SentenceWordBreakdown;
