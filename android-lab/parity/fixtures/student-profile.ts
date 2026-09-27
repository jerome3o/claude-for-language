/**
 * The tutor's private student profile (shared/students/profile.ts): the examples and hints
 * the editor offers, the card chips, "use / insert an example", validation and "unsaved
 * changes". Writes student-profile.json; checked by core/…/StudentProfileParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  STUDENT_LEVELS,
  STUDENT_LEVEL_LABELS,
  STUDENT_PROFILE_EXAMPLES,
  STUDENT_PROFILE_HINTS,
  STUDENT_PROFILE_MAX_CHARS,
  STUDENT_PROFILE_MAX_WORDS_PER_LESSON,
  applyStudentProfileExample,
  isStudentProfileEmpty,
  parseStudentProfileInput,
  sameStudentProfile,
  studentProfileChips,
  type StudentProfileFields,
} from '../../../shared/students/profile';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const bodies = ['', '  ', '　\n', 'Likes football.', ' Twins, 8 and 10.\r\n', 'a\r\nb\rc ', '汉字\n\n- list', '﻿BOM '];
// The length limit, checked a few times (long bodies in every combination would bloat the file).
const longBodies = ['x'.repeat(STUDENT_PROFILE_MAX_CHARS), 'y'.repeat(STUDENT_PROFILE_MAX_CHARS + 1), ` ${'z'.repeat(STUDENT_PROFILE_MAX_CHARS)}\r\n`, 'w'.repeat(12_345)];
const levels: Array<string | null> = [null, ...STUDENT_LEVELS, 'expert', ''];
const hands: Array<boolean | null> = [null, true, false];
const words: Array<number | null> = [null, 0, 1, 12, STUDENT_PROFILE_MAX_WORDS_PER_LESSON, STUDENT_PROFILE_MAX_WORDS_PER_LESSON + 1, -3];

const profiles: StudentProfileFields[] = [];
for (const body of bodies)
  for (const level of levels)
    for (const handwriting of hands)
      for (const w of words) profiles.push({ body, level: level as StudentProfileFields['level'], handwriting, words_per_lesson: w });
for (const body of longBodies) {
  profiles.push({ body, level: null, handwriting: null, words_per_lesson: null });
  profiles.push({ body, level: 'expert' as StudentProfileFields['level'], handwriting: true, words_per_lesson: 0 });
}

const cases = profiles.map((p) => {
  const parsed = parseStudentProfileInput(p);
  const valid = parsed.value !== null;
  return {
    profile: p,
    empty: isStudentProfileEmpty(p),
    problems: parsed.problems,
    value: parsed.value,
    chips: valid ? studentProfileChips(parsed.value!) : null,
    apply: STUDENT_PROFILE_EXAMPLES.map((ex) => applyStudentProfileExample(p, ex.profile)),
  };
});

const pairs = [] as Array<{ a: StudentProfileFields; b: StudentProfileFields; same: boolean }>;
for (let i = 0; i < profiles.length; i += 37) {
  for (let j = 0; j < profiles.length; j += 53) pairs.push({ a: profiles[i], b: profiles[j], same: sameStudentProfile(profiles[i], profiles[j]) });
  const twin = { ...profiles[i], body: `  ${profiles[i].body.replace(/\n/g, '\r\n')}\n` };
  pairs.push({ a: profiles[i], b: twin, same: sameStudentProfile(profiles[i], twin) });
}

writeFileSync(
  join(OUT, 'student-profile.json'),
  JSON.stringify({
    max_chars: STUDENT_PROFILE_MAX_CHARS,
    max_words: STUDENT_PROFILE_MAX_WORDS_PER_LESSON,
    levels: STUDENT_LEVELS,
    level_labels: STUDENT_LEVEL_LABELS,
    examples: STUDENT_PROFILE_EXAMPLES,
    hints: STUDENT_PROFILE_HINTS,
    cases,
    pairs,
  })
);
