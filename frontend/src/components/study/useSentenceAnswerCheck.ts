/**
 * Claude's check of a SENTENCE answer on Hard mode's question (shared/study/sentenceAnswerCheck.ts,
 * docs/STUDY_SESSION.md "Sentence answers checked by Claude"): started when the question's answer is
 * checked and the device didn't accept it, one call per distinct answer (services/answerCheck.ts: the
 * device cache, then the server's cache for everyone). A newer answer (🔁 Try again) or another card makes
 * an older reply land nowhere. Offline / failed → `unavailable`: the device's verdict stands.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { answerCheckCacheText, type AnswerCheck, type AnswerCheckInput } from '@shared/lesson/answerCheck';
import type { AnswerVerdict } from '@shared/cards/answer';
import type { DifferenceReason } from '@shared/study/answerDifference';
import {
  sentenceAnswerCheckApplies, sentenceAnswerCheckInput, sentenceCheckDifference, sentenceCheckedVerdict, sentenceCheckView,
  type SentenceCheckView,
} from '@shared/study/sentenceAnswerCheck';
import { AnswerCheckUnavailable, checkLessonAnswer } from '../../services/answerCheck';
import { track } from '../../services/analytics';

export type SentenceCheckState =
  | { status: 'idle' }
  | { status: 'checking'; key: string }
  | { status: 'done'; key: string; check: AnswerCheck }
  | { status: 'unavailable'; key: string; offline: boolean };

/** The check function (tests stub it). */
export type SentenceChecker = (input: AnswerCheckInput) => Promise<{ check: AnswerCheck; cached: boolean }>;

/**
 * `input` = the answer to check now (null = none); `enabled` = online and the question's check is up.
 * Returns the state of THAT answer (a state for another answer reads as idle).
 */
export function useSentenceAnswerCheck(args: {
  input: AnswerCheckInput | null;
  enabled: boolean;
  /** The card showing (a new card starts the try count afresh). */
  showingKey: string;
  cardType: string;
  where: 'session' | 'homework';
  checker?: SentenceChecker;
}): SentenceCheckState {
  const [state, setState] = useState<SentenceCheckState>({ status: 'idle' });
  const key = args.input ? answerCheckCacheText(args.input) : null;
  const run = useRef(0);
  const tries = useRef(0);
  const latest = useRef(args);
  latest.current = args;

  useEffect(() => {
    tries.current = 0;
    run.current++;
    setState({ status: 'idle' });
  }, [args.showingKey]);

  const start = useCallback((input: AnswerCheckInput, k: string) => {
    const id = ++run.current;
    const retry = tries.current++;
    const began = Date.now();
    const { cardType, where, checker } = latest.current;
    const props = { retry, input: input.input ?? 'typed', card_type: cardType, where };
    setState({ status: 'checking', key: k });
    (checker ?? checkLessonAnswer)(input).then(
      ({ check, cached }) => {
        if (run.current !== id) return;
        setState({ status: 'done', key: k, check });
        track('study.sentence_answer_check', { verdict: check.verdict, cached, ms: Date.now() - began, ...props });
      },
      (error: unknown) => {
        if (run.current !== id) return;
        const offline = error instanceof AnswerCheckUnavailable && error.offline;
        setState({ status: 'unavailable', key: k, offline });
        track('study.sentence_answer_check', { verdict: offline ? 'offline' : 'error', cached: false, ms: Date.now() - began, ...props });
      },
    );
  }, []);

  useEffect(() => {
    const input = latest.current.input;
    if (!args.enabled || !input || !key) return;
    if (state.status !== 'idle' && state.key === key) return;
    start(input, key);
  }, [args.enabled, key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!key || state.status === 'idle' || state.key !== key) return { status: 'idle' };
  return state;
}

/** What the question's check needs from a sentence check (StudyCard; the Lab's CardStage does the same). */
export interface SentenceQuestionCheck {
  state: SentenceCheckState;
  /** The verdict the card goes on with: the device's, or Claude's for a sentence it checked (`sentenceCheckedVerdict`). */
  verdict: AnswerVerdict | null;
  /** Claude is reading it: the question shows the answer + diff and a slim "Checking your sentence…" row. */
  checking: boolean;
  check: AnswerCheck | null;
  /** Right per Claude but not the card's words: hold with "You said" vs the card. */
  difference: DifferenceReason | null;
  /** What the question shows: the card's answer + "You said" vs it at once, the verdict loading in under them. */
  view: SentenceCheckView;
}

export function useSentenceQuestionCheck(args: {
  showingKey: string;
  cardType: string;
  hanzi: string;
  pinyin: string | null | undefined;
  english: string;
  /** The answer typed / said (trimmed or not). */
  answer: string;
  spoken: boolean;
  /** The device's verdict of it (null = nothing to check). */
  localVerdict: AnswerVerdict | null;
  multipleChoice: boolean;
  /** Hard mode's check of the question is up (a check starts only then). */
  active: boolean;
  online: boolean;
  where: 'session' | 'homework';
  checker?: SentenceChecker;
}): SentenceQuestionCheck {
  const answer = args.answer.trim();
  const applies = sentenceAnswerCheckApplies({
    cardType: args.cardType, hanzi: args.hanzi, answer, verdict: args.localVerdict, multipleChoice: args.multipleChoice,
  });
  const input = useMemo(
    () => (applies ? sentenceAnswerCheckInput({ english: args.english, hanzi: args.hanzi, pinyin: args.pinyin, answer, spoken: args.spoken }) : null),
    [applies, args.english, args.hanzi, args.pinyin, answer, args.spoken],
  );
  const state = useSentenceAnswerCheck({
    input, enabled: args.active && args.online, showingKey: args.showingKey, cardType: args.cardType, where: args.where, checker: args.checker,
  });
  const check = state.status === 'done' ? state.check : null;
  const verdict = args.localVerdict ? sentenceCheckedVerdict(args.localVerdict, check?.verdict) : null;
  const checking = !!input && args.active && args.online && (state.status === 'idle' || state.status === 'checking');
  const view = sentenceCheckView({ applies, checking, claude: check?.verdict, said: answer, model: args.hanzi, corrected: check?.corrected });
  return { state, verdict, checking, check, difference: check ? sentenceCheckDifference(answer, args.hanzi, check.verdict) : null, view };
}
