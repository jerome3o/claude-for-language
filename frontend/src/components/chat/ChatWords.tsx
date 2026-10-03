import { autoPinyin } from '../../utils/autoPinyin';
import { isTappableWord, sentenceAround, wordOffsets } from '@shared/reader/words';
import { looksLikeChinese } from './messageTools';
import type { ChatWord } from '../../types';
import '../reader/ReaderWords.css';

/** "shì “ qǐng … ”， bú" → "shì “qǐng …”，bú": no spaces inside quotes or before punctuation. */
export function tidyPinyin(s: string): string {
  return s
    .replace(/\s+([，。！？、：；”’）」』,.!?;:)])/g, '$1')
    .replace(/([“‘（「『(])\s+/g, '$1')
    .replace(/([，。！？、：；])\s*/g, '$1 ')
    .trim();
}

/** Pinyin of a whole text, made on the device (before the words arrive). */
export function devicePinyinLine(text: string): string {
  try {
    return tidyPinyin(autoPinyin(text, { nonZh: 'consecutive' }));
  } catch {
    return '';
  }
}

function wordPinyin(w: ChatWord): string {
  if (w.pinyin) return w.pinyin;
  try {
    return autoPinyin(w.text);
  } catch {
    return '';
  }
}

export interface TappedWord {
  word: ChatWord;
  sentence: string;
}

/**
 * A chat message's text as tappable word chips (docs/CHAT.md PR 3): the
 * reader's word chips, quieter for a word already in my decks, with the
 * pinyin over each word when asked. Without words (yet) it is the plain text,
 * with a device-made pinyin line under it when pinyin is on.
 */
export function ChatWordsText({
  text,
  words,
  showPinyin,
  known,
  onTapWord,
  suppressTap,
}: {
  text: string;
  words: ChatWord[] | null;
  showPinyin: boolean;
  known: Set<string>;
  onTapWord: (tapped: TappedWord) => void;
  /** True while picking messages, or right after a long-press opened the ⋯ sheet (the tap is not a word tap). */
  suppressTap?: () => boolean;
}) {
  if (!words) {
    const line = showPinyin && looksLikeChinese(text) ? devicePinyinLine(text) : '';
    return (
      <>
        <span className="chat-text" lang={looksLikeChinese(text) ? 'zh' : undefined}>
          {text}
        </span>
        {line && <span className="chat-pinyin-line">{line}</span>}
      </>
    );
  }

  const offsets = wordOffsets(words);
  return (
    <span className={`chat-words${showPinyin ? ' with-pinyin' : ''}`} lang="zh" data-testid="chat-words">
      {words.map((w, i) => {
        if (isTappableWord(w.text)) {
          const isKnown = known.has(w.text.trim());
          const py = showPinyin ? wordPinyin(w) : '';
          return (
            <button
              key={i}
              type="button"
              className={`chat-word${isKnown ? ' known' : ''}`}
              aria-label={isKnown ? `${w.text} (in your decks)` : w.text}
              onClick={(e) => {
                // Picking messages / right after a long-press: the tap belongs to the message.
                if (suppressTap?.()) return;
                e.stopPropagation();
                onTapWord({ word: w, sentence: sentenceAround(text, offsets[i], offsets[i] + w.text.length) });
              }}
            >
              {py ? (
                <ruby>
                  {w.text}
                  <rt>{py}</rt>
                </ruby>
              ) : (
                w.text
              )}
            </button>
          );
        }
        if (w.text.includes('\n')) return <br key={i} />;
        return (
          <span key={i} className="chat-word-punct">
            {w.text}
          </span>
        );
      })}
    </span>
  );
}
