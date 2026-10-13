/**
 * "What <student> has covered" (docs/VIDEO_CALLS.md "Prepared activities"):
 * a compact, read-only picture of what a student has learned, assembled from
 * what the app already records — no new data entry:
 * - the lessons: each recorded video lesson's report (date, topics, how many new
 *   words / corrections) and the tutor's lesson-log notes for lessons without a call;
 * - words / characters met and known well (the Progress page's definitions,
 *   shared/progress/known.ts, from the server's card state);
 * - the newest words from the lessons and homework.
 *
 * Shown on the tutor's student page and fed to the prepared-activities
 * generator. The headline is ported to the Lab app (parity-tested).
 */

export interface CoveredLesson {
  /** YYYY-MM-DD (the lesson's day). */
  date: string;
  title: string | null;
  topics: string[];
  /** 'call' = a recorded video lesson's report; 'notes' = the tutor's lesson-log entry. */
  source: 'call' | 'notes';
  new_words: number;
  corrections: number;
}

export interface CoverageWord {
  hanzi: string;
  pinyin: string;
  english: string;
}

export interface StudentCoverage {
  /** Newest first. */
  lessons: CoveredLesson[];
  /** Total lessons on record (calls + logged), the list above is the newest few. */
  lesson_count: number;
  words: { known: number; learning: number };
  characters: { known: number; learning: number };
  /** The newest words from lesson reports + homework, newest first. */
  recent_words: CoverageWord[];
  /** The better forms the tutor taught in the newest lesson(s) ("said → better"). */
  recent_corrections: { said: string; better: string }[];
}

export const EMPTY_COVERAGE: StudentCoverage = {
  lessons: [],
  lesson_count: 0,
  words: { known: 0, learning: 0 },
  characters: { known: 0, learning: 0 },
  recent_words: [],
  recent_corrections: [],
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "312 words met (140 known well) · 420 characters · 9 lessons", '' when there's nothing yet. */
export function coverageHeadline(c: Pick<StudentCoverage, 'words' | 'characters' | 'lesson_count'>): string {
  const met = c.words.known + c.words.learning;
  const chars = c.characters.known + c.characters.learning;
  const parts: string[] = [];
  if (met > 0) parts.push(`${plural(met, 'word', 'words')} met${c.words.known > 0 ? ` (${c.words.known} known well)` : ''}`);
  if (chars > 0) parts.push(plural(chars, 'character', 'characters'));
  if (c.lesson_count > 0) parts.push(plural(c.lesson_count, 'lesson', 'lessons'));
  return parts.join(' · ');
}

/** The block the prepared-activities generator reads. */
export function coveragePrompt(c: StudentCoverage, studentName?: string | null): string {
  const who = studentName?.trim() || 'The student';
  const lines: string[] = ['# What they have covered'];
  const head = coverageHeadline(c);
  lines.push(head ? `${who}: ${head}.` : `${who}: nothing on record yet.`);
  if (c.lessons.length > 0) {
    lines.push('Lessons (newest first):');
    for (const l of c.lessons) {
      const topics = l.topics.length ? l.topics.join('; ') : l.title ?? '(no topics)';
      lines.push(`- ${l.date} (${l.source === 'call' ? 'video lesson' : 'lesson notes'}): ${topics}`);
    }
  }
  if (c.recent_words.length > 0) {
    lines.push(`Recent words: ${c.recent_words.map((w) => `${w.hanzi} (${w.english})`).join(', ')}`);
  }
  return lines.join('\n');
}
