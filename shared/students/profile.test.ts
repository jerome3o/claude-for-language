import { describe, it, expect } from 'vitest';
import {
  EMPTY_STUDENT_PROFILE,
  STUDENT_PROFILE_EXAMPLES,
  STUDENT_PROFILE_MAX_CHARS,
  STUDENT_PROFILE_PROMPT_HEADING,
  isStudentProfileEmpty,
  parseStudentProfileInput,
  studentProfileFacts,
  studentProfilePrompt,
  applyStudentProfileExample,
  sameStudentProfile,
  studentProfileChips,
} from './profile';

describe('parseStudentProfileInput', () => {
  it('normalises the body and treats missing fields as not set', () => {
    const r = parseStudentProfileInput({ body: '  Adult beginner.\r\nNo handwriting.  ' });
    expect(r.problems).toEqual([]);
    expect(r.value).toEqual({ body: 'Adult beginner.\nNo handwriting.', level: null, handwriting: null, words_per_lesson: null });
  });

  it('accepts the structured fields', () => {
    const r = parseStudentProfileInput({ body: '', level: 'intermediate', handwriting: false, words_per_lesson: 20 });
    expect(r.value).toEqual({ body: '', level: 'intermediate', handwriting: false, words_per_lesson: 20 });
  });

  it('lists every problem', () => {
    const r = parseStudentProfileInput({
      body: 'x'.repeat(STUDENT_PROFILE_MAX_CHARS + 1),
      level: 'expert',
      handwriting: 'yes',
      words_per_lesson: 0,
    });
    expect(r.value).toBeNull();
    expect(r.problems).toHaveLength(4);
    expect(r.problems[0]).toMatch(/limit is 8,000/);
    expect(parseStudentProfileInput({ words_per_lesson: 2.5 }).problems).toHaveLength(1);
    expect(parseStudentProfileInput({ body: 5 }).problems).toEqual(['body must be text']);
    expect(parseStudentProfileInput(null).problems).toHaveLength(1);
    expect(parseStudentProfileInput([]).problems).toHaveLength(1);
  });

  it('allows exactly the limit', () => {
    expect(parseStudentProfileInput({ body: 'x'.repeat(STUDENT_PROFILE_MAX_CHARS) }).problems).toEqual([]);
  });
});

describe('isStudentProfileEmpty', () => {
  it('is empty with nothing written or picked', () => {
    expect(isStudentProfileEmpty(null)).toBe(true);
    expect(isStudentProfileEmpty(EMPTY_STUDENT_PROFILE)).toBe(true);
    expect(isStudentProfileEmpty({ ...EMPTY_STUDENT_PROFILE, body: '  \n ' })).toBe(true);
    expect(isStudentProfileEmpty({ ...EMPTY_STUDENT_PROFILE, handwriting: false })).toBe(false);
    expect(isStudentProfileEmpty({ ...EMPTY_STUDENT_PROFILE, body: 'Likes football' })).toBe(false);
  });
});

describe('studentProfilePrompt', () => {
  it('is empty for an empty profile', () => {
    expect(studentProfilePrompt(null, 'Sam')).toBe('');
    expect(studentProfilePrompt(EMPTY_STUDENT_PROFILE, 'Sam')).toBe('');
  });

  it('labels the block, names the student, and carries the fields and the text', () => {
    const block = studentProfilePrompt(
      { body: 'Likes football.\nWeak on tones.', level: 'beginner', handwriting: false, words_per_lesson: 15 },
      'Sam'
    );
    expect(block.startsWith(`# ${STUDENT_PROFILE_PROMPT_HEADING}`)).toBe(true);
    expect(block).toContain('about Sam');
    expect(block).toContain('never quote or mention it');
    expect(block).toContain('Level: Beginner');
    expect(block).toContain('difficulty_level is "beginner"');
    expect(block).toContain('never set handwriting tasks');
    expect(block).toContain('about 15');
    expect(block).toContain('<tutor_profile>\nLikes football.\nWeak on tones.\n</tutor_profile>');
  });

  it('says handwriting suits them when they write by hand, and omits unset fields', () => {
    const block = studentProfilePrompt({ ...EMPTY_STUDENT_PROFILE, handwriting: true });
    expect(block).toContain('handwriting practice suits them');
    expect(block).toContain('about this student');
    expect(block).not.toContain('Level:');
    expect(block).not.toContain('<tutor_profile>');
  });
});

describe('studentProfileFacts', () => {
  it('lists the structured part', () => {
    expect(studentProfileFacts({ body: '', level: 'advanced', handwriting: true, words_per_lesson: 8 })).toEqual([
      'Level: Advanced',
      'Writes characters by hand: yes',
      'New words per lesson: about 8',
    ]);
  });
});

describe('STUDENT_PROFILE_EXAMPLES', () => {
  it('are valid profiles', () => {
    expect(STUDENT_PROFILE_EXAMPLES.map((e) => e.id)).toEqual(['adult-beginner', 'child-writer', 'intermediate-writing']);
    for (const e of STUDENT_PROFILE_EXAMPLES) {
      const r = parseStudentProfileInput(e.profile);
      expect(r.problems, e.id).toEqual([]);
      expect(r.value, e.id).toEqual(e.profile);
    }
  });
});

describe('applyStudentProfileExample', () => {
  const example = STUDENT_PROFILE_EXAMPLES[1].profile;
  it('an empty profile takes the example whole', () => {
    expect(applyStudentProfileExample(EMPTY_STUDENT_PROFILE, example)).toEqual(example);
  });
  it('otherwise appends the text and fills only unset fields', () => {
    const out = applyStudentProfileExample({ body: 'Twins, 8 and 10.', level: null, handwriting: false, words_per_lesson: null }, example);
    expect(out.body).toBe(`Twins, 8 and 10.\n\n${example.body}`);
    expect(out.handwriting).toBe(false);
    expect(out.level).toBe('beginner');
    expect(out.words_per_lesson).toBe(10);
  });
  it('a profile with only fields set keeps them and takes the text', () => {
    const out = applyStudentProfileExample({ body: '', level: 'advanced', handwriting: null, words_per_lesson: null }, example);
    expect(out).toEqual({ ...example, level: 'advanced' });
  });
});

describe('sameStudentProfile', () => {
  it('ignores surrounding whitespace in the text', () => {
    expect(sameStudentProfile({ ...EMPTY_STUDENT_PROFILE, body: 'a\r\nb ' }, { ...EMPTY_STUDENT_PROFILE, body: 'a\nb' })).toBe(true);
    expect(sameStudentProfile(EMPTY_STUDENT_PROFILE, { ...EMPTY_STUDENT_PROFILE, level: 'beginner' })).toBe(false);
  });
});

describe('studentProfileChips', () => {
  it('is the short form for the card', () => {
    expect(studentProfileChips({ body: '', level: 'elementary', handwriting: false, words_per_lesson: 15 })).toEqual(['Elementary', 'No handwriting', '~15 new words / lesson']);
    expect(studentProfileChips({ body: 'x', level: null, handwriting: true, words_per_lesson: null })).toEqual(['Writes by hand']);
    expect(studentProfileChips(EMPTY_STUDENT_PROFILE)).toEqual([]);
  });
});
