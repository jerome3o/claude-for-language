import type { SentenceBriefExplanation } from '../types';
import { itemForText } from '@shared/explorer';
import { useExplorer, type ExplorerSource } from './explorer/ExplorerContext';

export interface BreakdownWord {
  hanzi: string;
  pinyin: string;
  gloss: string;
}

/**
 * "What's going on here?" — the brief breakdown of one sentence: one word per
 * row (hanzi · pinyin · meaning), then a line on the construction. Each word
 * row opens the language explorer (docs/LANGUAGE_EXPLORER.md) at that word —
 * its Word view has "+ Add as card" / "⚡ Study it today", its characters and
 * related words. Shared by the study card's sentence list, the homework pass,
 * chat Explain and the Sentence Coach's Explain result.
 */
export function SentenceWordBreakdown({
  explanation,
  sentence,
  source = 'breakdown',
  disabled = false,
}: {
  explanation: SentenceBriefExplanation;
  /** The sentence the breakdown is of ("More about this word" explains the word in it). */
  sentence?: string;
  source?: ExplorerSource;
  disabled?: boolean;
}) {
  const explorer = useExplorer();
  return (
    <div className="sentence-set-explanation" data-testid="sentence-word-breakdown">
      <ul className="sentence-set-words">
        {explanation.words.map((word, i) => (
          <li key={i}>
            <button
              type="button"
              className="sentence-set-word"
              onClick={(e) => {
                e.stopPropagation();
                const item = itemForText(word.hanzi, { pinyin: word.pinyin, gloss: word.gloss, sentence });
                if (!item) return;
                if (explorer.inside) explorer.push(item);
                else explorer.open(item, { source });
              }}
              disabled={disabled}
              title="Explore this word"
              aria-label={`Explore ${word.hanzi}`}
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
