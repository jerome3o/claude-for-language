import { useEffect, useState } from 'react';
import { isTappableWord, wordOffsets, sentenceAround, wordsMatchText, type ReaderWord } from '@shared/reader/words';
import { knownHanzi, localPageWords, requestReaderWords, sessionPageWords } from '../../services/readerWords';
import { ReaderWordSheet } from './ReaderWordSheet';
import './ReaderWords.css';

interface PageLike {
  id: string;
  content_chinese: string;
  words?: ReaderWord[] | null;
}

/**
 * A page's word chips: the page's own words when they came with it, else the
 * ones this session or this device already has, else asked for (once per
 * reader) from the server. Null until then — the caller shows plain text.
 */
export function useReaderPageWords(readerId: string, page: PageLike): ReaderWord[] | null {
  const own = page.words && wordsMatchText(page.words, page.content_chinese) ? page.words : null;
  const [words, setWords] = useState<ReaderWord[] | null>(own ?? sessionPageWords(page.id, page.content_chinese));

  useEffect(() => {
    const ready = own ?? sessionPageWords(page.id, page.content_chinese);
    setWords(ready);
    if (ready) return;
    let cancelled = false;
    (async () => {
      const local = await localPageWords(readerId, page.id, page.content_chinese);
      if (cancelled) return;
      if (local) {
        setWords(local);
        return;
      }
      const made = await requestReaderWords(readerId);
      const w = made.get(page.id) ?? sessionPageWords(page.id, page.content_chinese);
      if (!cancelled && w && wordsMatchText(w, page.content_chinese)) setWords(w);
    })();
    return () => {
      cancelled = true;
    };
  }, [readerId, page.id, page.content_chinese, own]);

  return words;
}

/** Hanzi already in my decks (refreshed when a card is added). */
export function useKnownHanzi(version = 0): Set<string> {
  const [known, setKnown] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    void knownHanzi().then((s) => {
      if (!cancelled) setKnown(s);
    });
    return () => {
      cancelled = true;
    };
  }, [version]);
  return known;
}

/**
 * The revealed Chinese as tappable word chips (punctuation and line breaks
 * stay plain), or the plain text while the words aren't there yet. Tapping a
 * chip opens the word sheet; it never bubbles to the "hide Chinese" tap.
 */
export function ReaderWordsText({ readerId, page, className = 'reader-chinese-text' }: { readerId: string; page: PageLike; className?: string }) {
  const words = useReaderPageWords(readerId, page);
  const [knownVersion, setKnownVersion] = useState(0);
  const known = useKnownHanzi(knownVersion);
  const [open, setOpen] = useState<number | null>(null);

  if (!words) return <div className={className}>{page.content_chinese}</div>;

  const offsets = wordOffsets(words);
  const tapped = open !== null ? words[open] : null;

  return (
    <>
      <div className={`${className} reader-words`} data-testid="reader-words" onKeyDown={(e) => e.stopPropagation()}>
        {words.map((w, i) => {
          if (isTappableWord(w.text)) {
            const isKnown = known.has(w.text);
            return (
              <button
                key={i}
                type="button"
                className={`reader-word-chip${isKnown ? ' known' : ''}`}
                aria-label={isKnown ? `${w.text} (in your decks)` : w.text}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(i);
                }}
              >
                {w.text}
              </button>
            );
          }
          if (w.text.includes('\n')) return <br key={i} />;
          return (
            <span key={i} className="reader-word-punct">
              {w.text}
            </span>
          );
        })}
      </div>
      {tapped && open !== null && (
        <ReaderWordSheet
          word={tapped}
          sentence={sentenceAround(page.content_chinese, offsets[open], offsets[open] + tapped.text.length)}
          known={known.has(tapped.text)}
          onClose={() => setOpen(null)}
          onAdded={() => setKnownVersion((v) => v + 1)}
        />
      )}
    </>
  );
}
