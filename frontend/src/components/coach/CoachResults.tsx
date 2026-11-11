/**
 * The Sentence Coach's result cards (docs/CHAT.md "The Coach conversation"), shared by the Coach page
 * and the Claude thread view (components/claude/ClaudeThreadView.tsx): ✏️ Check (correction +
 * critique + alternatives, each sentence with ▶ / 🎤 Practise saying it, 🎯 Mini lesson), 🔍 Explain
 * (the word-by-word breakdown), Translate, the mistake-lesson card, the tool-result chips, and
 * `CoachMessageView` (one coach message: pending / failed / analysis / Markdown reply).
 */
import { useEffect, useState } from 'react';
import { isSourceDeckKey } from '@shared/decks/source-decks';
import { AddedToDeckLine } from '../sourceDecks/AddedToDeckLine';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { saveCoachMistakeLesson, apiErrorStatus } from '../../api/client';
import type {
  CoachAnalysis,
  CoachBreakdown,
  CoachMessage,
  CoachToolResult,
  SentenceCoachResult,
  SentenceExplanation,
  SentenceTranslation,
} from '../../types';
import {
  mistakeLessonCardLine,
  mistakeLessonExerciseCount,
  parseMistakeLessonContent,
  COACH_MISTAKE_LESSON_BUSY,
  MISTAKE_LESSON_CONTENT_TYPE,
  type CoachAction,
  type MistakeLessonContent,
} from '@shared/coach';
import { rememberCoachLesson } from '../../services/coachLessons';
import { db } from '../../db/database';
import { SentenceWordBreakdown } from '../SentenceWordBreakdown';
import { CoachMarkdown, CoachZh } from './CoachText';
import { PractiseSentence } from './PractiseSentence';
import { syncCustomLessons, prefetchCustomLessonMedia } from '../../services/custom-lesson-study';
import { track } from '../../services/analytics';
import '../../pages/SentenceCoachPage.css';

export const ACTION_LOADING: Record<CoachAction, string> = {
  check: 'Checking your sentence…',
  explain: 'Explaining your sentence…',
  translate: 'Translating your sentence…',
};

/** The "🎯 Mini lesson on this mistake" chip: write one, open the one there is, or say it's being written. */
export interface MistakeLessonChip {
  label: string;
  busy: boolean;
  onClick: () => void;
}


/**
 * A coach answer's big sentence (the corrected sentence, the translation, an Explain's sentence):
 * its words tappable into the language explorer, pinyin and English under it, then ▶ and
 * "🎤 Practise saying it" (components/coach/PractiseSentence.tsx).
 */
export function CoachSentence({ hanzi, pinyin, english, testId = 'coach-practise' }: {
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
export function AlternativesCard({ alternatives }: { alternatives: Array<{ hanzi: string; pinyin: string; english: string; note?: string | null }> }) {
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
export function CoachResultBlock({ result, mistakeLesson }: { result: SentenceCoachResult; mistakeLesson: MistakeLessonChip | null }) {
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

export function ExplanationBlock({ explanation, showHeader = true }: {
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
export function ExplainResultBlock({ breakdown, offlineNote, disabled = false }: {
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

export function TranslationBlock({ translation }: { translation: SentenceTranslation }) {
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

export function parseAnalysis(content: string): CoachAnalysis | null {
  try {
    const parsed = JSON.parse(content) as CoachAnalysis;
    if (parsed && (parsed.kind === 'chinese' || parsed.kind === 'english')) return parsed;
    if (parsed && parsed.kind === 'explain' && Array.isArray(parsed.breakdown?.words)) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function parseToolResults(raw: string | null): CoachToolResult[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ToolResultChips({ results }: { results: CoachToolResult[] }) {
  if (results.length === 0) return null;
  return (
    <div className="coach-tool-results">
      {results.map((r, i) => {
        if (r.tool === 'create_flashcards' && r.success) {
          const data = r.data as { deck_name?: string; deck_id?: string; deck_source_key?: string | null; notes?: Array<{ id?: string; hanzi: string }> } | undefined;
          const hanzi = (data?.notes || []).map(n => n.hanzi).join('、');
          const noteIds = (data?.notes || []).map((n) => n.id).filter((id): id is string => !!id);
          // A reply since source decks (the cards went to "From Claude" unless he named a deck): Change moves them.
          if (data?.deck_id && noteIds.length) {
            return (
              <div key={i} className="coach-tool-chip coach-tool-chip-success coach-tool-chip-added">
                <AddedToDeckLine
                  added={{ key: isSourceDeckKey(data.deck_source_key) ? data.deck_source_key : 'claude', noteIds, deckId: data.deck_id, deckName: data.deck_name || 'your deck' }}
                  surface="coach"
                />
                {hanzi && <span className="coach-tool-chip-words" lang="zh">{hanzi}</span>}
              </div>
            );
          }
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
export function MistakeLessonCard({ conversationId, messageId, content, offlineNote, onSaved }: {
  conversationId: string;
  messageId: string;
  content: MistakeLessonContent;
  offlineNote?: string;
  /** Saved: the message as the server has it now (the thread view refreshes its cache). */
  onSaved?: (message: CoachMessage) => void;
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
      onSaved?.(res.message);
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

export function CoachMessageView({ message, action, onRetry, retrying, conversationId, onRetryLesson, mistakeLesson, onLessonSaved }: {
  conversationId: string;
  /** A failed mistake lesson: ask for it again (same message). */
  onRetryLesson: () => void;
  /** "🎯 Mini lesson on this mistake" on the check's card (the first analysis only). */
  mistakeLesson: MistakeLessonChip | null;
  message: Pick<CoachMessage, 'id' | 'role' | 'content_type' | 'content' | 'tool_results' | 'status' | 'error'>;
  onLessonSaved?: (message: CoachMessage) => void;
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
    return content ? <MistakeLessonCard conversationId={conversationId} messageId={message.id} content={content} onSaved={onLessonSaved} /> : null;
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

/** A dropped connection or a server that said "try again" (5xx other than 502 = Claude declined). */
export function isRetryableCoachError(err: unknown): boolean {
  const status = apiErrorStatus(err);
  return status === undefined || (status >= 500 && status !== 502);
}

/** What went wrong, in words: offline vs. the server's own reason. */
export function coachErrorText(err: unknown, fallback: string): string {
  const status = apiErrorStatus(err);
  if (status === undefined) {
    return typeof navigator !== 'undefined' && navigator.onLine === false
      ? "You're offline — the coach needs a connection. Your text is kept; try again when you're back online."
      : `${fallback} — the connection dropped. Try again.`;
  }
  const message = err instanceof Error && err.message && !/^HTTP \d+$/.test(err.message) ? err.message : '';
  return message || `${fallback} — something went wrong on our side. Try again.`;
}
