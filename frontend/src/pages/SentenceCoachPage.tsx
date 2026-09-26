import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  startCoachConversation,
  getCoachConversations,
  getCoachConversation,
  sendCoachMessage,
  deleteCoachConversation,
  getDecks,
} from '../api/client';
import {
  CoachAnalysis,
  CoachMessage,
  CoachToolResult,
  Deck,
  SentenceCoachResult,
  SentenceExplanation,
  SentenceTranslation,
} from '../types';
import { containsChinese } from '../utils/textLanguage';
import { syncCustomLessons, prefetchCustomLessonMedia } from '../services/custom-lesson-study';
import './SentenceCoachPage.css';

const LAST_DECK_KEY = 'coach-last-deck-id';

// ============ Quick actions: one tap prompts the coach chat ============

/**
 * The first reply is deliberately short. Everything deeper — a proper
 * flashcard to the card standard, more examples, other phrasings, the
 * grammar — is one tap away: each chip sends a prepared message into the
 * follow-up chat, where Claude has the card standard and the tools.
 */
interface QuickAction {
  key: string;
  label: string;
  message: (ctx: { hanzi: string; deck: Deck | null }) => string;
}

const deckClause = (deck: Deck | null) => (deck ? ` Put it in my deck "${deck.name}" (deck_id ${deck.id}).` : '');

const QUICK_ACTIONS: QuickAction[] = [
  {
    key: 'card-word',
    label: '🃏 Make a card',
    message: ({ hanzi, deck }) =>
      `Make a flashcard for the key word or phrase in "${hanzi}" — the one most worth learning from this sentence.${deckClause(deck)} Check search_cards first so you don't duplicate a card I already have (if I have it, tell me and offer to improve it instead). Follow the card standard fully: one clean hanzi form, pinyin with tone marks, one clear English meaning, a fun_facts explanation (each character, then usage, the common mistake or contrast), and a short natural example sentence with pinyin and translation as the sentence_clue.`,
  },
  {
    key: 'card-sentence',
    label: '📝 Card for the whole sentence',
    message: ({ hanzi, deck }) =>
      `Make a flashcard for the whole sentence "${hanzi}".${deckClause(deck)} Follow the card standard: hanzi is the clean sentence, pinyin with tone marks, one natural English meaning, and fun_facts that gloss every word in order (汉字 (pīnyīn) meaning) then explain the structure and the common mistake. Check search_cards first so it is not a duplicate.`,
  },
  {
    key: 'examples',
    label: '💬 More examples',
    message: ({ hanzi }) => `Give me 3 more example sentences using the key word or pattern from "${hanzi}", easiest first, each with pinyin (tone marks) and English.`,
  },
  {
    key: 'alternatives',
    label: '🔀 Other ways to say it',
    message: ({ hanzi }) => `Show me 2–3 other natural ways to say "${hanzi}" — more casual, more formal, more idiomatic — each with pinyin and English, and when you would use each.`,
  },
  {
    key: 'grammar',
    label: '🔍 Explain the grammar',
    message: ({ hanzi }) => `Explain "${hanzi}" word by word: each word with pinyin and its meaning here, then the structure and any grammar pattern in it, briefly.`,
  },
];

/** The Chinese sentence the latest analysis settled on (corrected or translated). */
function analysisSentence(analysis: CoachAnalysis): string {
  return analysis.kind === 'chinese' ? analysis.coach.corrected.hanzi : analysis.translation.primary.hanzi;
}

function QuickActions({ hanzi, decks, selectedDeckId, onDeckChange, onSend, disabled }: {
  hanzi: string;
  decks: Deck[] | undefined;
  selectedDeckId: string;
  onDeckChange: (deckId: string) => void;
  onSend: (message: string) => void;
  disabled: boolean;
}) {
  const deck = decks?.find((d) => d.id === selectedDeckId) ?? decks?.[0] ?? null;
  return (
    <div className="coach-quick" data-testid="coach-quick-actions">
      <div className="coach-quick-row" role="group" aria-label="Quick actions">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.key}
            type="button"
            className="coach-quick-chip"
            disabled={disabled || (a.key.startsWith('card') && !deck)}
            onClick={() => onSend(a.message({ hanzi, deck }))}
            data-testid={`coach-quick-${a.key}`}
          >
            {a.label}
          </button>
        ))}
      </div>
      {decks && decks.length > 0 && (
        <label className="coach-quick-deck">
          <span>Cards go to</span>
          <select className="coach-deck-select" value={deck?.id ?? ''} onChange={(e) => onDeckChange(e.target.value)} disabled={disabled}>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

// ============ Structured analysis blocks ============

// The first reply, kept short on purpose: the correction + a short
// explanation, then a couple of example phrasings. Cards, examples and the
// word-by-word breakdown are one quick-action tap away in the chat.
function CoachResultBlock({ result }: { result: SentenceCoachResult }) {
  return (
    <>
      <div className="card">
        <span className={`coach-badge ${result.isCorrect ? 'coach-badge-correct' : 'coach-badge-needs-work'}`}>
          {result.isCorrect ? '✓ Looks good!' : 'Needs a little work'}
        </span>
        <div className="coach-corrected-hanzi">{result.corrected.hanzi}</div>
        <div className="coach-corrected-pinyin">{result.corrected.pinyin}</div>
        <div className="coach-corrected-english">{result.corrected.english}</div>
        {result.critique && <p className="coach-critique">{result.critique}</p>}
      </div>

      {result.alternatives.length > 0 && (
        <div className="card mt-3">
          <h3 className="mb-2">Other ways to say it</h3>
          {result.alternatives.map((alt, i) => (
            <div key={i} className="coach-vocab-item">
              <div style={{ minWidth: 0 }}>
                <div className="coach-vocab-hanzi">{alt.hanzi}</div>
                <div className="coach-vocab-detail">{alt.pinyin} — {alt.english}</div>
                {alt.note && <div className="coach-vocab-reason">{alt.note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
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
          <div className="coach-corrected-hanzi">{explanation.hanzi}</div>
          <div className="coach-corrected-pinyin">{explanation.pinyin}</div>
          <div className="coach-corrected-english">{explanation.english}</div>
        </div>
      )}

      <div className="card mt-3">
        <h3 className="mb-2">Overview</h3>
        <p>{explanation.overview}</p>
      </div>

      {explanation.words.length > 0 && (
        <div className="card mt-3">
          <h3 className="mb-2">Word by word</h3>
          {explanation.words.map((word, i) => (
            <div key={i} className="coach-vocab-item">
              <div style={{ minWidth: 0 }}>
                <div className="coach-vocab-hanzi">
                  {word.hanzi}
                  {word.role && <span className="coach-word-role">{word.role}</span>}
                </div>
                <div className="coach-vocab-detail">{word.pinyin} — {word.english}</div>
                {word.notes && <div className="coach-vocab-reason">{word.notes}</div>}
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
              <span className="coach-issue-type">{point.pattern}</span>
              <div className="coach-issue-explanation">{point.explanation}</div>
              {point.example && (
                <div className="coach-vocab-reason" style={{ marginTop: '0.25rem' }}>
                  e.g. {point.example}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {explanation.nuance && (
        <div className="card mt-3">
          <h3 className="mb-2">Nuance &amp; usage</h3>
          <p>{explanation.nuance}</p>
        </div>
      )}

      {explanation.similar_examples.length > 0 && (
        <div className="card mt-3">
          <h3 className="mb-2">Similar sentences</h3>
          {explanation.similar_examples.map((ex, i) => (
            <div key={i} className="coach-alternative">
              <div className="coach-vocab-hanzi">{ex.hanzi}</div>
              <div className="coach-vocab-detail">{ex.pinyin} — {ex.english}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function TranslationBlock({ translation }: { translation: SentenceTranslation }) {
  return (
    <>
      <div className="card">
        <span className="coach-badge coach-badge-correct">Translation</span>
        <div className="coach-corrected-hanzi">{translation.primary.hanzi}</div>
        <div className="coach-corrected-pinyin">{translation.primary.pinyin}</div>
        <div className="coach-corrected-english">{translation.primary.english}</div>
        {translation.primary.note && (
          <div className="coach-vocab-reason" style={{ marginTop: '0.5rem' }}>{translation.primary.note}</div>
        )}
        {translation.usage_note && (
          <p className="coach-critique">{translation.usage_note}</p>
        )}
      </div>

      {translation.alternatives.length > 0 && (
        <div className="card mt-3">
          <h3 className="mb-2">Other ways to say it</h3>
          {translation.alternatives.map((alt, i) => (
            <div key={i} className="coach-vocab-item">
              <div style={{ minWidth: 0 }}>
                <div className="coach-vocab-hanzi">{alt.hanzi}</div>
                <div className="coach-vocab-detail">{alt.pinyin} — {alt.english}</div>
                {alt.note && <div className="coach-vocab-reason">{alt.note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ============ Message rendering ============

function parseAnalysis(content: string): CoachAnalysis | null {
  try {
    const parsed = JSON.parse(content) as CoachAnalysis;
    if (parsed && (parsed.kind === 'chinese' || parsed.kind === 'english')) return parsed;
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

function CoachMessageView({ message }: { message: CoachMessage }) {
  if (message.role === 'user') {
    return <div className="coach-bubble coach-bubble-user">{message.content}</div>;
  }

  if (message.content_type === 'analysis') {
    const analysis = parseAnalysis(message.content);
    if (!analysis) {
      return <div className="coach-bubble coach-bubble-assistant">{message.content}</div>;
    }
    if (analysis.kind === 'chinese') {
      return (
        <div className="coach-analysis">
          <CoachResultBlock result={analysis.coach} />
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
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      <ToolResultChips results={toolResults} />
    </div>
  );
}

// ============ Page ============

export function SentenceCoachPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const conversationId = searchParams.get('c');

  const [sentence, setSentence] = useState(() => searchParams.get('text') ?? '');
  const [followUp, setFollowUp] = useState('');
  const [selectedDeckId, setSelectedDeckId] = useState<string>(
    () => localStorage.getItem(LAST_DECK_KEY) ?? ''
  );
  const autoSubmittedRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: decks } = useQuery({ queryKey: ['decks'], queryFn: getDecks });

  const conversationsQuery = useQuery({
    queryKey: ['coach-conversations'],
    queryFn: getCoachConversations,
    enabled: !conversationId,
  });

  const conversationQuery = useQuery({
    queryKey: ['coach-conversation', conversationId],
    queryFn: () => getCoachConversation(conversationId!),
    enabled: !!conversationId,
  });

  const startMutation = useMutation({
    mutationFn: (text: string) => startCoachConversation(text),
    onSuccess: (res) => {
      queryClient.setQueryData(['coach-conversation', res.conversation.id], res);
      queryClient.invalidateQueries({ queryKey: ['coach-conversations'] });
      setSentence('');
      setSearchParams({ c: res.conversation.id });
    },
  });

  const replyMutation = useMutation({
    mutationFn: ({ id, message }: { id: string; message: string }) => sendCoachMessage(id, message),
    onSuccess: (res, { id }) => {
      queryClient.setQueryData(
        ['coach-conversation', id],
        (prev: { conversation: unknown; messages: CoachMessage[] } | undefined) =>
          prev ? { ...prev, messages: [...prev.messages, ...res.messages] } : prev
      );
      queryClient.invalidateQueries({ queryKey: ['coach-conversations'] });
      // A lesson created in this turn should be cached (with media) right
      // away, so it joins the very next study session — even offline.
      if (res.toolResults?.some(r => r.tool === 'create_custom_lesson' && r.success)) {
        syncCustomLessons()
          .then(() => prefetchCustomLessonMedia())
          .catch(console.error);
      }
      setFollowUp('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCoachConversation(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['coach-conversations'] }),
  });

  // Deep links (widget / text selection) arrive as /coach?text=...
  // Language auto-detection decides what happens; start a conversation immediately.
  useEffect(() => {
    const text = searchParams.get('text');
    if (text && text.trim() && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      setSentence(text);
      startMutation.mutate(text.trim());
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Default the deck picker to the remembered deck, else the first deck
  useEffect(() => {
    if (!decks || decks.length === 0) return;
    if (selectedDeckId && decks.some((d) => d.id === selectedDeckId)) return;
    setSelectedDeckId(decks[0].id);
  }, [decks, selectedDeckId]);

  // Keep the newest message in view while chatting
  const messageCount = conversationQuery.data?.messages.length ?? 0;
  useEffect(() => {
    if (messageCount > 2) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messageCount, replyMutation.isPending]);

  const handleDeckChange = (deckId: string) => {
    setSelectedDeckId(deckId);
    localStorage.setItem(LAST_DECK_KEY, deckId);
  };

  /** The Chinese sentence this conversation is about (its first analysis). */
  const latestSentence = (() => {
    const first = conversationQuery.data?.messages.find((m) => m.content_type === 'analysis');
    const analysis = first ? parseAnalysis(first.content) : null;
    return analysis ? analysisSentence(analysis) : null;
  })();

  const sendQuickAction = (message: string) => {
    if (!conversationId || replyMutation.isPending) return;
    replyMutation.mutate({ id: conversationId, message });
  };

  const trimmed = sentence.trim();
  const inputIsChinese = trimmed ? containsChinese(trimmed) : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed || startMutation.isPending) return;
    startMutation.mutate(trimmed);
  };

  const handleFollowUp = (e: React.FormEvent) => {
    e.preventDefault();
    const msg = followUp.trim();
    if (!msg || !conversationId || replyMutation.isPending) return;
    replyMutation.mutate({ id: conversationId, message: msg });
  };

  const openConversation = (id: string) => {
    setSearchParams({ c: id });
  };

  const backToList = () => {
    setSearchParams({});
  };

  // ============ Conversation view ============
  if (conversationId) {
    const data = conversationQuery.data;
    return (
      <div className="page">
        <div className="container">
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

          {data && (
            <div className="coach-messages mt-3">
              {data.messages.map((m) => (
                <CoachMessageView key={m.id} message={m} />
              ))}

              {replyMutation.isPending && (
                <div className="coach-bubble coach-bubble-assistant coach-bubble-pending">
                  <span className="spinner" style={{ width: '16px', height: '16px' }} />
                  Thinking...
                </div>
              )}
              {replyMutation.isError && (
                <div className="coach-error">Couldn't send that — check your connection and try again.</div>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {data && latestSentence && (
            <QuickActions
              hanzi={latestSentence}
              decks={decks}
              selectedDeckId={selectedDeckId}
              onDeckChange={handleDeckChange}
              onSend={sendQuickAction}
              disabled={replyMutation.isPending}
            />
          )}

          {data && (
            <form onSubmit={handleFollowUp} className="coach-followup-form">
              <textarea
                className="form-textarea coach-followup-input"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                placeholder="Ask a follow-up… (grammar, usage, add words to a deck)"
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleFollowUp(e);
                  }
                }}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!followUp.trim() || replyMutation.isPending}
              >
                {replyMutation.isPending ? '…' : 'Send'}
              </button>
            </form>
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
        <h1 className="mb-2">Sentence Coach</h1>
        <p className="text-light mb-4">
          Type Chinese to get it checked and explained, or English to see how to say it in Chinese.
          Then keep chatting about it.
        </p>

        <div className="card">
          <form onSubmit={handleSubmit} className="sentence-input-form">
            <div className="form-group">
              <textarea
                className="form-textarea"
                value={sentence}
                onChange={(e) => setSentence(e.target.value)}
                placeholder="我昨天去了商店买苹果 — or — How do I say I'm running late?"
                required
                rows={3}
              />
              {inputIsChinese !== null && (
                <div className="coach-detect-hint">
                  {inputIsChinese
                    ? '🇨🇳 Chinese detected — I\'ll check it and explain it'
                    : '🇬🇧 English detected — I\'ll translate it and explain the translation'}
                </div>
              )}
            </div>

            {startMutation.error && (
              <div className="coach-error mb-3">
                Couldn't reach the coach. Check your connection and try again.
              </div>
            )}

            <div className="sentence-input-actions">
              <button
                type="submit"
                className="btn btn-primary flex-1"
                disabled={!trimmed || startMutation.isPending}
              >
                {startMutation.isPending ? (
                  <>
                    <span className="spinner" style={{ width: '20px', height: '20px' }} />
                    {inputIsChinese === false ? 'Translating...' : 'Analyzing...'}
                  </>
                ) : (
                  'Send'
                )}
              </button>
            </div>
          </form>
        </div>

        {startMutation.isPending && (
          <div className="card mt-4">
            <div className="sentence-loading">
              <div className="sentence-loading-spinner" />
              <p>
                {inputIsChinese === false
                  ? 'Translating your sentence...'
                  : 'Checking your sentence...'}
              </p>
            </div>
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
                    {conv.input_language === 'zh' ? '🇨🇳' : '🇬🇧'} {conv.title}
                  </div>
                  <div className="coach-conv-meta">
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
            <li>Chinese input → corrected with a short explanation; English input → translated, with alternatives</li>
            <li>Then one tap: make a card (to the card standard), more examples, other ways to say it, the grammar</li>
            <li>Or ask anything — the coach can also add cards and build a mini lesson</li>
            <li>Conversations are saved, so you can come back and continue</li>
            <li>Tip: select text anywhere on your phone and choose "Sentence Coach" (Android app)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default SentenceCoachPage;
