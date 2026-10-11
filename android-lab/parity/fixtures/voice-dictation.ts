/**
 * Voice-first text box rules (shared/voice/dictation.ts): initial mode, the row per state, the 🎤
 * beside the typing box, what Submit sends + its source, joining a take onto typed text, microphone
 * errors, block reasons, outcomes, language hints and the copy. Writes voice-dictation.json; checked
 * by core/…/VoiceDictationParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DICTATION_COPY,
  VOICE_BLOCKS,
  dictationAnswer,
  dictationControls,
  dictationLanguageHints,
  dictationOutcome,
  dictationSource,
  initialDictationMode,
  joinDictation,
  micErrorBlock,
  typedOutcome,
  voiceBlockReason,
  voiceButtonShown,
  type DictationFailure,
  type DictationMode,
  type DictationPhase,
  type DictationState,
  type VoiceBlock,
} from '../../../shared/voice/dictation';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const modes: DictationMode[] = ['voice', 'type'];
const phases: DictationPhase[] = ['idle', 'listening', 'finishing', 'review', 'failed'];
const failures: Array<DictationFailure | null> = [null, 'failed', 'offline', 'empty'];
const blocks: Array<VoiceBlock | null> = [null, ...VOICE_BLOCKS];
const states: DictationState[] = modes.flatMap((mode) =>
  phases.flatMap((phase) => failures.flatMap((failure) => blocks.map((blocked) => ({ mode, phase, failure, blocked })))));

const texts = ['', '  ', '我喜欢猫', ' 我喜欢猫 ', '我喜欢狗', 'I like cats', 'coffee', '你好。', '\t你好\n', '🐱', '𠀀字'];
const filleds: Array<string | null> = [null, '', '我喜欢猫', 'I like cats', '你好。'];

const controls = states.map((s) => ({ state: s, controls: dictationControls(s) }));
const answers = states.flatMap((s) =>
  texts.flatMap((transcript, i) => {
    const typed = texts[(i * 7 + 3) % texts.length];
    return filleds.map((filled) => ({ state: s, transcript, typed, filled, answer: dictationAnswer(s, transcript, typed, filled) }));
  }));
const joins = texts.flatMap((a) => texts.map((b) => ({ a, b, joined: joinDictation(a, b) })))
  .concat([['I would', 'like tea'], ['我想', '喝咖啡'], ['9', 'apples'], ['café', 'olé'], ['abc', '。好'], ['好', 'abc']]
    .map(([a, b]) => ({ a, b, joined: joinDictation(a, b) })));
const sources = texts.flatMap((t) => filleds.map((f) => ({ text: t, filled: f, source: dictationSource(t, f) })));
const errorNames = ['NotAllowedError', 'PermissionDeniedError', 'SecurityError', 'NotFoundError', 'DevicesNotFoundError',
  'OverconstrainedError', 'NotSupportedError', 'AbortError', 'NotReadableError', '', ' denied ', 'no_mic', 'unsupported', 'x', null];

writeFileSync(join(OUT, 'voice-dictation.json'), JSON.stringify({
  initial: ['voice', 'type', 'x', null].flatMap((d) => blocks.map((b) => ({
    default_mode: d, blocked: b, mode: initialDictationMode(d as DictationMode | null, b),
  }))),
  mic_shown: blocks.map((b) => ({ blocked: b, shown: voiceButtonShown(b) })),
  controls,
  answers,
  joins,
  sources,
  mic_errors: errorNames.map((n) => ({ name: n, block: micErrorBlock(n) })),
  reasons: VOICE_BLOCKS.map((b) => ({ blocked: b, reason: voiceBlockReason(b) })),
  outcomes: ['submitted', 'filled', 'retaken', 'failed', 'empty', 'cancelled', 'typed', 'edited', 'x', ''].map((r) => ({ result: r, outcome: dictationOutcome(r) })),
  typed_outcomes: (['spoken', 'edited', 'typed'] as const).map((s) => ({ source: s, outcome: typedOutcome(s) })),
  hints: (['zh', 'en', null, 'fr'] as const).map((l) => ({ lang: l, hints: dictationLanguageHints(l as 'zh' | 'en' | null) })),
  copy: DICTATION_COPY,
}, null, 1));
