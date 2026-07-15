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
  createNote,
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
import './SentenceCoachPage.css';

const LAST_DECK_KEY = 'coach-last-deck-id';

const ISSUE_TYPE_LABELS: Record<string, string> = {
  grammar: 'Grammar',
  word_choice: 'Word choice',
  word_order: 'Word order',
  naturalness: 'Naturalness',
  typo: 'Typo',
};

// ============ Add-to-deck plumbing shared by the analysis blocks ============

interface AddToDeckControls {
  decks: Deck[] | undefined;
  selectedDeckId: string;
  onDeckChange: (deckId: string) => void;
  addedKeys: Set<string>;
  addingKey: string | null;
  addError: string | null;
  addToDeck: (key: string, note: { hanzi: string; pinyin: string; english: string; fun_facts?: string }) => void;
}

function AddButton({ controls, itemKey, note }: {
  controls: AddToDeckControls;
  itemKey: string;
  note: { hanzi: string; pinyin: string; english: string; fun_facts?: string };
}) {
  const { decks, addedKeys, addingKey, addToDeck, selectedDeckId } = controls;
  if (!decks || decks.length === 0) return null;
  const added = addedKeys.has(itemKey);
  return (
    <button
      type="button"
      className={`btn ${added ? 'btn-secondary' : 'btn-primary'}`}
      onClick={() => addToDeck(itemKey, note)}
      disabled={added || addingKey !== null || !selectedDeckId}
    >
      {added ? 'Added ✓' : addingKey === itemKey ? 'Adding...' : '+ Add'}
    </button>
  );
}

function DeckPicker({ controls }: { controls: AddToDeckControls }) {
  const { decks, selectedDeckId, onDeckChange, addError } = controls;
  if (!decks || decks.length === 0) return null;
  return (
    <>
      <select
        className="coach-deck-select"
        style={{ marginTop: '0.75rem', marginBottom: 0 }}
        value={selectedDeckId}
        onChange={(e) => onDeckChange(e.target.value)}
      >
        {decks.map((deck) => (
          <option key={deck.id} value={deck.id}>
            Add to: {deck.name}
          </option>
        ))}
      </select>
      {addError && <div className="coach-error mt-3">{addError}</div>}
    </>
  );
}

// ============ Structured analysis blocks ============

function CoachResultBlock({ result, keyPrefix, controls }: {
  result: SentenceCoachResult;
  keyPrefix: string;
  controls: AddToDeckControls;
}) {
  return (
    <>
      <div className="card">
        <span className={`coach-badge ${result.isCorrect ? 'coach-badge-correct' : 'coach-badge-needs-work'}`}>
          {result.isCorrect ? '✓ Looks good!' : 'Needs a little work'}
        </span>
        <div className="coach-corrected-hanzi">{result.corrected.hanzi}</div>
        <div className="coach-corrected-pinyin">{result.corrected.pinyin}</div>
        <div className="coach-corrected-english">{result.corrected.english}</div>
        <div style={{ marginTop: '0.5rem' }}>
          <AddButton
            controls={controls}
            itemKey={`${keyPrefix}-sentence`}
            note={{
              hanzi: result.corrected.hanzi,
              pinyin: result.corrected.pinyin,
              english: result.corrected.english,
              fun_facts: result.critique || undefined,
            }}
          />
        </div>
      </div>

      {result.critique && (
        <div className="card mt-3">
          <h3 className="mb-2">Feedback</h3>
          <p>{result.critique}</p>
        </div>
      )}

      {result.issues.length > 0 && (
        <div className="card mt-3">
          <h3 className="mb-2">What to fix</h3>
          {result.issues.map((issue, i) => (
            <div key={i} className="coach-issue">
              <span className="coach-issue-type">{ISSUE_TYPE_LABELS[issue.type] ?? issue.type}</span>
              <div className="coach-issue-change">
                <span className="coach-issue-original">{issue.original}</span>
                {' → '}
                <span className="coach-issue-suggestion">{issue.suggestion}</span>
              </div>
              <div className="coach-issue-explanation">{issue.explanation}</div>
            </div>
          ))}
        </div>
      )}

      {result.alternatives.length > 0 && (
        <div className="card mt-3">
          <h3 className="mb-2">Other ways to say it</h3>
          {result.alternatives.map((alt, i) => (
            <div key={i} className="coach-alternative">
              <div className="coach-vocab-hanzi">{alt.hanzi}</div>
              <div className="coach-vocab-detail">{alt.pinyin} — {alt.english}</div>
              {alt.note && <div className="coach-vocab-reason">{alt.note}</div>}
            </div>
          ))}
        </div>
      )}

      {result.vocabSuggestions.length > 0 && (
        <div className="card mt-3">
          <h3 className="mb-2">Vocabulary from this sentence</h3>
          {result.vocabSuggestions.map((vocab, i) => (
            <div key={i} className="coach-vocab-item">
              <div style={{ minWidth: 0 }}>
                <div className="coach-vocab-hanzi">{vocab.hanzi}</div>
                <div className="coach-vocab-detail">{vocab.pinyin} — {vocab.english}</div>
                {vocab.reason && <div className="coach-vocab-reason">{vocab.reason}</div>}
              </div>
              <AddButton
                controls={controls}
                itemKey={`${keyPrefix}-vocab-${i}`}
                note={{ hanzi: vocab.hanzi, pinyin: vocab.pinyin, english: vocab.english, fun_facts: vocab.reason || undefined }}
              />
            </div>
          ))}
          <DeckPicker controls={controls} />
        </div>
      )}
    </>
  );
}

function ExplanationBlock({ explanation, keyPrefix, controls, showHeader = true }: {
  explanation: SentenceExplanation;
  keyPrefix: string;
  controls: AddToDeckControls;
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
              <AddButton
                controls={controls}
                itemKey={`${keyPrefix}-word-${i}`}
                note={{ hanzi: word.hanzi, pinyin: word.pinyin, english: word.english, fun_facts: word.notes || undefined }}
              />
            </div>
          ))}
          <DeckPicker controls={controls} />
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

function TranslationBlock({ translation, keyPrefix, controls }: {
  translation: SentenceTranslation;
  keyPrefix: string;
  controls: AddToDeckControls;
}) {
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
        <div style={{ marginTop: '0.5rem' }}>
          <AddButton
            controls={controls}
            itemKey={`${keyPrefix}-primary`}
            note={{
              hanzi: translation.primary.hanzi,
              pinyin: translation.primary.pinyin,
              english: translation.primary.english,
              fun_facts: translation.primary.note || undefined,
            }}
          />
        </div>
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
              <AddButton
                controls={controls}
                itemKey={`${keyPrefix}-alt-${i}`}
                note={{ hanzi: alt.hanzi, pinyin: alt.pinyin, english: alt.english, fun_facts: alt.note || undefined }}
              />
            </div>
          ))}
        </div>
      )}

      {translation.words.length > 0 && (
        <div className="card mt-3">
          <h3 className="mb-2">Word by word</h3>
          {translation.words.map((word, i) => (
            <div key={i} className="coach-vocab-item">
              <div style={{ minWidth: 0 }}>
                <div className="coach-vocab-hanzi">
                  {word.hanzi}
                  {word.role && <span className="coach-word-role">{word.role}</span>}
                </div>
                <div className="coach-vocab-detail">{word.pinyin} — {word.english}</div>
                {word.notes && <div className="coach-vocab-reason">{word.notes}</div>}
              </div>
              <AddButton
                controls={controls}
                itemKey={`${keyPrefix}-word-${i}`}
                note={{ hanzi: word.hanzi, pinyin: word.pinyin, english: word.english, fun_facts: word.notes || undefined }}
              />
            </div>
          ))}
          <DeckPicker controls={controls} />
        </div>
      )}

      {translation.grammar_points.length > 0 && (
        <div className="card mt-3">
          <h3 className="mb-2">Grammar</h3>
          {translation.grammar_points.map((point, i) => (
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

      {translation.usage_note && (
        <div className="card mt-3">
          <h3 className="mb-2">Usage</h3>
          <p>{translation.usage_note}</p>
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
        return (
          <div key={i} className={`coach-tool-chip ${r.success ? 'coach-tool-chip-success' : 'coach-tool-chip-error'}`}>
            {r.success ? `✓ ${r.tool}` : `✗ ${r.tool}: ${r.error ?? 'failed'}`}
          </div>
        );
      })}
    </div>
  );
}

function CoachMessageView({ message, controls }: { message: CoachMessage; controls: AddToDeckControls }) {
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
          <CoachResultBlock result={analysis.coach} keyPrefix={message.id} controls={controls} />
          <ExplanationBlock explanation={analysis.explanation} keyPrefix={`${message.id}-ex`} controls={controls} showHeader={false} />
        </div>
      );
    }
    return (
      <div className="coach-analysis">
        <TranslationBlock translation={analysis.translation} keyPrefix={message.id} controls={controls} />
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
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
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

  const addToDeck = async (
    key: string,
    note: { hanzi: string; pinyin: string; english: string; fun_facts?: string }
  ) => {
    if (!selectedDeckId) return;
    setAddingKey(key);
    setAddError(null);
    try {
      await createNote(selectedDeckId, note);
      setAddedKeys((prev) => new Set(prev).add(key));
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add to deck');
    } finally {
      setAddingKey(null);
    }
  };

  const controls: AddToDeckControls = {
    decks,
    selectedDeckId,
    onDeckChange: handleDeckChange,
    addedKeys,
    addingKey,
    addError,
    addToDeck,
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
                <CoachMessageView key={m.id} message={m} controls={controls} />
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
                  ? 'Translating and explaining...'
                  : 'Correcting, critiquing, and explaining your sentence...'}
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
            <li>Chinese input → corrected, critiqued, and explained word by word</li>
            <li>English input → translated with alternatives, then explained</li>
            <li>Ask follow-up questions — the coach can also add cards to your decks</li>
            <li>Conversations are saved, so you can come back and continue</li>
            <li>Tip: select text anywhere on your phone and choose "Sentence Coach" (Android app)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default SentenceCoachPage;
