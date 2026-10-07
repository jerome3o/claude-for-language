import type { KeyboardEvent, MouseEvent } from 'react';
import { explorableSegments, type ExplorerItem, type WordSegmentInput } from '@shared/explorer';
import { sentenceAround } from '@shared/reader/words';
import { useExplorer, type ExplorerOpenOptions, type ExplorerSource } from './ExplorerContext';

/**
 * Any Chinese text, tappable into the language explorer (docs/LANGUAGE_EXPLORER.md): by word
 * when `segments` line up with the text (reader / chat words, a breakdown), by character
 * otherwise (shared/explorer/segments.ts). Inside the explorer a tap pushes a view; anywhere
 * else it opens the explorer at that character / word. Taps never bubble (a card flip, a
 * "hide the Chinese" tap, a row reveal).
 */
export function ExplorableText({
  text,
  segments,
  source,
  className,
  tapClassName = 'xt-tap',
  highlight,
  cardHanzi,
  onWrite,
}: {
  text: string;
  segments?: readonly WordSegmentInput[] | null;
  source: ExplorerSource;
  className?: string;
  /** Class of each tappable piece (the study card keeps its own look). */
  tapClassName?: string;
  /** Characters of the explored word, marked inside the text. */
  highlight?: string;
  cardHanzi?: string | null;
  onWrite?: ExplorerOpenOptions['onWrite'];
}) {
  const explorer = useExplorer();
  const pieces = explorableSegments(text, segments, (s, e) => sentenceAround(text, s, e));
  // Where the explored word occurs in the text (code-unit offsets), to mark it.
  const marked = new Set<number>();
  if (highlight) {
    for (let at = text.indexOf(highlight); at >= 0; at = text.indexOf(highlight, at + 1)) {
      for (let k = 0; k < highlight.length; k++) marked.add(at + k);
    }
  }
  let offset = 0;

  const go = (item: ExplorerItem, e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (explorer.inside) explorer.push(item);
    else explorer.open(item, { source, cardHanzi, onWrite });
  };

  return (
    <span className={className} lang="zh-CN" data-testid="explorable-text">
      {pieces.map((p, i) => {
        const start = offset;
        offset += p.text.length;
        const hl = marked.has(start);
        return p.item ? (
          <span
            key={i}
            role="button"
            tabIndex={0}
            className={`${tapClassName}${hl ? ' xt-hl' : ''}`}
            onClick={(e) => go(p.item!, e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') go(p.item!, e);
            }}
          >
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        );
      })}
    </span>
  );
}
