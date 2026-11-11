/**
 * A Sentence round row's Chinese (docs/STUDY_SESSION.md "Sentence round"): once the row is answered — a
 * "Read it aloud" take judged, a "Say it in Chinese" answer revealed, a listen exercise's reveal — every word
 * opens the language explorer (source `sentence_round` → "+ Add as card" lands in "From example
 * sentences", shared/decks/source-decks.ts). Words come from the device segmenter (character by character
 * until its lists load). Before that — while the sentence is the question, or a take is recording — it is
 * plain text: a tap means nothing there. Looks like the plain line (no chip boxes). Lab: `RoundChinese` in
 * ui/study/SentenceRoundUi.kt.
 */
import { ExplorableText } from '../explorer/ExplorableText';
import { useSegmentedWords } from '../../services/chineseSegmenter';

export function RoundChinese({ text, explorable, suppressTap }: { text: string; explorable: boolean; suppressTap?: () => boolean }) {
  const words = useSegmentedWords(text, explorable);
  return (
    <p className="sentence-round-zh" lang="zh-CN" data-testid="sentence-round-chinese" data-explorable={explorable ? 'true' : undefined}>
      {explorable ? (
        <ExplorableText text={text} segments={words} source="sentence_round" tapClassName="sentence-round-word" suppressTap={suppressTap} />
      ) : (
        text
      )}
    </p>
  );
}
