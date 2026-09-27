/**
 * The tutor's private profile of a student: what kind of learner they are and
 * what homework suits them. One per tutor_relationship, written by the tutor,
 * NEVER shown to the student. Every agent that makes homework, mini lessons,
 * readers or cards for that student as a tutor action reads it
 * (`studentProfilePrompt`).
 *
 * Mostly free text (markdown, ≤ STUDENT_PROFILE_MAX_CHARS) plus three optional
 * structured fields — only the ones the agents act on directly:
 * - level              → the reader's difficulty_level and the lesson's pitch
 * - handwriting        → handwriting exercises / dictation by hand vs typed
 * - words_per_lesson   → how many cards a lesson's homework aims for
 *
 * (Not to be confused with a user's own profile — name, picture, bio.)
 */

export const STUDENT_PROFILE_MAX_CHARS = 8000;
export const STUDENT_PROFILE_MAX_WORDS_PER_LESSON = 100;

export const STUDENT_LEVELS = ['beginner', 'elementary', 'intermediate', 'advanced'] as const;
export type StudentLevel = (typeof STUDENT_LEVELS)[number];

export const STUDENT_LEVEL_LABELS: Record<StudentLevel, string> = {
  beginner: 'Beginner',
  elementary: 'Elementary',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

/** What the tutor writes. */
export interface StudentProfileFields {
  /** Markdown, free text. '' when not written. */
  body: string;
  level: StudentLevel | null;
  /** Writes characters by hand? null = not said. */
  handwriting: boolean | null;
  /** New words (cards) a lesson's homework aims for. null = not said. */
  words_per_lesson: number | null;
}

/** As stored / returned by the API. */
export interface StudentProfile extends StudentProfileFields {
  relationship_id: string;
  updated_at: string;
}

export const EMPTY_STUDENT_PROFILE: StudentProfileFields = { body: '', level: null, handwriting: null, words_per_lesson: null };

export function isStudentLevel(v: unknown): v is StudentLevel {
  return typeof v === 'string' && (STUDENT_LEVELS as readonly string[]).includes(v);
}

/** Nothing written and nothing picked. */
export function isStudentProfileEmpty(p: StudentProfileFields | null | undefined): boolean {
  if (!p) return true;
  return !p.body.trim() && p.level == null && p.handwriting == null && p.words_per_lesson == null;
}

export function normalizeProfileBody(body: string): string {
  return body.replace(/\r\n?/g, '\n').trim();
}

/**
 * Validate a PUT body. Missing fields mean "not set" (a PUT replaces the whole
 * profile). Returns the normalised value or the problems, one line each.
 */
export function parseStudentProfileInput(raw: unknown): { value: StudentProfileFields | null; problems: string[] } {
  const problems: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { value: null, problems: ['The body must be a JSON object'] };
  const r = raw as Record<string, unknown>;

  let body = '';
  if (r.body != null) {
    if (typeof r.body !== 'string') problems.push('body must be text');
    else {
      body = normalizeProfileBody(r.body);
      if (body.length > STUDENT_PROFILE_MAX_CHARS) {
        problems.push(`body is ${body.length.toLocaleString('en-US')} characters — the limit is ${STUDENT_PROFILE_MAX_CHARS.toLocaleString('en-US')}`);
      }
    }
  }

  let level: StudentLevel | null = null;
  if (r.level != null && r.level !== '') {
    if (isStudentLevel(r.level)) level = r.level;
    else problems.push(`level must be one of ${STUDENT_LEVELS.join(', ')}`);
  }

  let handwriting: boolean | null = null;
  if (r.handwriting != null) {
    if (typeof r.handwriting === 'boolean') handwriting = r.handwriting;
    else problems.push('handwriting must be true, false or null');
  }

  let words: number | null = null;
  if (r.words_per_lesson != null && r.words_per_lesson !== '') {
    const n = r.words_per_lesson;
    if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= STUDENT_PROFILE_MAX_WORDS_PER_LESSON) words = n;
    else problems.push(`words_per_lesson must be a whole number from 1 to ${STUDENT_PROFILE_MAX_WORDS_PER_LESSON}`);
  }

  if (problems.length) return { value: null, problems };
  return { value: { body, level, handwriting, words_per_lesson: words }, problems };
}

/** The structured part as short lines ("Level: Beginner"), for prompts and summaries. */
export function studentProfileFacts(p: StudentProfileFields): string[] {
  const out: string[] = [];
  if (p.level) out.push(`Level: ${STUDENT_LEVEL_LABELS[p.level]}`);
  if (p.handwriting === true) out.push('Writes characters by hand: yes');
  if (p.handwriting === false) out.push('Writes characters by hand: no');
  if (p.words_per_lesson != null) out.push(`New words per lesson: about ${p.words_per_lesson}`);
  return out;
}

/** The structured part as short chips for the profile card ("Beginner", "No handwriting", "~15 new words / lesson"). */
export function studentProfileChips(p: StudentProfileFields): string[] {
  const out: string[] = [];
  if (p.level) out.push(STUDENT_LEVEL_LABELS[p.level]);
  if (p.handwriting === true) out.push('Writes by hand');
  if (p.handwriting === false) out.push('No handwriting');
  if (p.words_per_lesson != null) out.push(`~${p.words_per_lesson} new words / lesson`);
  return out;
}

export const STUDENT_PROFILE_PROMPT_HEADING =
  "Tutor's profile of this student (private; follow it when choosing what to make, how much, and in what form)";

/**
 * The block every tutor-side content agent puts in its prompt. '' when the
 * profile is empty, so callers can append it unconditionally.
 */
export function studentProfilePrompt(profile: StudentProfileFields | null | undefined, studentName?: string | null): string {
  if (!profile || isStudentProfileEmpty(profile)) return '';
  const who = studentName?.trim() || 'this student';
  const lines: string[] = [];
  lines.push(`# ${STUDENT_PROFILE_PROMPT_HEADING}`);
  lines.push(
    `The tutor wrote this about ${who}. It says how they want material made for this student: follow it over the defaults for the kinds of material, how much, the format, the level and the topics. It is private — never quote or mention it in anything the student sees (cards, lessons, readers).`
  );
  if (profile.level) {
    lines.push(`- Level: ${STUDENT_LEVEL_LABELS[profile.level]} — pitch lessons at this level; a reader's difficulty_level is "${profile.level}".`);
  }
  if (profile.handwriting === true) {
    lines.push('- Writes characters by hand: yes — handwriting practice suits them (write_handwriting; dictation and sentence_making with input "handwrite").');
  } else if (profile.handwriting === false) {
    lines.push('- Writes characters by hand: no — never set handwriting tasks; use typed writing (write_typed; input "type") and reading / listening instead.');
  }
  if (profile.words_per_lesson != null) {
    lines.push(
      `- New words per lesson: about ${profile.words_per_lesson} — aim for this many cards instead of the usual range; when a lesson holds more, keep the most useful and list the rest as skipped.`
    );
  }
  const body = normalizeProfileBody(profile.body).slice(0, STUDENT_PROFILE_MAX_CHARS);
  if (body) {
    lines.push('<tutor_profile>');
    lines.push(body);
    lines.push('</tutor_profile>');
  }
  return lines.join('\n');
}

// ============ Examples to start from (the tutor's own descriptions) ============

export interface StudentProfileExample {
  id: string;
  title: string;
  /** One line under the title in the picker. */
  summary: string;
  profile: StudentProfileFields;
}

export const STUDENT_PROFILE_EXAMPLES: StudentProfileExample[] = [
  {
    id: 'adult-beginner',
    title: 'Adult beginner, no handwriting',
    summary: 'Listening first, 10–30 cards a lesson, radicals, own sentences, grammar, readers',
    profile: {
      level: 'beginner',
      handwriting: false,
      words_per_lesson: 15,
      body: `Adult, complete beginner. Learning for travel and to talk with his partner's family. Doesn't want to write characters by hand — reading and typing only.

**Homework that works for him**
- Listening first: audio for every new word, so he hears the tones before he reads them.
- 10–30 flashcards per lesson, never more. Mastery over volume — he gets discouraged when the pile grows, so keep the most useful words and leave the rest for next time.
- Reading with the correct tones: example sentences with audio.
- Radicals: point out the radical and what it hints at (氵 water, 口 mouth) — that is how he remembers characters.
- Making his own sentences with the new words (typed).
- A short grammar mini lesson when we covered a structure.
- Graded readers at his level. Likes food, travel and football.

**Weak spots**: 2nd vs 3rd tone; measure words.
**Pace**: about 20 minutes a day, on the train.`,
    },
  },
  {
    id: 'child-writer',
    title: 'Child beginner, learning to write',
    summary: 'Everything above plus stroke-order writing and dictation next class',
    profile: {
      level: 'beginner',
      handwriting: true,
      words_per_lesson: 10,
      body: `9 years old, beginner. Studies with a parent next to her. She is learning to write characters, so writing practice is part of every week.

**Homework that works for her**
- Audio for every new word — she copies the pronunciation well.
- About 10 flashcards per lesson: short sessions, lots of encouragement.
- Stroke-order writing practice: she writes each new character 5–10 times. We do a dictation of those characters at the start of the next class.
- Radicals, explained simply ("氵 means water").
- Make one sentence with each new word.
- A very short grammar mini lesson when we learned a pattern.
- Graded readers with pictures — she loves animals, school stories and her cat 小白.

**Keep in mind**: instructions in simple English; no more than 10 minutes of writing at a time.`,
    },
  },
  {
    id: 'intermediate-writing',
    title: 'Intermediate / advanced',
    summary: 'Writing in real formats, oral recordings, listening practice',
    profile: {
      level: 'intermediate',
      handwriting: true,
      words_per_lesson: 20,
      body: `Upper-intermediate (around HSK 4). Works for a Chinese company and needs formal written and spoken Chinese.

**Homework that works for him**
- Writing assignments in real formats: letters, emails, invitations, short speeches (150–300 characters). He handwrites and uploads a photo, or types.
- Oral expression: record a 1–2 minute answer on the topic of the lesson so I can listen and correct it.
- Listening practice: conversations at natural speed with comprehension questions.
- Flashcards only for new, useful vocabulary and set phrases (成语 when they come up) — 15–20 per lesson.
- Graded readers at intermediate level: business, current affairs, Chinese history.

**Weak spots**: 了 vs 过; formal register (您, 贵公司, 此致敬礼).
**Goal**: HSK 5 next spring.`,
    },
  },
];

/**
 * Start from an example: an empty profile takes the example whole ("Use
 * this"); otherwise its text is appended below what is written and it only
 * fills the structured fields still unset ("Insert"). Pure.
 */
export function applyStudentProfileExample(current: StudentProfileFields, example: StudentProfileFields): StudentProfileFields {
  if (isStudentProfileEmpty(current)) return { ...example };
  const body = normalizeProfileBody(current.body);
  return {
    body: body ? `${body}\n\n${example.body}` : example.body,
    level: current.level ?? example.level,
    handwriting: current.handwriting ?? example.handwriting,
    words_per_lesson: current.words_per_lesson ?? example.words_per_lesson,
  };
}

/** Same fields, same values (the editor's "unsaved changes"). */
export function sameStudentProfile(a: StudentProfileFields, b: StudentProfileFields): boolean {
  return (
    normalizeProfileBody(a.body) === normalizeProfileBody(b.body) &&
    a.level === b.level &&
    a.handwriting === b.handwriting &&
    a.words_per_lesson === b.words_per_lesson
  );
}

/** What else is worth writing down — shown next to the editor. */
export const STUDENT_PROFILE_HINTS = [
  'Level and goals (an exam, work, family, travel)',
  'Which kinds of homework work — and which don\'t',
  'How much per lesson, and their pace',
  'Writes characters by hand or not',
  'Interests, for reader topics',
  'Weak spots (tones, measure words, 了…)',
];
