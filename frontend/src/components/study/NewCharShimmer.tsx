import type { CSSProperties, ReactNode } from 'react';
import { newCharactersLabel } from '@shared/study/newCharacters';
import './newCharShimmer.css';

/**
 * `text` with its never-seen characters (`newChars`, services/newCharacters.ts `useNewCharacters`)
 * wrapped in a shimmering span (newCharShimmer.css). Unchanged text when none are new, so the
 * card's DOM (and its tap targets) stay as they were. `offset` staggers the sweep across a word
 * split into pieces (the explorer's per-character tap spans).
 */
export function shimmerText(text: string, newChars: ReadonlySet<string> | undefined, offset = 0): ReactNode {
  if (!newChars || newChars.size === 0) return text;
  const chars = [...text];
  if (!chars.some(c => newChars.has(c))) return text;
  return chars.map((c, i) =>
    newChars.has(c) ? (
      <span key={i} className="new-char" data-testid="new-char" style={{ '--nc-i': offset + i } as CSSProperties}>
        {c}
      </span>
    ) : (
      c
    )
  );
}

/** "New character: 行" for screen readers, beside the hanzi (nothing when none are new). */
export function NewCharsLabel({ newChars }: { newChars: ReadonlySet<string> }) {
  const label = newCharactersLabel([...newChars]);
  if (!label) return null;
  return <span className="new-char-sr">{label}</span>;
}
