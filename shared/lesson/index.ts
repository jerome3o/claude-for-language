export * from './types';
export { validateLessonSpec, assertValidLessonSpec } from './validate';
export { diffLessonSpecs, formatLessonDiff, canonicalJson, exercisePrimaryText, EXERCISE_TYPE_LABELS } from './diff';
export type { LessonDiff, ExerciseDiffEntry, SectionDiffEntry, FieldChange } from './diff';
export { lessonToMarkdown, lessonToJson, lessonToCsv, lessonToExportSpec, lessonVocabRows, lessonExportFilename } from './export';
