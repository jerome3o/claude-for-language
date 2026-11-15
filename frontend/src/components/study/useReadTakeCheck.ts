/**
 * A read card's take checked by Claude when the device can't accept it (shared/study/readTakeCheck.ts,
 * docs/STUDY_SESSION.md "You said" → "Read takes checked by Claude"): the same lesson answer check as the
 * sentence answers (`useSentenceAnswerCheck`: one call per distinct take, the device cache then the
 * server's cache for everyone), as a read-aloud check. Started as soon as the take is transcribed and the
 * device said ✗ Didn't match; offline / failed → the device's verdict stands.
 */
import { useMemo } from 'react';
import type { AnswerCheck } from '@shared/lesson/answerCheck';
import type { TranscriptionComparison } from '@shared/recordings/transcript';
import { readTakeCheckApplies, readTakeCheckInput, readTakeChecked, readTakeClaudeState, readTakeReason } from '@shared/study/readTakeCheck';
import { useSentenceAnswerCheck, type SentenceChecker } from './useSentenceAnswerCheck';

export interface ReadTakeCheck {
  /** Claude is reading it: "Checking…" instead of ✗. */
  checking: boolean;
  check: AnswerCheck | null;
  /** The take as every rule reads it: the device's, or Claude's verdict for a take it checked. */
  comparison: TranscriptionComparison | null;
  /** The "You said" box's Claude chip + reason (null = the device's verdict). */
  claude: { state: 'match' | 'close' | 'miss'; reason: string; tip: string | null } | null;
}

export function useReadTakeCheck(args: {
  showingKey: string;
  cardType: string;
  hanzi: string;
  pinyin: string | null | undefined;
  english: string;
  comparison: TranscriptionComparison | null;
  /** The take is still being transcribed. */
  transcribing: boolean;
  online: boolean;
  where: 'session' | 'homework';
  checker?: SentenceChecker;
}): ReadTakeCheck {
  const transcript = args.comparison?.transcribedHanzi ?? '';
  const applies = !args.transcribing && readTakeCheckApplies({ cardType: args.cardType, hanzi: args.hanzi, transcript, comparison: args.comparison });
  const input = useMemo(
    () => (applies ? readTakeCheckInput({ hanzi: args.hanzi, pinyin: args.pinyin, english: args.english, transcript }) : null),
    [applies, args.hanzi, args.pinyin, args.english, transcript],
  );
  const state = useSentenceAnswerCheck({
    input, enabled: args.online, showingKey: args.showingKey, cardType: args.cardType, where: args.where, checker: args.checker, event: 'study.read_take_check',
  });
  const check = state.status === 'done' ? state.check : null;
  const checking = !!input && args.online && (state.status === 'idle' || state.status === 'checking');
  const comparison = args.comparison ? readTakeChecked(args.comparison, check?.verdict) : null;
  const claude = check && input ? { state: readTakeClaudeState(check.verdict), ...readTakeReason(check) } : null;
  return { checking, check: input ? check : null, comparison, claude };
}
