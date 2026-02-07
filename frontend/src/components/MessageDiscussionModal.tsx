import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { discussMessage, createNote, createDeck, getDecks } from '../api/client';
import { MessageWithSender, GeneratedNote } from '../types';
import { Loading } from './Loading';
import './MessageDiscussionModal.css';

interface DiscussionMessage {
  role: 'user' | 'assistant';
  content: string;
  flashcards?: GeneratedNote[] | null;
}

interface MessageDiscussionModalProps {
  message: MessageWithSender;
  onClose: () => void;
}

export function MessageDiscussionModal({ message, onClose }: MessageDiscussionModalProps) {
  const [input, setInput] = useState('');
  const [discussion, setDiscussion] = useState<DiscussionMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingFlashcards, setPendingFlashcards] = useState<GeneratedNote[] | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedCards, setSelectedCards] = useState<Set<number>>(new Set());
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [discussion.length, pendingFlashcards]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const quickActions = [
    { label: 'Explain this', question: 'Please explain what this message means, including the vocabulary and grammar used.' },
    { label: 'Break down vocab', question: 'Please break down each word/phrase in this message with pinyin and English translations.' },
    { label: 'Make flashcards', question: 'Please create flashcards for the key vocabulary and phrases in this message.' },
  ];

  const handleSend = async (questionText?: string) => {
    const question = (questionText || input).trim();
    if (!question || isLoading) return;

    if (!questionText) setInput('');
    setSavedMessage(null);

    const userMsg: DiscussionMessage = { role: 'user', content: question };
    const updatedDiscussion = [...discussion, userMsg];
    setDiscussion(updatedDiscussion);
    setPendingFlashcards(null);

    setIsLoading(true);
    try {
      // Build conversation history (prior messages, not the current question)
      const history = discussion.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      const result = await discussMessage(message.id, question, history.length > 0 ? history : undefined);

      const assistantMsg: DiscussionMessage = {
        role: 'assistant',
        content: result.response,
        flashcards: result.flashcards,
      };
      setDiscussion([...updatedDiscussion, assistantMsg]);

      if (result.flashcards && result.flashcards.length > 0) {
        setPendingFlashcards(result.flashcards);
        setSelectedCards(new Set(result.flashcards.map((_, i) => i)));
      }
    } catch (error) {
      console.error('Failed to discuss message:', error);
      const errorMsg: DiscussionMessage = {
        role: 'assistant',
        content: 'Sorry, I had trouble responding. Please try again.',
      };
      setDiscussion([...updatedDiscussion, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleCard = (index: number) => {
    setSelectedCards(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleSaveFlashcards = async (deckId: string) => {
    if (!pendingFlashcards || selectedCards.size === 0) return;
    setIsSaving(true);
    try {
      const cardsToSave = pendingFlashcards.filter((_, i) => selectedCards.has(i));
      for (const card of cardsToSave) {
        await createNote(deckId, {
          hanzi: card.hanzi,
          pinyin: card.pinyin,
          english: card.english,
          fun_facts: card.fun_facts,
          context: message.content,
        });
      }
      setSavedMessage(`${cardsToSave.length} flashcard${cardsToSave.length !== 1 ? 's' : ''} saved!`);
      setPendingFlashcards(null);
      setSelectedCards(new Set());
    } catch (error) {
      console.error('Failed to save flashcards:', error);
      setSavedMessage('Failed to save flashcards. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay claude-modal-overlay" onClick={onClose}>
      <div className="modal claude-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Discuss Message</div>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>

        {/* Original message banner */}
        <div className="discuss-original-msg">
          {message.content}
        </div>

        <div className="claude-modal-content" ref={contentRef}>
          {/* Quick actions when no conversation started */}
          {discussion.length === 0 && !isLoading && (
            <div className="claude-quick-actions">
              {quickActions.map((action) => (
                <button
                  key={action.label}
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleSend(action.question)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}

          {/* Conversation thread */}
          {discussion.map((msg, i) => (
            <div key={i} className="claude-message-pair">
              {msg.role === 'user' ? (
                <div className="claude-user-message">{msg.content}</div>
              ) : (
                <div className="claude-response">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="claude-loading">Thinking...</div>
          )}

          {/* Flashcard suggestions from tool call */}
          {pendingFlashcards && pendingFlashcards.length > 0 && (
            <div className="discuss-flashcards">
              <div className="discuss-flashcards-header">
                Select flashcards to save:
              </div>
              <div className="discuss-flashcards-list">
                {pendingFlashcards.map((card, index) => (
                  <div
                    key={index}
                    className={`response-option-card ${selectedCards.has(index) ? 'selected' : ''}`}
                    onClick={() => toggleCard(index)}
                  >
                    <div className="option-checkbox">
                      {selectedCards.has(index) ? '✓' : ''}
                    </div>
                    <div className="option-content">
                      <div className="option-hanzi">{card.hanzi}</div>
                      <div className="option-pinyin">{card.pinyin}</div>
                      <div className="option-english">{card.english}</div>
                      {card.fun_facts && (
                        <div className="option-funfacts">{card.fun_facts}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {selectedCards.size > 0 && (
                <DiscussionDeckSelector
                  onSelect={handleSaveFlashcards}
                  isSaving={isSaving}
                  selectedCount={selectedCards.size}
                />
              )}
            </div>
          )}

          {savedMessage && (
            <div className="discuss-saved-msg">{savedMessage}</div>
          )}
        </div>

        {/* Input */}
        <div className="claude-input-row">
          <input
            ref={inputRef}
            type="text"
            className="form-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this message..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSend();
            }}
            disabled={isLoading}
          />
          <button
            className="btn btn-primary"
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
          >
            Ask
          </button>
        </div>
      </div>
    </div>
  );
}

function DiscussionDeckSelector({
  onSelect,
  isSaving,
  selectedCount,
}: {
  onSelect: (deckId: string) => void;
  isSaving: boolean;
  selectedCount: number;
}) {
  const [showNewDeckInput, setShowNewDeckInput] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [isCreatingDeck, setIsCreatingDeck] = useState(false);

  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: () => getDecks(),
  });

  const handleCreateAndSelect = async () => {
    if (!newDeckName.trim()) return;
    setIsCreatingDeck(true);
    try {
      const newDeck = await createDeck(newDeckName.trim());
      decksQuery.refetch();
      onSelect(newDeck.id);
    } catch (error) {
      console.error('Failed to create deck:', error);
      setIsCreatingDeck(false);
    }
  };

  if (decksQuery.isLoading) {
    return <Loading message="Loading decks..." />;
  }

  const decks = decksQuery.data || [];

  return (
    <div className="deck-selector">
      <label>Save {selectedCount} card{selectedCount !== 1 ? 's' : ''} to:</label>
      <div className="deck-options">
        {decks.map((deck) => (
          <button
            key={deck.id}
            className="deck-option"
            onClick={() => onSelect(deck.id)}
            disabled={isSaving || isCreatingDeck}
          >
            {deck.name}
          </button>
        ))}
        {!showNewDeckInput ? (
          <button
            className="deck-option deck-option-new"
            onClick={() => setShowNewDeckInput(true)}
            disabled={isSaving || isCreatingDeck}
          >
            + New deck
          </button>
        ) : (
          <div className="new-deck-input-row">
            <input
              type="text"
              value={newDeckName}
              onChange={(e) => setNewDeckName(e.target.value)}
              placeholder="Deck name..."
              className="new-deck-input"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newDeckName.trim()) {
                  handleCreateAndSelect();
                } else if (e.key === 'Escape') {
                  setShowNewDeckInput(false);
                  setNewDeckName('');
                }
              }}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={handleCreateAndSelect}
              disabled={!newDeckName.trim() || isCreatingDeck}
            >
              {isCreatingDeck ? '...' : 'Create'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
