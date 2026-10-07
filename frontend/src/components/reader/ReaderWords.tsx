import { useEffect, useState } from 'react';
import { isTappableWord, wordOffsets, sentenceAround, wordsMatchText, type ReaderWord } from '@shared/reader/words';
import { itemForText } from '@shared/explorer';
import { knownHanzi, localPageWords, requestReaderWords, sessionPageWords } from '../../services/readerWords';
import { useExplorer } from '../explorer/ExplorerContext';
import { track } from '../../services/analytics';
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
 * chip opens the language explorer's Word view (docs/LANGUAGE_EXPLORER.md) with
 * the chip's pinyin / gloss and its sentence — "More about this word" and
 * "+ Add as card" live there; it never bubbles to the "hide Chinese" tap.
 */
export function ReaderWordsText({ readerId, page, className = 'reader-chinese-text' }: { readerId: string; page: PageLike; className?: string }) {
  const words = useReaderPageWords(readerId, page);
  const known = useKnownHanzi();
  const explorer = useExplorer();

  if (!words) return <div className={className}>{page.content_chinese}</div>;

  const offsets = wordOffsets(words);
  const openWord = (i: number) => {
    const w = words[i];
    const item = itemForText(w.text, {
      pinyin: w.pinyin || undefined,
      gloss: w.gloss || undefined,
      sentence: sentenceAround(page.content_chinese, offsets[i], offsets[i] + w.text.length),
    });
    if (item) explorer.open(item, { source: 'reader' });
  };

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
                  track('reader.word_tap');
                  openWord(i);
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
    </>
  );
}
