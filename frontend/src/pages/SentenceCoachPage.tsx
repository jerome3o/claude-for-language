import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  startCoachConversation,
  getCoachConversations,
  getCoachConversation,
  sendCoachMessage,
  retryCoachReply,
  requestCoachMistakeLesson,
  saveCoachMistakeLesson,
  deleteCoachConversation,
  apiErrorStatus,
} from '../api/client';
import {
  CoachAnalysis,
  CoachBreakdown,
  CoachMessage,
  CoachToolResult,
  SentenceCoachResult,
  SentenceExplanation,
  SentenceTranslation,
} from '../types';
import {
  COACH_ACTION_ICONS,
  COACH_ACTION_LABELS,
  COACH_ACTION_BUSY,
  COACH_RESPOND_LABEL,
  coachDeepLinkAction,
  conversationAction,
  coachButtons,
  hasHan,
  coachMistakeLessonOffered,
  mistakeLessonCardLine,
  mistakeLessonExerciseCount,
  parseMistakeLessonContent,
  COACH_MISTAKE_LESSON_LABEL,
  COACH_MISTAKE_LESSON_BUSY,
  MISTAKE_LESSON_CONTENT_TYPE,
  type CoachAction,
  type MistakeLessonContent,
} from '@shared/coach';
import { cachedCoachLesson, rememberCoachLesson } from '../services/coachLessons';
import { db } from '../db/database';
import { SentenceWordBreakdown } from '../components/SentenceWordBreakdown';
import { syncBumps } from '../services/studyBumps';
import { CoachMarkdown, CoachZh } from '../components/coach/CoachText';
import { PractiseSentence } from '../components/coach/PractiseSentence';
import { cacheTextExplanation, getCachedTextExplanation } from '../services/sentence-sets';
import { syncCustomLessons, prefetchCustomLessonMedia } from '../services/custom-lesson-study';
import { coachReturnPath, setCoachReturn } from '../services/studyResume';
import { track, trackError } from '../services/analytics';
import { useVoiceDictation, type DictatedAnswer } from '../hooks/useVoiceDictation';
import { VoiceTextInputView } from '../components/voice/VoiceTextInput';
import { enterToSubmit } from '../components/voice/enterToSubmit';
import { devicePinyinLine } from '../utils/autoPinyin';
import { DICTATION_COPY, voiceBlockReason, voiceButtonShown, type VoiceBlock } from '@shared/voice/dictation';
import './SentenceCoachPage.css';

/** Why speaking is off, in the coach's words (the box is for a sentence, not an answer). */
function voiceBlockReasonFor(blocked: VoiceBlock): string {
  return voiceBlockReason(blocked).replace('type your answer', 'type it');
}

/** A button's label: "✏️ Check my sentence", "🔍 Explain", "Translate". */
function actionLabel(action: CoachAction): string {
  return action === 'translate' ? COACH_ACTION_LABELS[action] : `${COACH_ACTION_ICONS[action]} ${COACH_ACTION_LABELS[action]}`;
}

const ACTION_LOADING: Record<CoachAction, string> = {
  check: 'Checking your sentence…',
  explain: 'Explaining your sentence…',
  translate: 'Translating your sentence…',
};

/** The "🎯 Mini lesson on this mistake" chip: write one, open the one there is, or say it's being written. */
interface MistakeLessonChip {
  label: string;
  busy: boolean;
  onClick: () => void;
}

// ============ Structured analysis blocks ============

/**
 * A coach answer's big sentence (the corrected sentence, the translation, an Explain's sentence):
 * its words tappable into the language explorer, pinyin and English under it, then ▶ and
 * "🎤 Practise saying it" (components/coach/PractiseSentence.tsx).
 */
function CoachSentence({ hanzi, pinyin, english, testId = 'coach-practise' }: {
  hanzi: string;
  pinyin?: string | null;
  english?: string | null;
  testId?: string;
}) {
  return (
    <div className="coach-sentence">
      <div className="coach-corrected-hanzi" lang="zh"><CoachZh text={hanzi} /></div>
      {pinyin && <div className="coach-corrected-pinyin">{pinyin}</div>}
      {english && <div className="coach-corrected-english">{english}</div>}
      <PractiseSentence hanzi={hanzi} testId={testId} />
    </div>
  );
}

/** "Other ways to say it": each one tappable by word, with its own ▶ / 🎤. */
function AlternativesCard({ alternatives }: { alternatives: Array<{ hanzi: string; pinyin: string; english: string; note?: string | null }> }) {
  if (alternatives.length === 0) return null;
  return (
    <div className="card mt-3">
      <h3 className="mb-2">Other ways to say it</h3>
      {alternatives.map((alt, i) => (
        <div key={i} className="coach-vocab-item coach-alternative-item">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="coach-vocab-hanzi" lang="zh"><CoachZh text={alt.hanzi} /></div>
            <div className="coach-vocab-detail">{alt.pinyin} — {alt.english}</div>
            {alt.note && <div className="coach-vocab-reason"><CoachZh text={alt.note} /></div>}
            <PractiseSentence hanzi={alt.hanzi} testId={`coach-practise-alt-${i}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

// The first reply, kept short on purpose: the correction + a short explanation, then a couple of
// example phrasings. Anything deeper is a question in the follow-up chat.
function CoachResultBlock({ result, mistakeLesson }: { result: SentenceCoachResult; mistakeLesson: MistakeLessonChip | null }) {
  return (
    <>
      <div className="card">
        <span className={`coach-badge ${result.isCorrect ? 'coach-badge-correct' : 'coach-badge-needs-work'}`}>
          {result.isCorrect ? '✓ Looks good!' : 'Needs a little work'}
        </span>
        <CoachSentence hanzi={result.corrected.hanzi} pinyin={result.corrected.pinyin} english={result.corrected.english} />
        {result.critique && <p className="coach-critique"><CoachZh text={result.critique} /></p>}
        {mistakeLesson && (
          <button
            type="button"
            className="btn btn-secondary btn-block coach-mistake-lesson-btn"
            disabled={mistakeLesson.busy}
            onClick={mistakeLesson.onClick}
            data-testid="coach-mistake-lesson"
          >
            {mistakeLesson.busy && <span className="spinner" style={{ width: '14px', height: '14px' }} />}
            {mistakeLesson.label}
          </button>
        )}
      </div>
      <AlternativesCard alternatives={result.alternatives} />
    </>
  );
}

function ExplanationBlock({ explanation, showHeader = true }: {
  explanation: SentenceExplanation;
  showHeader?: boolean;
}) {
  return (
    <>
      {showHeader && (
        <div className="card mt-3">
          <div className="coach-corrected-hanzi" lang="zh"><CoachZh text={explanation.hanzi} /></div>
          <div className="coach-corrected-pinyin">{explanation.pinyin}</div>
          <div className="coach-corrected-english">{explanation.english}</div>
        </div>
      )}

      <div className="card mt-3">
        <h3 className="mb-2">Overview</h3>
        <p><CoachZh text={explanation.overview} /></p>
      </div>

      {explanation.words.length > 0 && (
        <div className="card mt-3">
          <h3 className="mb-2">Word by word</h3>
          {explanation.words.map((word, i) => (
            <div key={i} className="coach-vocab-item">
              <div style={{ minWidth: 0 }}>
                <div className="coach-vocab-hanzi">
                  <CoachZh text={word.hanzi} />
                  {word.role && <span className="coach-word-role">{word.role}</span>}
                </div>
                <div className="coach-vocab-detail">{word.pinyin} — {word.english}</div>
                {word.notes && <div className="coach-vocab-reason"><CoachZh text={word.notes} /></div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {explanation.grammar_points.length > 0 && (
        <div className="card mt-3">
          <h3 className="mb-2">Grammar</h3>
          {explanation.grammar_points.map((point, i) => (
            <div key={i} className="coach-issue coach-grammar-point">
              <span className="coach-issue-type"><CoachZh text={point.pattern} /></span>
              <div className="coach-issue-explanation"><CoachZh text={point.explanation} /></div>
              {point.example && (
                <div className="coach-vocab-reason" style={{ marginTop: '0.25rem' }}>
                  e.g. <CoachZh text={point.example} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {explanation.nuance && (
        <div className="card mt-3">
          <h3 className="mb-2">Nuance &amp; usage</h3>
          <p><CoachZh text={explanation.nuance} /></p>
        </div>
      )}

      {explanation.similar_examples.length > 0 && (
        <div className="card mt-3">
          <h3 className="mb-2">Similar sentences</h3>
          {explanation.similar_examples.map((ex, i) => (
            <div key={i} className="coach-alternative">
              <div className="coach-vocab-hanzi"><CoachZh text={ex.hanzi} /></div>
              <div className="coach-vocab-detail">{ex.pinyin} — {ex.english}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Explain: the translation (instead of Google Translate), then the SAME word-by-word breakdown as
 * the example sentences' "What's going on here?" — every word opens the explorer, where it is
 * added as a card.
 */
function ExplainResultBlock({ breakdown, offlineNote, disabled = false }: {
  breakdown: CoachBreakdown;
  /** Shown when this is the device's saved copy (offline). */
  offlineNote?: string;
  disabled?: boolean;
}) {
  return (
    <div className="coach-explain" data-testid="coach-explain-result">
      <div className="card">
        <span className="coach-badge coach-badge-explain">🔍 Explained</span>
        {offlineNote && <div className="coach-explain-offline">{offlineNote}</div>}
        <CoachSentence hanzi={breakdown.hanzi} pinyin={breakdown.pinyin} english={breakdown.translation} />
      </div>
      <div className="card mt-3">
        <div className="coach-explain-head">
          <h3>Word by word</h3>
          {!disabled && <span className="coach-explain-tip">Tap a word to explore it</span>}
        </div>
        <SentenceWordBreakdown explanation={breakdown} sentence={breakdown.hanzi} source="coach" disabled={disabled} />
      </div>
    </div>
  );
}

function TranslationBlock({ translation }: { translation: SentenceTranslation }) {
  return (
    <>
      <div className="card">
        <span className="coach-badge coach-badge-correct">Translation</span>
        <CoachSentence hanzi={translation.primary.hanzi} pinyin={translation.primary.pinyin} english={translation.primary.english} />
        {translation.primary.note && (
          <div className="coach-vocab-reason" style={{ marginTop: '0.5rem' }}><CoachZh text={translation.primary.note} /></div>
        )}
        {translation.usage_note && (
          <p className="coach-critique"><CoachZh text={translation.usage_note} /></p>
        )}
      </div>
      <AlternativesCard alternatives={translation.alternatives} />
    </>
  );
}

// ============ Message rendering ============

function parseAnalysis(content: string): CoachAnalysis | null {
  try {
    const parsed = JSON.parse(content) as CoachAnalysis;
    if (parsed && (parsed.kind === 'chinese' || parsed.kind === 'english')) return parsed;
    if (parsed && parsed.kind === 'explain' && Array.isArray(parsed.breakdown?.words)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function parseToolResults(raw: string | null): CoachToolResult[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ToolResultChips({ results }: { results: CoachToolResult[] }) {
  if (results.length === 0) return null;
  return (
    <div className="coach-tool-results">
      {results.map((r, i) => {
        if (r.tool === 'create_flashcards' && r.success) {
          const data = r.data as { deck_name?: string; notes?: Array<{ hanzi: string }> } | undefined;
          const hanzi = (data?.notes || []).map(n => n.hanzi).join('、');
          return (
            <div key={i} className="coach-tool-chip coach-tool-chip-success">
              ✓ Added {data?.notes?.length ?? 0} card{(data?.notes?.length ?? 0) === 1 ? '' : 's'}
              {data?.deck_name ? ` to ${data.deck_name}` : ''}{hanzi ? `: ${hanzi}` : ''}
            </div>
          );
        }
        if (r.tool === 'create_custom_lesson' && r.success) {
          const data = r.data as { title?: string } | undefined;
          return (
            <div key={i} className="coach-tool-chip coach-tool-chip-success">
              🎓 Mini lesson created{data?.title ? `: ${data.title}` : ''} — it'll appear in your next study session
            </div>
          );
        }
        return (
          <div key={i} className={`coach-tool-chip ${r.success ? 'coach-tool-chip-success' : 'coach-tool-chip-error'}`}>
            {r.success ? `✓ ${r.tool}` : `✗ ${r.tool}: ${r.error ?? 'failed'}`}
          </div>
        );
      })}
    </div>
  );
}

/**
 * "🎯 Mini lesson on this mistake" in the conversation: ▶ Do it (the player, previewed — or the saved
 * lesson's own run once it is on this device) and Save to my mini lessons.
 */
function MistakeLessonCard({ conversationId, messageId, content, offlineNote }: {
  conversationId: string;
  messageId: string;
  content: MistakeLessonContent;
  offlineNote?: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = !!content.lesson_id;
  const count = mistakeLessonExerciseCount(content.spec);
  useEffect(() => {
    rememberCoachLesson(conversationId, messageId, content);
  }, [conversationId, messageId, content]);

  const play = async () => {
    // Saved and on this device: its own run (the rating counts, "revisit later"); else the preview.
    const local = content.lesson_id ? await db.customLessons.get(content.lesson_id).catch(() => undefined) : undefined;
    navigate(local ? `/lessons/${local.id}/play?from=coach` : `/coach/${encodeURIComponent(conversationId)}/lesson/${encodeURIComponent(messageId)}`);
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await saveCoachMistakeLesson(conversationId, messageId, null);
      queryClient.setQueryData<{ conversation: unknown; messages: CoachMessage[] }>(['coach-conversation', conversationId], (prev) =>
        prev ? { ...prev, messages: prev.messages.map((m) => (m.id === res.message.id ? res.message : m)) } : prev);
      track('coach.mistake_lesson_save', { done: false, rating: null });
      void syncCustomLessons().then(() => prefetchCustomLessonMedia()).catch(() => {});
    } catch (err) {
      setError(coachErrorText(err, 'Couldn’t save it'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card coach-lesson-card" data-testid="coach-lesson-card">
      <div className="coach-lesson-head">
        <span className="coach-lesson-icon" aria-hidden="true">{content.spec.icon || '🎯'}</span>
        <div style={{ minWidth: 0 }}>
          <div className="coach-lesson-line">{mistakeLessonCardLine(count)}</div>
          <div className="coach-lesson-title">{content.spec.title}</div>
          {content.spec.description && <div className="coach-lesson-desc">{content.spec.description}</div>}
        </div>
      </div>
      {offlineNote && <div className="coach-explain-offline">{offlineNote}</div>}
      <div className="coach-lesson-actions">
        <button type="button" className="btn btn-primary" onClick={() => void play()} data-testid="coach-lesson-play">▶ Do it</button>
        {saved ? (
          <span className="coach-lesson-saved" data-testid="coach-lesson-saved-chip">✓ In your mini lessons</span>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => void save()} disabled={saving} data-testid="coach-lesson-save">
            {saving ? 'Saving…' : 'Save to my mini lessons'}
          </button>
        )}
      </div>
      {!saved && <div className="coach-lesson-hint">Try it first — nothing is recorded until you save it.</div>}
      {error && <div className="coach-error mt-2" role="alert">{error}</div>}
    </div>
  );
}

function CoachMessageView({ message, action, onRetry, retrying, conversationId, onRetryLesson, mistakeLesson }: {
  conversationId: string;
  /** A failed mistake lesson: ask for it again (same message). */
  onRetryLesson: () => void;
  /** "🎯 Mini lesson on this mistake" on the check's card (the first analysis only). */
  mistakeLesson: MistakeLessonChip | null;
  message: CoachMessage;
  /** The conversation's action (what a pending first reply is doing). */
  action: CoachAction;
  onRetry: (messageId: string) => void;
  retrying: boolean;
}) {
  if (message.role === 'user') {
    return <div className="coach-bubble coach-bubble-user">{message.content}</div>;
  }

  if (message.content_type === MISTAKE_LESSON_CONTENT_TYPE) {
    if (message.status === 'pending') {
      return (
        <div className="card coach-lesson-card" data-testid="coach-lesson-pending">
          <div className="sentence-loading">
            <div className="sentence-loading-spinner" />
            <p>{COACH_MISTAKE_LESSON_BUSY}</p>
            <p className="coach-pending-note">You can leave — it will be here when you come back.</p>
          </div>
        </div>
      );
    }
    if (message.status === 'failed') {
      return (
        <div className="coach-error" role="alert" data-testid="coach-lesson-failed">
          {message.error || 'Claude couldn’t write a lesson for this one — try again.'}
          <button type="button" className="coach-error-retry" onClick={onRetryLesson} disabled={retrying} data-testid="coach-lesson-retry">
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      );
    }
    const content = parseMistakeLessonContent(message.content);
    return content ? <MistakeLessonCard conversationId={conversationId} messageId={message.id} content={content} /> : null;
  }

  // Written in the background (docs/CHAT.md "Chat ↔ Coach"): leaving the page never cancels it.
  if (message.status === 'pending') {
    if (message.content_type === 'analysis') {
      return (
        <div className="card" data-testid="coach-reply-pending">
          <div className="sentence-loading">
            <div className="sentence-loading-spinner" />
            <p>{ACTION_LOADING[action]}</p>
            <p className="coach-pending-note">You can leave — the answer will be here when you come back.</p>
          </div>
        </div>
      );
    }
    return (
      <div className="coach-bubble coach-bubble-assistant coach-bubble-pending" data-testid="coach-reply-pending">
        <span className="spinner" style={{ width: '16px', height: '16px' }} />
        Thinking…
      </div>
    );
  }
  if (message.status === 'failed') {
    return (
      <div className="coach-error" role="alert" data-testid="coach-reply-failed">
        {message.error || 'Claude couldn’t answer — try again.'}
        <button type="button" className="coach-error-retry" onClick={() => onRetry(message.id)} disabled={retrying} data-testid="coach-reply-retry">
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    );
  }

  if (message.content_type === 'analysis') {
    const analysis = parseAnalysis(message.content);
    if (!analysis) {
      return <div className="coach-bubble coach-bubble-assistant">{message.content}</div>;
    }
    if (analysis.kind === 'explain') {
      return (
        <div className="coach-analysis">
          <ExplainResultBlock breakdown={analysis.breakdown} />
        </div>
      );
    }
    if (analysis.kind === 'chinese') {
      return (
        <div className="coach-analysis">
          <CoachResultBlock result={analysis.coach} mistakeLesson={mistakeLesson} />
          {/* Legacy conversations still carry the full breakdown; new ones omit it. */}
          {analysis.explanation && (
            <ExplanationBlock explanation={analysis.explanation} showHeader={false} />
          )}
        </div>
      );
    }
    return (
      <div className="coach-analysis">
        <TranslationBlock translation={analysis.translation} />
      </div>
    );
  }

  const toolResults = parseToolResults(message.tool_results);
  return (
    <div className="coach-bubble coach-bubble-assistant claude-response">
      <CoachMarkdown>{message.content}</CoachMarkdown>
      <ToolResultChips results={toolResults} />
    </div>
  );
}

// ============ Page ============

/** A dropped connection or a server that said "try again" (5xx other than 502 = Claude declined). */
function isRetryableCoachError(err: unknown): boolean {
  const status = apiErrorStatus(err);
  return status === undefined || (status >= 500 && status !== 502);
}

/** What went wrong, in words: offline vs. the server's own reason. */
function coachErrorText(err: unknown, fallback: string): string {
  const status = apiErrorStatus(err);
  if (status === undefined) {
    return typeof navigator !== 'undefined' && navigator.onLine === false
      ? "You're offline — the coach needs a connection. Your text is kept; try again when you're back online."
      : `${fallback} — the connection dropped. Try again.`;
  }
  const message = err instanceof Error && err.message && !/^HTTP \d+$/.test(err.message) ? err.message : '';
  return message || `${fallback} — something went wrong on our side. Try again.`;
}

export function SentenceCoachPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const conversationId = searchParams.get('c');

  // ?text= (text selection) translates English at once; Chinese lands in the box with the
  // Check / Explain buttons, since only the learner knows which one they want. ?draft= only fills
  // the box (study card ⋯ → Sentence coach), and ?focus=1 (the widget's ✏️) puts the cursor in it
  // with the keyboard up — both land on the two-button state without sending.
  const [sentence, setSentence] = useState(() => searchParams.get('text') ?? searchParams.get('draft') ?? '');
  const navigate = useNavigate();
  // Opened from a study card: "← Back to your card" returns to it (it is kept as it was).
  const [returnTo] = useState(() => coachReturnPath());
  const backToCard = () => {
    setCoachReturn(null);
    navigate(returnTo!, { replace: true });
  };
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Leaving the coach any other way forgets the way back (the card itself stays resumable).
  useEffect(() => () => setCoachReturn(null), []);
  const focusRequestedRef = useRef(searchParams.get('focus') === '1');
  const [followUp, setFollowUp] = useState('');
  // Voice-first boxes (shared/voice/dictation.ts): speaking is the default — a deep link that brings
  // text (?text= / ?draft=) or the widget's ✏️ (?focus=1) opens the box for typing instead.
  const [startTyping] = useState(() => !!(searchParams.get('text') || searchParams.get('draft') || searchParams.get('focus') === '1'));
  /** The coach action a spoken / typed sentence goes to (set just before `sentenceVoice.submit()`). */
  const pendingCoachAction = useRef<CoachAction | null>(null);
  const autoSubmittedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const conversationsQuery = useQuery({
    queryKey: ['coach-conversations'],
    queryFn: getCoachConversations,
    enabled: !conversationId,
    refetchInterval: (q) => (q.state.data?.some((c) => c.pending_reply) ? 4000 : false),
  });

  const conversationQuery = useQuery({
    queryKey: ['coach-conversation', conversationId],
    queryFn: () => getCoachConversation(conversationId!),
    enabled: !!conversationId,
    // A reply still being written in the background: look again every few seconds until it lands.
    refetchInterval: (q) => (q.state.data?.messages.some((m) => m.status === 'pending') ? 2500 : false),
  });

  // Explain's result the device already had, shown when the coach can't be reached.
  const [savedBreakdown, setSavedBreakdown] = useState<CoachBreakdown | null>(null);

  const startMutation = useMutation({
    mutationFn: async ({ text, action, chatMessageId }: { text: string; action: CoachAction; chatMessageId?: string | null }) => {
      if (action !== 'explain') return startCoachConversation(text, action, null, { chatMessageId });
      // Explain is the same brief breakdown as the example sentences' "What's going on here?",
      // cached by its text on this device: send the saved one (the server stores it, no Claude
      // call) and keep what comes back, so a second look works offline.
      const cached = await getCachedTextExplanation(text);
      const res = await startCoachConversation(text, action, cached?.translation ? cached : null, { chatMessageId });
      const analysis = res.messages.find((m) => m.content_type === 'analysis');
      const parsed = analysis ? parseAnalysis(analysis.content) : null;
      if (parsed?.kind === 'explain') {
        const { hanzi: _h, pinyin: _p, ...explanation } = parsed.breakdown;
        void cacheTextExplanation(text, explanation);
      }
      return res;
    },
    // Starting only analyses and saves, so a retry is safe: once more on a
    // dropped connection or a busy-server 5xx (the server already retried Claude).
    retry: (failures, err) => failures < 1 && isRetryableCoachError(err),
    retryDelay: 1500,
    onSuccess: (res, { action }) => {
      track('coach.start', { action });
      startedHere.current.add(res.conversation.id);
      queryClient.setQueryData(['coach-conversation', res.conversation.id], res);
      queryClient.invalidateQueries({ queryKey: ['coach-conversations'] });
      setSentence('');
      setSavedBreakdown(null);
      setSearchParams({ c: res.conversation.id });
    },
    onError: (err, { text, action }) => {
      trackError('coach_start', err);
      if (action === 'explain') void showSavedBreakdown(text);
    },
  });

  /** Offline (or the coach unreachable): the breakdown this device already has for the text. */
  const showSavedBreakdown = async (text: string): Promise<boolean> => {
    const cached = await getCachedTextExplanation(text);
    if (!cached) return false;
    const pinyin = cached.words.map((w) => w.pinyin).filter(Boolean).join(' ');
    setSavedBreakdown({ hanzi: text, pinyin, ...cached });
    return true;
  };

  const runAction = async (action: CoachAction, text = sentence.trim()) => {
    if (!text || startMutation.isPending) return;
    setSavedBreakdown(null);
    // Offline, Explain answers from the device when it can; everything else needs the coach.
    if (action === 'explain' && typeof navigator !== 'undefined' && navigator.onLine === false && (await showSavedBreakdown(text))) return;
    startMutation.mutate({ text, action });
  };

  const replyMutation = useMutation({
    mutationFn: ({ id, message }: { id: string; message: string }) => sendCoachMessage(id, message),
    onSuccess: (res, { id }) => {
      startedHere.current.add(id);
      queryClient.setQueryData(
        ['coach-conversation', id],
        (prev: { conversation: unknown; messages: CoachMessage[] } | undefined) =>
          prev ? { ...prev, messages: [...prev.messages, ...res.messages] } : prev
      );
      queryClient.invalidateQueries({ queryKey: ['coach-conversations'] });
      // A lesson created in this turn should be cached (with media) right
      // away, so it joins the very next study session — even offline.
      // Claude bumped words I already have ("⚡ Study it today"): pull the pocket now.
      if (res.toolResults?.some(r => r.tool === 'bump_cards' && r.success)) {
        syncBumps().catch(console.error);
      }
      if (res.toolResults?.some(r => r.tool === 'create_custom_lesson' && r.success)) {
        syncCustomLessons()
          .then(() => prefetchCustomLessonMedia())
          .catch(console.error);
      }
      setFollowUp('');
    },
    onError: (err) => trackError('coach_follow_up', err),
  });

  const retryMutation = useMutation({
    mutationFn: ({ id, messageId }: { id: string; messageId: string }) => retryCoachReply(id, messageId),
    onSuccess: (res, { id }) => {
      track('coach.reply_retry');
      startedHere.current.add(id);
      queryClient.setQueryData(['coach-conversation', id], res);
    },
    onError: (err) => trackError('coach_reply_retry', err),
  });

  // Conversations whose reply was asked for on this visit (vs. one still thinking when I came back).
  const startedHere = useRef<Set<string>>(new Set());
  const resumeTracked = useRef<Set<string>>(new Set());
  const loaded = conversationQuery.data;
  useEffect(() => {
    if (!loaded || !conversationId) return;
    if (loaded.messages.some((m) => m.status === 'pending') && !startedHere.current.has(conversationId) && !resumeTracked.current.has(conversationId)) {
      resumeTracked.current.add(conversationId);
      track('coach.reply_resumed');
    }
    // An Explain answer that came in the background is kept on the device too (offline second look).
    const first = loaded.messages.find((m) => m.content_type === 'analysis' && !m.status);
    const parsed = first ? parseAnalysis(first.content) : null;
    if (parsed?.kind === 'explain') {
      const { hanzi, pinyin: _p, ...explanation } = parsed.breakdown;
      void getCachedTextExplanation(hanzi).then((have) => (have ? undefined : cacheTextExplanation(hanzi, explanation)));
    }
  }, [loaded, conversationId]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCoachConversation(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['coach-conversations'] }),
  });

  // Deep links arrive as /coach?text=…[&action=…&from_message=…] (coachDeepLinkAction): an explicit
  // action runs at once ("Open in Coach" from a chat message — its auto-check is reused); without one,
  // English is translated at once and Chinese (or mixed) waits in the box on the Check / Explain buttons.
  useEffect(() => {
    const text = searchParams.get('text');
    if (text && text.trim() && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      setSentence(text);
      const action = coachDeepLinkAction(text, searchParams.get('action'));
      if (action) startMutation.mutate({ text: text.trim(), action, chatMessageId: searchParams.get('from_message') });
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ?focus=1: the sentence box focused, cursor at the end (once).
  useEffect(() => {
    if (!focusRequestedRef.current || conversationId) return;
    focusRequestedRef.current = false;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [conversationId]);

  // Keep the newest message in view while chatting
  const messageCount = conversationQuery.data?.messages.length ?? 0;
  useEffect(() => {
    if (messageCount > 2) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messageCount, replyMutation.isPending]);

  /** The Chinese sentence this conversation is about (its first analysis). */
  const firstAnalysisJson = conversationQuery.data?.messages.find((m) => m.content_type === 'analysis' && !m.status)?.content ?? null;
  const firstAnalysis = useMemo(() => (firstAnalysisJson ? parseAnalysis(firstAnalysisJson) : null), [firstAnalysisJson]);
  const firstAnalysisId = conversationQuery.data?.messages.find((m) => m.content_type === 'analysis' && !m.status)?.id ?? null;
  // A mini lesson being written doesn't hold up the chat.
  const replyPending = !!conversationQuery.data?.messages.some((m) => m.status === 'pending' && m.content_type !== MISTAKE_LESSON_CONTENT_TYPE);

  // "🎯 Mini lesson on this mistake": only after a check that found a mistake.
  const lessonMessage = conversationQuery.data?.messages.find((m) => m.content_type === MISTAKE_LESSON_CONTENT_TYPE) ?? null;
  const mistakeLessonOffered = firstAnalysis?.kind === 'chinese' && coachMistakeLessonOffered(firstAnalysis.coach);
  const lessonMutation = useMutation({
    mutationFn: (id: string) => requestCoachMistakeLesson(id),
    onSuccess: (res, id) => {
      track('coach.mistake_lesson_generate', { existing: !!res.existing });
      queryClient.setQueryData<{ conversation: unknown; messages: CoachMessage[] }>(['coach-conversation', id], (prev) => {
        if (!prev) return prev;
        const lesson = res.messages[0];
        const has = prev.messages.some((m) => m.id === lesson.id);
        return { ...prev, messages: has ? prev.messages.map((m) => (m.id === lesson.id ? lesson : m)) : [...prev.messages, lesson] };
      });
      queryClient.invalidateQueries({ queryKey: ['coach-conversations'] });
    },
    onError: (err) => trackError('coach_mistake_lesson', err),
  });
  const askForLesson = () => {
    if (!conversationId || lessonMutation.isPending) return;
    lessonMutation.mutate(conversationId);
  };
  const openLesson = (m: CoachMessage) => navigate(`/coach/${encodeURIComponent(conversationId!)}/lesson/${encodeURIComponent(m.id)}`);
  const lessonChip: MistakeLessonChip | null = !mistakeLessonOffered
    ? null
    : lessonMutation.isPending || lessonMessage?.status === 'pending'
      ? { label: COACH_MISTAKE_LESSON_BUSY, busy: true, onClick: () => {} }
      : lessonMessage && !lessonMessage.status
        ? { label: COACH_MISTAKE_LESSON_LABEL, busy: false, onClick: () => openLesson(lessonMessage) }
        : { label: COACH_MISTAKE_LESSON_LABEL, busy: false, onClick: askForLesson };
  // Offline (the conversation couldn't be fetched): the lesson this device kept for it.
  const keptLesson = conversationId && conversationQuery.isError ? cachedCoachLesson(conversationId) : null;

  const trimmed = sentence.trim();
  // The sentence box, voice first: what was said lands on the review, and the action buttons
  // (✏️ Check / 🔍 Explain or Translate, by what was said) run on it — no Submit of its own.
  const sentenceVoice = useVoiceDictation({
    surface: 'coach',
    value: sentence,
    onChange: setSentence,
    defaultMode: startTyping ? 'type' : 'voice',
    onSubmit: (answer: DictatedAnswer) => {
      const action = pendingCoachAction.current;
      pendingCoachAction.current = null;
      // The text stays in the box (typing) while the coach works, so a failure keeps it for "Try again".
      setSentence(answer.text);
      if (answer.source === 'spoken') sentenceVoice.type();
      if (action) void runAction(action, answer.text);
    },
  });
  const sentenceReview = sentenceVoice.state.mode === 'voice' && sentenceVoice.state.phase === 'review';
  // ✏️ Type / ✏️ Edit: into the box, keyboard up, caret at the end.
  const sentenceTyping = sentenceVoice.state.mode === 'type';
  const wasTyping = useRef(sentenceTyping);
  useEffect(() => {
    if (sentenceTyping && !wasTyping.current && !sentenceVoice.state.blocked && !startMutation.isPending) {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
    wasTyping.current = sentenceTyping;
  }, [sentenceTyping, sentenceVoice.state.blocked, startMutation.isPending]);
  // On the review the buttons follow what was SAID (English → Translate); typing, what is in the box.
  const buttons = coachButtons(sentenceReview ? sentenceVoice.finalText : sentence);
  const runCoachAction = (action: CoachAction) => {
    if (startMutation.isPending) return;
    pendingCoachAction.current = action;
    sentenceVoice.submit();
    if (!sentenceReview && !sentenceVoice.canSubmit) pendingCoachAction.current = null;
  };
  const pendingAction = startMutation.isPending ? startMutation.variables?.action ?? null : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runCoachAction(buttons.actions[0]);
  };

  const sendFollowUp = (message: string) => {
    const msg = message.trim();
    if (!msg || !conversationId || replyMutation.isPending || replyPending) return;
    track('coach.follow_up');
    replyMutation.mutate({ id: conversationId, message: msg });
  };
  // The follow-up box, voice first like the sentence box (Send instead of Submit).
  const followUpVoice = useVoiceDictation({
    surface: 'coach_chat',
    value: followUp,
    onChange: setFollowUp,
    onSubmit: (answer) => {
      // Kept in the box until the reply is in (cleared on success), so a failed send can be resent.
      setFollowUp(answer.text);
      sendFollowUp(answer.text);
    },
  });
  // A spoken follow-up that failed to send: into the box (typing) so it can be fixed or sent again.
  useEffect(() => {
    if (replyMutation.isError && followUp.trim() && followUpVoice.state.mode === 'voice' && followUpVoice.state.phase === 'idle') followUpVoice.type();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyMutation.isError]);

  const openConversation = (id: string) => {
    setSearchParams({ c: id });
  };

  const backToList = () => {
    setSearchParams({});
    // Back on the coach's first page: speaking again, whatever was used last.
    if (!sentence.trim()) sentenceVoice.reset();
  };

  // ============ Conversation view ============
  if (conversationId) {
    const data = conversationQuery.data;
    return (
      <div className="page">
        <div className="container">
          {returnTo && (
            <button className="btn btn-secondary btn-block coach-back-to-card" onClick={backToCard} data-testid="coach-back-to-card">
              ← Back to your card
            </button>
          )}
          <div className="coach-conv-header">
            <button className="btn btn-secondary" onClick={backToList}>← Coach</button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                backToList();
                setSentence('');
              }}
            >
              + New Sentence
            </button>
          </div>

          {conversationQuery.isLoading && (
            <div className="card mt-3">
              <div className="sentence-loading">
                <div className="sentence-loading-spinner" />
                <p>Loading conversation...</p>
              </div>
            </div>
          )}

          {conversationQuery.isError && (
            <div className="coach-error mt-3">Couldn't load this conversation.</div>
          )}
          {keptLesson && (
            <div className="mt-3">
              <MistakeLessonCard
                conversationId={conversationId!}
                messageId={keptLesson.messageId}
                content={keptLesson.content}
                offlineNote="Saved on this device — you can do it offline."
              />
            </div>
          )}

          {data && (
            <div className="coach-messages mt-3">
              {data.messages.map((m) => (
                <CoachMessageView
                  key={m.id}
                  message={m}
                  mistakeLesson={m.id === firstAnalysisId ? lessonChip : null}
                  action={conversationAction(data.conversation)}
                  onRetry={(messageId) => retryMutation.mutate({ id: data.conversation.id, messageId })}
                  retrying={retryMutation.isPending || lessonMutation.isPending}
                  conversationId={data.conversation.id}
                  onRetryLesson={askForLesson}
                />
              ))}

              {replyMutation.isPending && (
                <div className="coach-bubble coach-bubble-assistant coach-bubble-pending">
                  <span className="spinner" style={{ width: '16px', height: '16px' }} />
                  Thinking...
                </div>
              )}
              {replyMutation.isError && (
                <div className="coach-error">{coachErrorText(replyMutation.error, "Couldn't send that")}</div>
              )}
              {lessonMutation.isError && (
                <div className="coach-error" role="alert" data-testid="coach-lesson-error">
                  {coachErrorText(lessonMutation.error, "Couldn't start the lesson")}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {data && (
            <div className="coach-followup-form" data-testid="coach-followup" onKeyDown={enterToSubmit(followUpVoice.submit)}>
              <VoiceTextInputView
                value={followUp}
                onChange={setFollowUp}
                placeholder="Ask a follow-up… (grammar, usage, more examples)"
                listeningPlaceholder="Listening… ask anything, in Chinese or English"
                sayLabel={COACH_RESPOND_LABEL}
                submitLabel={replyMutation.isPending || replyPending ? '…' : 'Send'}
                multiline
                disabled={replyMutation.isPending || replyPending}
                testId="coach-followup"
                className="coach-followup-voice"
                state={followUpVoice.state}
                finalText={followUpVoice.finalText}
                partialText={followUpVoice.partialText}
                canSubmit={followUpVoice.canSubmit}
                actions={followUpVoice}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ============ Home view: new sentence + conversation list ============
  const conversations = conversationsQuery.data ?? [];

  return (
    <div className="page">
      <div className="container">
        {returnTo && (
          <button className="btn btn-secondary btn-block coach-back-to-card" onClick={backToCard} data-testid="coach-back-to-card">
            ← Back to your card
          </button>
        )}
        <h1 className="mb-2">Sentence Coach</h1>
        <p className="text-light mb-4">
          Wrote something in Chinese? Check it. Reading something? Explain it word by word. Or say
          English to hear how to say it in Chinese. Speak or type — then keep chatting about it.
        </p>

        <div className="card">
          <form onSubmit={handleSubmit} className="sentence-input-form" data-testid="coach-sentence-box">
            {sentenceVoice.state.mode === 'type' ? (
              <div className="form-group">
                <div className="coach-typing-row">
                  <textarea
                    ref={inputRef}
                    className="form-textarea"
                    value={sentence}
                    onChange={(e) => setSentence(e.target.value)}
                    placeholder="我昨天去了商店买苹果 — or — How do I say I'm running late?"
                    required
                    rows={3}
                    data-testid="coach-sentence-text"
                  />
                  {voiceButtonShown(sentenceVoice.state.blocked) ? (
                    <button
                      type="button"
                      className="voice-input-mic coach-say-mic"
                      onClick={sentenceVoice.say}
                      aria-label={DICTATION_COPY.micLabel}
                      data-testid="coach-sentence-mic"
                    >
                      🎤
                    </button>
                  ) : null}
                </div>
                {sentenceVoice.state.blocked && (
                  <div className="coach-detect-hint" data-testid="coach-voice-blocked">{voiceBlockReasonFor(sentenceVoice.state.blocked)}</div>
                )}
                {buttons.hint && (
                  <div className="coach-detect-hint" data-testid="coach-detect-hint">{buttons.hint}</div>
                )}
              </div>
            ) : sentenceReview ? (
              <div className="form-group">
                <div className="voice-input-review coach-voice-review" data-testid="coach-voice-review" aria-live="polite">
                  <div
                    className={`voice-input-review-text${hasHan(sentenceVoice.finalText) ? ' hanzi' : ''}${Array.from(sentenceVoice.finalText).length > 12 ? ' is-long' : ''}`}
                    data-testid="coach-voice-review-text"
                  >
                    {sentenceVoice.finalText}
                  </div>
                  {hasHan(sentenceVoice.finalText) && (
                    <div className="pinyin voice-input-review-pinyin">{devicePinyinLine(sentenceVoice.finalText)}</div>
                  )}
                </div>
                <div className="voice-input-row coach-voice-review-row">
                  <button type="button" className="btn btn-secondary voice-input-side" onClick={sentenceVoice.retake} data-testid="coach-voice-retake">
                    <span aria-hidden="true">🔁</span> {DICTATION_COPY.retake}
                  </button>
                  <button type="button" className="btn btn-secondary voice-input-side" onClick={sentenceVoice.edit} aria-label="Edit what I said" data-testid="coach-voice-edit">
                    <span aria-hidden="true">✏️</span> {DICTATION_COPY.edit}
                  </button>
                </div>
                {buttons.hint && (
                  <div className="coach-detect-hint" data-testid="coach-detect-hint">{buttons.hint}</div>
                )}
              </div>
            ) : (
              <div className="form-group">
                <VoiceTextInputView
                  value={sentence}
                  onChange={setSentence}
                  listeningPlaceholder="Listening… say it in Chinese or English"
                  testId="coach-voice"
                  state={sentenceVoice.state}
                  finalText={sentenceVoice.finalText}
                  partialText={sentenceVoice.partialText}
                  canSubmit={sentenceVoice.canSubmit}
                  actions={sentenceVoice}
                />
                {sentenceVoice.state.phase === 'idle' && (
                  <div className="coach-detect-hint coach-voice-hint">Say a sentence in Chinese to check or explain it — or in English to hear how to say it.</div>
                )}
              </div>
            )}

            {startMutation.error && (
              <div className="coach-error mb-3" role="alert" data-testid="coach-start-error">
                {coachErrorText(startMutation.error, "Couldn't reach the coach")}
                {trimmed && startMutation.variables && (
                  <button type="button" className="coach-error-retry" onClick={() => runAction(startMutation.variables!.action, trimmed)}>
                    Try again
                  </button>
                )}
              </div>
            )}

            {(sentenceVoice.state.mode === 'type' || sentenceReview) && (
              <div className="sentence-input-actions coach-action-buttons" role="group" aria-label="What to do with it">
                {buttons.actions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    className={`btn flex-1 coach-action-btn coach-action-${action} ${action === 'explain' ? 'btn-secondary' : 'btn-primary'}`}
                    disabled={!buttons.enabled || startMutation.isPending}
                    onClick={() => runCoachAction(action)}
                    data-testid={`coach-action-${action}`}
                  >
                    {pendingAction === action ? (
                      <>
                        <span className="spinner" style={{ width: '20px', height: '20px' }} />
                        {COACH_ACTION_BUSY[action]}
                      </>
                    ) : (
                      actionLabel(action)
                    )}
                  </button>
                ))}
              </div>
            )}
          </form>
        </div>

        {pendingAction && (
          <div className="card mt-4">
            <div className="sentence-loading">
              <div className="sentence-loading-spinner" />
              <p>{ACTION_LOADING[pendingAction]}</p>
            </div>
          </div>
        )}

        {savedBreakdown && !startMutation.isPending && (
          <div className="mt-4">
            <ExplainResultBlock
              breakdown={savedBreakdown}
              disabled={typeof navigator !== 'undefined' && navigator.onLine === false}
              offlineNote="Saved on this device — the follow-up chat needs a connection."
            />
          </div>
        )}
        {conversations.length > 0 && (
          <div className="card mt-4">
            <h3 className="mb-2">Recent conversations</h3>
            {conversations.map((conv) => (
              <div key={conv.id} className="coach-conv-item">
                <button
                  type="button"
                  className="coach-conv-open"
                  onClick={() => openConversation(conv.id)}
                >
                  <div className="coach-conv-title">
                    {COACH_ACTION_ICONS[conversationAction(conv)]} {conv.title}
                  </div>
                  <div className="coach-conv-meta">
                    {conv.pending_reply && (
                      <span className="coach-conv-thinking" data-testid="coach-conv-thinking">
                        <span className="spinner" style={{ width: '12px', height: '12px' }} /> Thinking… ·{' '}
                      </span>
                    )}
                    {!conv.pending_reply && conv.failed_reply && <span className="coach-conv-failed">⚠ Reply failed — open to retry · </span>}
                    {conv.message_count} message{conv.message_count === 1 ? '' : 's'} ·{' '}
                    {new Date(conv.updated_at + (conv.updated_at.endsWith('Z') ? '' : 'Z')).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </div>
                </button>
                <button
                  type="button"
                  className="coach-conv-delete"
                  aria-label="Delete conversation"
                  onClick={() => {
                    if (confirm('Delete this conversation?')) deleteMutation.mutate(conv.id);
                  }}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="card mt-4">
          <h3 className="mb-2">How it works</h3>
          <ul style={{ paddingLeft: '1.25rem', color: 'var(--color-text-light)' }}>
            <li>✏️ Check my sentence → corrected, with a short explanation of what changed</li>
            <li>🔍 Explain → the translation and every word with pinyin and meaning</li>
            <li>English → translated, with alternatives</li>
            <li>Tap any Chinese word to explore it — add it as a card or study it today from there</li>
            <li>🎤 Practise saying it → say the sentence and see if it sounded right</li>
            <li>Then 🎤 Respond (or type) to ask anything — the coach can also add cards and build a mini lesson</li>
            <li>Conversations are saved, so you can come back and continue</li>
            <li>Tip: select text anywhere on your phone and choose "Sentence Coach" (Android app)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default SentenceCoachPage;
