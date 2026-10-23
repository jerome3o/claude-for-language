export * from './types';
export { validateLessonSpec, assertValidLessonSpec, EXERCISE_TYPE_IDS } from './validate';
export { diffLessonSpecs, formatLessonDiff, canonicalJson, exercisePrimaryText, EXERCISE_TYPE_LABELS } from './diff';
export type { LessonDiff, ExerciseDiffEntry, SectionDiffEntry, FieldChange } from './diff';
export { lessonToMarkdown, lessonToJson, lessonToCsv, lessonToExportSpec, lessonVocabRows, lessonExportFilename } from './export';
export { EXERCISE_TYPE_INFO, EXERCISE_TYPE_LIST, SKILL_LABELS, exerciseTypeInfo } from './registry';
export type { ExerciseTypeInfo, ExerciseSkill } from './registry';
export { LESSON_EXERCISE_DOC, LESSON_AUTHORING_RULES, LESSON_SPEC_DOC, CONVERSATION_INTRO_RULE } from './doc';
export {
  resolveConversationVoices, conversationVoicesFor, conversationSeed, conversationVoicePools, conversationVoice,
  validateConversationVoiceSelection, speakerGender,
  CONVERSATION_VOICES, DEFAULT_CONVERSATION_VOICE_IDS, CONVERSATION_TTS_SPEED, CONVERSATION_LINE_GAP_MS, VOICE_SAMPLE_TEXT,
  LESSON_VOICE_IDS, LESSON_VOICE_POOLS, DEFAULT_LESSON_VOICE,
} from './voices';
export type { ConversationVoice, VoiceAge, VoiceAccent, VoiceStyle, VoiceFamily, ResolveVoicesOptions } from './voices';
export * from './answer-check';
export * from './attempt';
export { defaultExercise } from './defaults';
export { normalizeImagePrompt, describeImagePrompts, describeImageKeys, applyImageToSpec } from './images';
export {
  DEFAULT_CONVERSATION_AUDIO_PREFS, MAX_EXERCISE_VOICE_ENTRIES,
  conversationAudioKey, exerciseVoicesKey, mergeConversationAudioPrefs, parseConversationAudioPrefs,
  resolveConversationAudio, speakerVoiceUpdate, lessonConversationClips,
} from './conversationAudio';
export type { ConversationAudioPrefs, ConversationAudioContext, ResolvedConversationAudio } from './conversationAudio';
export { conversationIntroWarnings, QUOTE_MIN_CHARS } from './introWarnings';
export {
  pickLessonUnlock, lessonUnlockFromRow, lessonUnlockColumns, lessonLockStatus, earlierUnlock, audioLessonListened,
  lessonsUnlockedByListen, lockSets, companionLessonTitle, unlockButtonLabel, lockedLessonLine, companionBadge,
  companionReadyLine, LISTENED_FRACTION, UNLOCK_PROMPT_MAX, LESSON_UNLOCK_VIAS,
} from './unlock';
export type { LessonUnlock, LessonUnlockKind, LessonUnlockVia, LessonLockStatus, CompanionStatus } from './unlock';
export {
  ANSWER_CHECK_VERSION, ANSWER_CHECK_VERDICTS, ANSWER_CHECK_TYPES, ANSWER_CHECK_LIMITS,
  answerCheckApplies, answerCheckCacheText, pickAnswerCheckInput, normalizeAnswerCheck, parseAnswerCheck,
  suggestedFor, answerCheckChip, tipSegments, askQuickQuestions, hasHan,
} from './answerCheck';
export type {
  AnswerCheck, AnswerCheckInput, AnswerCheckVerdict, AnswerCheckTip, AnswerCheckAlternative, AnswerCheckSuggestion,
  AnswerCheckTone, AnswerTry, TipSegment,
} from './answerCheck';
export {
  exerciseAudioClips, lessonAudioClips, lessonClipId, orderClipsForPrefetch, distinctLessonClips, lessonsToPrefetch,
  UPCOMING_NEW_LESSONS_PREFETCH, EMPTY_LESSON_AUDIO_STATS,
} from './audioClips';
export type { LessonAudioClip, LessonClipKind, ResolveConversationClips, PrefetchLessonRow, LessonAudioStats } from './audioClips';
export {
  JUDGE_DEFAULT_QUESTION, GAP_DEFAULT_QUESTION, JUDGE_CORRECT_LABEL, JUDGE_INCORRECT_LABEL,
  judgeResults, gapResults, allAnswered, itemsScoreLine, judgeFeedback, gapFeedback, gapOptionsFor,
} from './judgeGap';
