/**
 * Claude's grade of a sentence the learner MADE (sentence_making; rules shared/lesson/sentenceCheck.ts, docs/STUDY_SESSION.md
 * "Sentence making: an honest verdict"; Lab ui/lessons/SentenceCheckViews.kt):
 *
 *   ≈ 本来…要 used right — the second half doesn't follow       ← the grade's icon + colour, ONE headline (no box)
 *   但是我学中文 states another plan; say what actually happened.   ← at most one short reason · More ▸
 *   🎤 Try again   ✨ Show a fixed version                           ← needs_work / wrong only, nothing pre-made
 *
 * 🎤 Try again: a new sentence (say it or type it), checked the same way, in place, as often as he likes — practice
 * only, the first result is the one that counts. ✨ Show a fixed version: on tap, HIS sentence fixed with minimal edits
 * for what the check found (its problem goes with the request), lined up with it (the slim answer diff), ▶ + pinyin,
 * then 🎤 Say it (checked on the device, like Say it again). Only a real network failure says "needs a connection".
 */
import { useEffect, useRef, useState } from 'react';
import {
  sentenceCheckView, sentenceFixProblem, SENTENCE_FIX_FAILED, SENTENCE_FIX_LABEL, SENTENCE_FIX_OFFLINE, SENTENCE_FIXING_LINE, SENTENCE_MORE_LABEL,
  SENTENCE_RETRY_NOTE, SENTENCE_RETRY_OFFLINE, SENTENCE_SAY_FIX_LABEL, SENTENCE_SHOW_FIX_LABEL, SENTENCE_TRY_AGAIN_LABEL,
  type SentenceFeedback, type SentenceFix, type SentenceGrade,
} from '@shared/lesson/sentenceCheck';
import { CLAUDE_CHECKING_LINE, lessonFeel } from '@shared/lesson/feedback';
import { checkMadeSentence, fixMadeSentence, FeedbackUnavailable } from '../../api/lessonPractice';
import { track } from '../../services/analytics';
import { studyFeel } from '../../services/studyFeel';
import { VoiceTextInput, type DictatedAnswer } from '../voice/VoiceTextInput';
import { AnswerDiff } from '../study/AnswerDiff';
import { ConfettiBurst } from '../ConfettiBurst';
import { LessonFeel, SayItAgain } from './LessonFeedback';
import { spokenCheckAnswer } from '@shared/cards/answer';
import '../study/AnswerDiff.css';
import './SentenceCheck.css';

type Speak = (text: string) => void;
type InputMode = 'spoken' | 'edited' | 'typed';

/** The grade line: icon + headline in the grade's colour, the reason under it, More ▸ when there is more. */
export function SentenceVerdictLine({ feedback, words, testId = 'sentence-feedback', compact = false }: {
  feedback: SentenceFeedback;
  words: string[];
  testId?: string;
  compact?: boolean;
}) {
  const v = sentenceCheckView(feedback, words);
  const [more, setMore] = useState(false);
  return (
    <div className={`sentence-verdict ${v.state}${compact ? ' compact' : ''}`} data-testid={testId} data-grade={v.grade} data-state={v.state} role="status">
      <p className="sentence-verdict-head">
        <span className="sentence-verdict-icon" aria-label={v.label}>{v.icon}</span>{' '}
        <span className="sentence-verdict-headline" data-testid={`${testId}-headline`}>{v.headline}</span>
      </p>
      {/* More ▸ opens the fuller text in place of a reason line it already holds (never the line, then all of it again). */}
      {v.reason && !(more && v.more && v.moreIncludesReason) && (
        <p className="sentence-verdict-reason" data-testid={`${testId}-reason`}>
          {v.reason}
          {v.more && !more && (
            <>
              {' '}
              <button type="button" className="sentence-verdict-more" onClick={() => setMore(true)} data-testid={`${testId}-more`}>
                {SENTENCE_MORE_LABEL} ▸
              </button>
            </>
          )}
        </p>
      )}
      {more && v.more && <p className="sentence-verdict-full" data-testid={`${testId}-full`}>{v.more}</p>}
    </div>
  );
}

interface Retry {
  text: string;
  input: InputMode;
  state: 'checking' | 'done' | 'offline' | 'error';
  feedback?: SentenceFeedback;
}

/**
 * The grade + the iterate actions. `feedback` = the first check (the one that counts); Try again's checks live here and
 * never change it. `onExample` opens the example (offline Try again falls back to comparing with it).
 */
export function SentenceCheckPanel({ feedback, sentence, input, words, task, speak, onExample }: {
  feedback: SentenceFeedback;
  sentence: string;
  input: InputMode;
  words: string[];
  task?: string;
  speak: Speak;
  onExample: () => void;
}) {
  const [retries, setRetries] = useState<Retry[]>([]);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [fix, setFix] = useState<{ for: string; state: 'loading' | 'done' | 'offline' | 'failed'; fix?: SentenceFix } | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const first = sentenceCheckView(feedback, words);
  const last = retries[retries.length - 1];
  // The sentence being worked on: the latest one Claude has checked, else his first.
  const current = last && last.state === 'done' && last.feedback
    ? { text: last.text, input: last.input, feedback: last.feedback, view: sentenceCheckView(last.feedback, words) }
    : { text: sentence, input, feedback, view: first };
  const solved = current.view.right;
  const busy = last?.state === 'checking';

  function tryAgain(a: DictatedAnswer) {
    const text = spokenCheckAnswer(a.text, a.source);
    if (!text) return;
    const n = retries.length + 1;
    setComposing(false);
    setDraft('');
    setFix(null);
    setRetries((rs) => [...rs, { text, input: a.source, state: 'checking' }]);
    const settle = (patch: Partial<Retry>, result: string) => {
      if (!live.current) return;
      setRetries((rs) => rs.map((r, i) => (i === n - 1 ? { ...r, ...patch } : r)));
      track('lesson.sentence_retry', { result, try: n, input: a.source });
    };
    checkMadeSentence(words, task, text, a.source).then(
      (r) => {
        const grade: SentenceGrade = sentenceCheckView(r.feedback, words).grade;
        settle({ state: 'done', feedback: r.feedback }, grade);
        const f = lessonFeel(grade === 'right' ? 'say_again_right' : 'say_again_miss');
        studyFeel(f.feel);
      },
      (e) => {
        const offline = e instanceof FeedbackUnavailable && e.offline;
        settle({ state: offline ? 'offline' : 'error' }, offline ? 'offline' : 'error');
        if (offline) onExample();
      },
    );
  }

  function showFix() {
    const target = current;
    setFix({ for: target.text, state: 'loading' });
    const started = Date.now();
    // The fix is told what the check found wrong (a problem of meaning has no small edit to find on its own).
    fixMadeSentence(words, task, target.text, target.input, sentenceFixProblem(target.feedback, words)).then(
      (r) => {
        if (!live.current) return;
        setFix({ for: target.text, state: 'done', fix: r.fix });
        track('lesson.sentence_fix_shown', { result: 'shown', ms: Date.now() - started, cached: r.cached });
      },
      (e) => {
        if (!live.current) return;
        const offline = e instanceof FeedbackUnavailable && e.offline;
        setFix({ for: target.text, state: offline ? 'offline' : 'failed' });
        track('lesson.sentence_fix_shown', { result: offline ? 'offline' : 'failed', ms: Date.now() - started, cached: false });
      },
    );
  }

  const shownFix = fix && fix.for === current.text ? fix : null;

  return (
    <div className="sentence-check lesson-feel-host" data-testid="sentence-check">
      {first.right && <LessonFeel moment="claude_right" />}
      <SentenceVerdictLine feedback={feedback} words={words} />

      {retries.map((r, i) => (
        <div key={i} className="sentence-retry" data-testid="sentence-retry" data-state={r.state}>
          <div className="sentence-retry-said">
            <span className="sentence-retry-label">🎤 Try {i + 2}</span>{' '}
            <span lang="zh-CN" className="sentence-retry-text">{r.text}</span>
          </div>
          {r.state === 'checking' && (
            <div className="answer-check checking" role="status" aria-live="polite" data-testid="sentence-retry-checking">
              <span className="answer-check-dot" aria-hidden="true" /> {CLAUDE_CHECKING_LINE}
            </div>
          )}
          {r.state === 'done' && r.feedback && (
            <div className="lesson-feel-host">
              <SentenceVerdictLine feedback={r.feedback} words={words} testId="sentence-retry-feedback" compact />
              {sentenceCheckView(r.feedback, words).right && i === retries.length - 1 && <ConfettiBurst testId="sentence-retry-burst" />}
            </div>
          )}
          {r.state === 'offline' && <p className="sentence-verdict-reason" data-testid="sentence-retry-offline">{SENTENCE_RETRY_OFFLINE}</p>}
          {r.state === 'error' && <p className="sentence-verdict-reason">Claude couldn’t check it just now — try once more.</p>}
        </div>
      ))}

      {!solved && !busy && !composing && (
        <div className="sentence-check-actions">
          <button type="button" className="answer-check-action" onClick={() => setComposing(true)} data-testid="sentence-try-again">
            🎤 {SENTENCE_TRY_AGAIN_LABEL}
          </button>
          {current.view.fixable && !shownFix && (
            <button type="button" className="answer-check-action" onClick={showFix} data-testid="sentence-show-fix">
              ✨ {SENTENCE_SHOW_FIX_LABEL}
            </button>
          )}
        </div>
      )}

      {composing && (
        <div className="sentence-try" data-testid="sentence-try">
          <VoiceTextInput
            surface="lesson_sentence_retry"
            value={draft}
            onChange={setDraft}
            onSubmit={tryAgain}
            submitLabel="Check"
            placeholder="Your new sentence…"
            listeningPlaceholder="Listening… say your sentence"
            multiline
            testId="sentence-try-voice"
          />
          <p className="sentence-try-note">{SENTENCE_RETRY_NOTE}</p>
        </div>
      )}

      {shownFix && !solved && (
        <div className="sentence-fix" data-testid="sentence-fix" data-state={shownFix.state}>
          {shownFix.state === 'loading' && (
            <div className="answer-check checking" role="status" aria-live="polite" data-testid="sentence-fix-loading">
              <span className="answer-check-dot" aria-hidden="true" /> {SENTENCE_FIXING_LINE}
            </div>
          )}
          {shownFix.state === 'offline' && <p className="sentence-verdict-reason" data-testid="sentence-fix-offline">{SENTENCE_FIX_OFFLINE}</p>}
          {shownFix.state === 'failed' && <p className="sentence-verdict-reason">{SENTENCE_FIX_FAILED}</p>}
          {shownFix.state === 'done' && shownFix.fix && (
            <>
              <AnswerDiff
                said={shownFix.for}
                expected={shownFix.fix.hanzi}
                expectedPinyin={shownFix.fix.pinyin}
                expectedEnglish={shownFix.fix.english}
                expectedLabel={SENTENCE_FIX_LABEL}
                saidLabel="You said"
                onPlayExpected={() => speak(shownFix.fix!.hanzi)}
                hideLine
                testId="sentence-fix-diff"
                expectedTestId="sentence-fix-expected"
                playTestId="sentence-fix-play"
              />
              <SayItAgain key={shownFix.fix.hanzi} hanzi={shownFix.fix.hanzi} exerciseType="sentence_making" kind="fix" label={SENTENCE_SAY_FIX_LABEL} testId="lesson-say-fix" />
            </>
          )}
        </div>
      )}
    </div>
  );
}
