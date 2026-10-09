/**
 * An audio lesson's chapter title with the pinyin of its Chinese part on a small line under it
 * ("打扰了 — sorry to bother you" / dǎrǎo le). The pinyin is the lesson's own for a taught word,
 * else automatic (`chapterTitleParts`, shared/audio-lesson/chapter-pinyin.ts — the same function
 * the podcast feed's chapters use); a title that already has it ("自驾游 zìjiàyóu") is split, never
 * doubled. Follows the player's 拼 switch.
 */
import { chapterTitleParts, type AudioLessonChapter, type LessonWord } from '@shared/audio-lesson';

export function ChapterTitle({ chapter, words, showPinyin, className }: { chapter: AudioLessonChapter | undefined; words: readonly LessonWord[]; showPinyin: boolean; className?: string }) {
  if (!chapter) return <span className={className} />;
  const { label, pinyin } = chapterTitleParts(chapter.title, words);
  return (
    <span className={`al-chapter-title ${className ?? ''}`.trim()}>
      <span className="al-chapter-label">{label}</span>
      {showPinyin && pinyin && <span className="al-chapter-pinyin">{pinyin}</span>}
    </span>
  );
}
