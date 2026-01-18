import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  getRelationship,
  getMessages,
  sendMessage,
  generateFlashcardFromChat,
  createNote,
} from '../api/client';
import {
  MessageWithSender,
  getOtherUserInRelationship,
} from '../types';
import { Loading, ErrorMessage } from '../components/Loading';
import { useAuth } from '../contexts/AuthContext';
import './ChatPage.css';

const POLL_INTERVAL = 3000; // 3 seconds

export function ChatPage() {
  const { relId, convId } = useParams<{ relId: string; convId: string }>();
  const { user } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<MessageWithSender[]>([]);
  const [lastTimestamp, setLastTimestamp] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCard, setGeneratedCard] = useState<{
    hanzi: string;
    pinyin: string;
    english: string;
    fun_facts?: string;
  } | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const relationshipQuery = useQuery({
    queryKey: ['relationship', relId],
    queryFn: () => getRelationship(relId!),
    enabled: !!relId,
  });

  // Initial messages load
  const initialMessagesQuery = useQuery({
    queryKey: ['messages', convId, 'initial'],
    queryFn: async () => {
      const result = await getMessages(convId!);
      setMessages(result.messages);
      setLastTimestamp(result.latest_timestamp);
      return result;
    },
    enabled: !!convId,
  });

  // Polling for new messages
  const pollMessages = useCallback(async () => {
    if (!convId || !lastTimestamp) return;
    try {
      const result = await getMessages(convId, lastTimestamp);
      if (result.messages.length > 0) {
        setMessages(prev => [...prev, ...result.messages]);
        setLastTimestamp(result.latest_timestamp);
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }, [convId, lastTimestamp]);

  useEffect(() => {
    if (!convId || !lastTimestamp) return;
    const interval = setInterval(pollMessages, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [convId, lastTimestamp, pollMessages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMutation = useMutation({
    mutationFn: (content: string) => sendMessage(convId!, content),
    onSuccess: (newMsg) => {
      setMessages(prev => [...prev, newMsg]);
      setLastTimestamp(newMsg.created_at);
      setNewMessage('');
    },
  });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || sendMutation.isPending) return;
    sendMutation.mutate(newMessage.trim());
  };

  const handleGenerateFlashcard = async () => {
    if (!convId) return;
    setIsGenerating(true);
    setGeneratedCard(null);
    try {
      const result = await generateFlashcardFromChat(convId);
      setGeneratedCard(result.flashcard);
      setShowSaveModal(true);
    } catch (error) {
      console.error('Failed to generate flashcard:', error);
      alert('Failed to generate flashcard. Make sure the conversation has Chinese vocabulary discussed.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveFlashcard = async (deckId: string) => {
    if (!generatedCard) return;
    setIsSaving(true);
    try {
      await createNote(deckId, {
        hanzi: generatedCard.hanzi,
        pinyin: generatedCard.pinyin,
        english: generatedCard.english,
        fun_facts: generatedCard.fun_facts,
      });
      setShowSaveModal(false);
      setGeneratedCard(null);
      alert('Flashcard saved!');
    } catch (error) {
      console.error('Failed to save flashcard:', error);
      alert('Failed to save flashcard');
    } finally {
      setIsSaving(false);
    }
  };

  if (initialMessagesQuery.isLoading || relationshipQuery.isLoading) {
    return <Loading />;
  }

  if (initialMessagesQuery.error || relationshipQuery.error) {
    return <ErrorMessage message="Failed to load chat" />;
  }

  const relationship = relationshipQuery.data!;
  const otherUser = getOtherUserInRelationship(relationship, user!.id);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };

  // Group messages by date
  const messagesByDate: { date: string; messages: MessageWithSender[] }[] = [];
  let currentDate = '';
  for (const msg of messages) {
    const msgDate = new Date(msg.created_at).toDateString();
    if (msgDate !== currentDate) {
      currentDate = msgDate;
      messagesByDate.push({ date: msg.created_at, messages: [msg] });
    } else {
      messagesByDate[messagesByDate.length - 1].messages.push(msg);
    }
  }

  return (
    <div className="chat-page">
      {/* Header */}
      <div className="chat-header">
        <Link to={`/connections/${relId}`} className="chat-back">←</Link>
        <div className="chat-header-user">
          {otherUser.picture_url ? (
            <img src={otherUser.picture_url} alt="" className="chat-avatar" />
          ) : (
            <div className="chat-avatar placeholder">
              {(otherUser.name || otherUser.email || '?')[0].toUpperCase()}
            </div>
          )}
          <span className="chat-header-name">{otherUser.name || 'Unknown'}</span>
        </div>
        <button
          className="btn btn-sm btn-secondary"
          onClick={handleGenerateFlashcard}
          disabled={isGenerating || messages.length === 0}
        >
          {isGenerating ? '...' : '+ Card'}
        </button>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>Start the conversation!</p>
          </div>
        ) : (
          messagesByDate.map((group, i) => (
            <div key={i}>
              <div className="chat-date-divider">
                <span>{formatDate(group.date)}</span>
              </div>
              {group.messages.map((msg) => {
                const isMe = msg.sender_id === user!.id;
                return (
                  <div key={msg.id} className={`chat-message ${isMe ? 'sent' : 'received'}`}>
                    {!isMe && (
                      <div className="chat-message-avatar">
                        {msg.sender.picture_url ? (
                          <img src={msg.sender.picture_url} alt="" />
                        ) : (
                          <div className="placeholder">
                            {(msg.sender.name || '?')[0].toUpperCase()}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="chat-message-content">
                      <div className="chat-bubble">{msg.content}</div>
                      <span className="chat-time">{formatTime(msg.created_at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form className="chat-input-form" onSubmit={handleSend}>
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type a message..."
          className="chat-input"
        />
        <button
          type="submit"
          className="btn btn-primary chat-send"
          disabled={!newMessage.trim() || sendMutation.isPending}
        >
          Send
        </button>
      </form>

      {/* Save Flashcard Modal */}
      {showSaveModal && generatedCard && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Generated Flashcard</h3>
            <div className="generated-card-preview">
              <div className="preview-hanzi">{generatedCard.hanzi}</div>
              <div className="preview-pinyin">{generatedCard.pinyin}</div>
              <div className="preview-english">{generatedCard.english}</div>
              {generatedCard.fun_facts && (
                <div className="preview-funfacts">{generatedCard.fun_facts}</div>
              )}
            </div>
            <DeckSelector
              onSelect={(deckId) => handleSaveFlashcard(deckId)}
              isSaving={isSaving}
            />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowSaveModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Deck selector component
function DeckSelector({
  onSelect,
  isSaving,
}: {
  onSelect: (deckId: string) => void;
  isSaving: boolean;
}) {
  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: () => import('../api/client').then(m => m.getDecks()),
  });

  if (decksQuery.isLoading) {
    return <Loading message="Loading decks..." />;
  }

  const decks = decksQuery.data || [];

  if (decks.length === 0) {
    return (
      <p className="text-light">No decks available. Create a deck first.</p>
    );
  }

  return (
    <div className="deck-selector">
      <label>Save to deck:</label>
      <div className="deck-options">
        {decks.map((deck) => (
          <button
            key={deck.id}
            className="deck-option"
            onClick={() => onSelect(deck.id)}
            disabled={isSaving}
          >
            {deck.name}
          </button>
        ))}
      </div>
    </div>
  );
}
