import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getRelationship,
  getMessages,
  sendMessage,
  generateFlashcardFromChat,
  generateResponseOptions,
  createNote,
  createDeck,
  getDecks,
  getAIResponse,
  generateConversationTTS,
  checkMessage,
  translateMessageFlashcard,
  updateConversationVoiceSettings,
  getConversations,
  markNotificationsReadByConversation,
  toggleMessageReaction,
} from '../api/client';
import type { TranslateFlashcardResponse } from '../api/client';
import {
  MessageWithSender,
  getOtherUserInRelationship,
  isClaudeUser,
  MINIMAX_VOICES,
  GeneratedNoteWithContext,
  CheckMessageResponse,
} from '../types';
import { Loading, ErrorMessage } from '../components/Loading';
import { MessageDiscussionModal } from '../components/MessageDiscussionModal';
import { useAuth } from '../contexts/AuthContext';
import { useNetwork } from '../contexts/NetworkContext';
import { OfflineWarning } from '../components/OfflineWarning';
import './ChatPage.css';

const POLL_INTERVAL = 3000; // 3 seconds

export function ChatPage() {
  const { relId, convId } = useParams<{ relId: string; convId: string }>();
  const { user } = useAuth();
  const { isOnline } = useNetwork();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const [newMessages, setNewMessages] = useState<MessageWithSender[]>([]);
  const [lastTimestamp, setLastTimestamp] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCard, setGeneratedCard] = useState<{
    hanzi: string;
    pinyin: string;
    english: string;
    fun_facts?: string;
    context?: string;
  } | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Response options (I don't know) state
  const [isGeneratingOptions, setIsGeneratingOptions] = useState(false);
  const [responseOptions, setResponseOptions] = useState<GeneratedNoteWithContext[] | null>(null);
  const [responseExplanation, setResponseExplanation] = useState<string | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<Set<number>>(new Set());
  const [showResponseOptionsModal, setShowResponseOptionsModal] = useState(false);
  const [isSavingOptions, setIsSavingOptions] = useState(false);

  // "I don't know" input dialog state
  const [showIdkDialog, setShowIdkDialog] = useState(false);
  const [idkIntendedMeaning, setIdkIntendedMeaning] = useState('');
  const [idkGuess, setIdkGuess] = useState('');

  // AI conversation state
  const [isWaitingForAI, setIsWaitingForAI] = useState(false);
  const [playingAudioMessageId, setPlayingAudioMessageId] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  // Message checking state
  const [checkingMessageId, setCheckingMessageId] = useState<string | null>(null);
  const [checkResults, setCheckResults] = useState<Map<string, CheckMessageResponse>>(new Map());
  const [showCheckResultModal, setShowCheckResultModal] = useState(false);
  const [currentCheckResult, setCurrentCheckResult] = useState<{
    messageId: string;
    result: CheckMessageResponse;
  } | null>(null);

  // Message discussion state
  const [discussingMessage, setDiscussingMessage] = useState<MessageWithSender | null>(null);

  // Translate + flashcard state
  const [translatingMessageId, setTranslatingMessageId] = useState<string | null>(null);
  const [translateResult, setTranslateResult] = useState<TranslateFlashcardResponse | null>(null);
  const [showTranslateModal, setShowTranslateModal] = useState(false);
  const [isSavingTranslateCard, setIsSavingTranslateCard] = useState(false);

  // Voice settings state
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);

  // Reply state
  const [replyingTo, setReplyingTo] = useState<MessageWithSender | null>(null);

  // Reaction picker state
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);

  // Reset state when conversation changes
  useEffect(() => {
    setNewMessages([]);
    setLastTimestamp(null);
    setCheckResults(new Map());
    // Stop any playing audio
    if (audioElement) {
      audioElement.pause();
      setAudioElement(null);
      setPlayingAudioMessageId(null);
    }
  }, [convId]);

  // Auto-clear chat notifications when opening the conversation
  useEffect(() => {
    if (convId) {
      markNotificationsReadByConversation(convId).catch(() => {});
    }
  }, [convId]);

  const relationshipQuery = useQuery({
    queryKey: ['relationship', relId],
    queryFn: () => getRelationship(relId!),
    enabled: !!relId,
  });

  // Get conversation details
  const conversationsQuery = useQuery({
    queryKey: ['conversations', relId],
    queryFn: () => getConversations(relId!),
    enabled: !!relId,
  });

  const conversation = conversationsQuery.data?.find(c => c.id === convId);
  const isAIConversation = conversation?.is_ai_conversation ?? false;

  // Initial messages load
  const initialMessagesQuery = useQuery({
    queryKey: ['messages', convId],
    queryFn: () => getMessages(convId!),
    enabled: !!convId,
    staleTime: 0, // Always refetch when navigating back
  });

  // Set lastTimestamp when initial messages load
  useEffect(() => {
    if (initialMessagesQuery.data) {
      setLastTimestamp(initialMessagesQuery.data.latest_timestamp);
    }
  }, [initialMessagesQuery.data]);

  // Polling for new messages
  const pollMessages = useCallback(async () => {
    if (!convId || !lastTimestamp) return;
    try {
      const result = await getMessages(convId, lastTimestamp);
      if (result.messages.length > 0) {
        // Deduplicate: only add messages not already in state
        // This prevents duplicates when polls race with sendMutation
        setNewMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const uniqueNew = result.messages.filter(m => !existingIds.has(m.id));
          if (uniqueNew.length === 0) return prev; // No change, avoid re-render
          return [...prev, ...uniqueNew];
        });
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

  // Combine initial messages with new messages from polling, deduplicated by ID
  // Deduplication is necessary because:
  // 1. In-flight polls may return messages that were just sent (race condition)
  // 2. For AI conversations, polling may fetch AI response before getAIResponse returns
  // 3. initialMessagesQuery refetches (staleTime: 0) may overlap with newMessages
  const allMessages = [
    ...(initialMessagesQuery.data?.messages || []),
    ...newMessages,
  ];
  const seenIds = new Set<string>();
  const messages = allMessages.filter(msg => {
    if (seenIds.has(msg.id)) return false;
    seenIds.add(msg.id);
    return true;
  });

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: ({ content, replyToId }: { content: string; replyToId?: string }) =>
      sendMessage(convId!, content, replyToId),
    onSuccess: async (newMsg) => {
      // Add user's message, deduplicating in case poll already added it
      setNewMessages(prev => {
        if (prev.some(m => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
      setLastTimestamp(newMsg.created_at);
      setNewMessage('');
      setReplyingTo(null);

      // If AI conversation, auto-trigger AI response
      if (isAIConversation) {
        setIsWaitingForAI(true);
        try {
          const response = await getAIResponse(convId!);
          // Add AI's message, deduplicating in case poll already added it
          setNewMessages(prev => {
            if (prev.some(m => m.id === response.message.id)) return prev;
            return [...prev, response.message];
          });
          setLastTimestamp(response.message.created_at);

          // Play audio if available
          if (response.audio_base64 && response.audio_content_type) {
            playBase64Audio(response.audio_base64, response.audio_content_type, response.message.id);
          }
        } catch (error) {
          console.error('Failed to get AI response:', error);
        } finally {
          setIsWaitingForAI(false);
        }
      }
    },
  });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || sendMutation.isPending || isWaitingForAI) return;
    sendMutation.mutate({ content: newMessage.trim(), replyToId: replyingTo?.id });
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    setShowReactionPicker(null);
    try {
      await toggleMessageReaction(messageId, emoji);
      // Refetch messages to get updated reactions
      queryClient.invalidateQueries({ queryKey: ['messages', convId] });
    } catch (error) {
      console.error('Failed to toggle reaction:', error);
    }
  };

  const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '👏', '🔥'];

  // Audio playback functions
  const playBase64Audio = (base64: string, contentType: string, messageId: string) => {
    // Stop any currently playing audio
    if (audioElement) {
      audioElement.pause();
    }

    const audio = new Audio(`data:${contentType};base64,${base64}`);
    setAudioElement(audio);
    setPlayingAudioMessageId(messageId);

    audio.onended = () => {
      setPlayingAudioMessageId(null);
      setAudioElement(null);
    };

    audio.onerror = () => {
      setPlayingAudioMessageId(null);
      setAudioElement(null);
    };

    audio.play();
  };

  const handlePlayMessageAudio = async (msg: MessageWithSender) => {
    if (playingAudioMessageId === msg.id) {
      // Stop playing
      if (audioElement) {
        audioElement.pause();
        setAudioElement(null);
        setPlayingAudioMessageId(null);
      }
      return;
    }

    setPlayingAudioMessageId(msg.id);
    try {
      const result = await generateConversationTTS(
        convId!,
        msg.content,
        conversation?.voice_id || undefined,
        conversation?.voice_speed || undefined
      );
      playBase64Audio(result.audio_base64, result.content_type, msg.id);
    } catch (error) {
      console.error('Failed to generate TTS:', error);
      setPlayingAudioMessageId(null);
    }
  };

  // Message checking
  const handleCheckMessage = async (msg: MessageWithSender) => {
    if (checkingMessageId) return;

    setCheckingMessageId(msg.id);
    try {
      const result = await checkMessage(msg.id);
      setCheckResults(prev => new Map(prev).set(msg.id, result));

      if (result.status === 'needs_improvement' && result.corrections) {
        setCurrentCheckResult({ messageId: msg.id, result });
        setShowCheckResultModal(true);
      }
    } catch (error) {
      console.error('Failed to check message:', error);
    } finally {
      setCheckingMessageId(null);
    }
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
        context: generatedCard.context,
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

  // "I don't know" - open input dialog
  const handleIDontKnow = () => {
    setIdkIntendedMeaning('');
    setIdkGuess('');
    setShowIdkDialog(true);
  };

  // Submit the "I don't know" dialog and generate response options
  const handleIdkSubmit = async () => {
    if (!convId || !idkIntendedMeaning.trim()) return;
    setShowIdkDialog(false);
    setIsGeneratingOptions(true);
    setResponseOptions(null);
    setResponseExplanation(null);
    setSelectedOptions(new Set());
    try {
      const result = await generateResponseOptions(convId, {
        intendedMeaning: idkIntendedMeaning.trim(),
        guess: idkGuess.trim() || undefined,
      });
      setResponseOptions(result.options);
      setResponseExplanation(result.explanation || null);
      // Select all options by default
      setSelectedOptions(new Set(result.options.map((_, i) => i)));
      setShowResponseOptionsModal(true);
    } catch (error) {
      console.error('Failed to generate response options:', error);
      alert('Failed to generate response options. Make sure the conversation has messages.');
    } finally {
      setIsGeneratingOptions(false);
    }
  };

  const toggleOptionSelection = (index: number) => {
    setSelectedOptions(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleSaveResponseOptions = async (deckId: string) => {
    if (!responseOptions || selectedOptions.size === 0) return;
    setIsSavingOptions(true);
    try {
      const selectedCards = responseOptions.filter((_, i) => selectedOptions.has(i));
      for (const card of selectedCards) {
        await createNote(deckId, {
          hanzi: card.hanzi,
          pinyin: card.pinyin,
          english: card.english,
          fun_facts: card.fun_facts,
          context: card.context,
        });
      }
      setShowResponseOptionsModal(false);
      setResponseOptions(null);
      setSelectedOptions(new Set());
      alert(`${selectedCards.length} flashcard(s) saved!`);
    } catch (error) {
      console.error('Failed to save flashcards:', error);
      alert('Failed to save flashcards');
    } finally {
      setIsSavingOptions(false);
    }
  };

  // Save check result corrections as flashcards
  const handleSaveCorrections = async (deckId: string) => {
    if (!currentCheckResult?.result.corrections) return;
    setIsSaving(true);
    try {
      for (const correction of currentCheckResult.result.corrections) {
        await createNote(deckId, {
          hanzi: correction.hanzi,
          pinyin: correction.pinyin,
          english: correction.english,
          fun_facts: correction.fun_facts,
        });
      }
      setShowCheckResultModal(false);
      setCurrentCheckResult(null);
      alert(`${currentCheckResult.result.corrections.length} correction(s) saved as flashcards!`);
    } catch (error) {
      console.error('Failed to save corrections:', error);
      alert('Failed to save corrections');
    } finally {
      setIsSaving(false);
    }
  };

  // Translate message and generate flashcard
  const handleTranslateFlashcard = async (msg: MessageWithSender) => {
    if (translatingMessageId) return;
    setTranslatingMessageId(msg.id);
    try {
      const result = await translateMessageFlashcard(msg.id);
      setTranslateResult(result);
      setShowTranslateModal(true);
    } catch (error) {
      console.error('Failed to translate message:', error);
      alert('Failed to translate message');
    } finally {
      setTranslatingMessageId(null);
    }
  };

  const handleSaveTranslateCard = async (deckId: string) => {
    if (!translateResult) return;
    setIsSavingTranslateCard(true);
    try {
      await createNote(deckId, {
        hanzi: translateResult.flashcard.hanzi,
        pinyin: translateResult.flashcard.pinyin,
        english: translateResult.flashcard.english,
        fun_facts: translateResult.flashcard.fun_facts,
        context: translateResult.flashcard.context,
      });
      setShowTranslateModal(false);
      setTranslateResult(null);
      alert('Flashcard saved!');
    } catch (error) {
      console.error('Failed to save flashcard:', error);
      alert('Failed to save flashcard');
    } finally {
      setIsSavingTranslateCard(false);
    }
  };

  // Voice settings handlers
  const handleVoiceChange = async (voiceId: string) => {
    if (!convId) return;
    try {
      await updateConversationVoiceSettings(convId, voiceId, undefined);
      queryClient.invalidateQueries({ queryKey: ['conversations', relId] });
    } catch (error) {
      console.error('Failed to update voice:', error);
    }
  };

  const handleSpeedChange = async (speed: number) => {
    if (!convId) return;
    try {
      await updateConversationVoiceSettings(convId, undefined, speed);
      queryClient.invalidateQueries({ queryKey: ['conversations', relId] });
    } catch (error) {
      console.error('Failed to update speed:', error);
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

  // Check if message content looks like Chinese
  const looksLikeChinese = (text: string) => {
    return /[\u4e00-\u9fff]/.test(text);
  };

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
          <span className="chat-header-name">
            {otherUser.name || 'Unknown'}
            {isAIConversation && <span className="ai-badge">AI</span>}
          </span>
        </div>
        <div className="chat-header-actions">
          {isAIConversation && (
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => setShowVoiceSettings(true)}
              title="Voice settings"
            >
              🔊
            </button>
          )}
          <button
            className="btn btn-sm btn-secondary"
            onClick={handleGenerateFlashcard}
            disabled={isGenerating || messages.length === 0}
          >
            {isGenerating ? '...' : '+ Card'}
          </button>
        </div>
      </div>

      {/* Scenario info for AI conversations */}
      {isAIConversation && conversation?.scenario && (
        <div className="chat-scenario-banner">
          <strong>Scenario:</strong> {conversation.scenario}
          {conversation.user_role && <span> | You: {conversation.user_role}</span>}
          {conversation.ai_role && <span> | AI: {conversation.ai_role}</span>}
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>{isAIConversation ? 'Start practicing Chinese!' : 'Start the conversation!'}</p>
          </div>
        ) : (
          messagesByDate.map((group, i) => (
            <div key={i} className="chat-date-group">
              <div className="chat-date-divider">
                <span>{formatDate(group.date)}</span>
              </div>
              {group.messages.map((msg) => {
                const isMe = msg.sender_id === user!.id;
                const isAI = isClaudeUser(msg.sender_id);
                const checkResult = checkResults.get(msg.id);
                const isPlaying = playingAudioMessageId === msg.id;
                const isChecking = checkingMessageId === msg.id;
                const hasChineseContent = looksLikeChinese(msg.content);

                return (
                  <div key={msg.id} className={`chat-message ${isMe ? 'sent' : 'received'}`}>
                    {!isMe && (
                      <div className="chat-message-avatar">
                        {msg.sender.picture_url ? (
                          <img src={msg.sender.picture_url} alt="" />
                        ) : (
                          <div className="placeholder">
                            {isAI ? '🤖' : (msg.sender.name || '?')[0].toUpperCase()}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="chat-message-content">
                      {/* Reply preview */}
                      {msg.reply_to && (
                        <div className="reply-preview">
                          <span className="reply-preview-name">{msg.reply_to.sender.name || 'Unknown'}</span>
                          <span className="reply-preview-text">{msg.reply_to.content.length > 60 ? msg.reply_to.content.slice(0, 60) + '...' : msg.reply_to.content}</span>
                        </div>
                      )}
                      <div className="chat-bubble">
                        {msg.content}
                        {/* Check status indicator */}
                        {isMe && checkResult && (
                          <span className={`check-status ${checkResult.status}`}>
                            {checkResult.status === 'correct' ? '✓' : '⚠'}
                          </span>
                        )}
                      </div>
                      {/* Reactions display */}
                      {msg.reactions && msg.reactions.length > 0 && (
                        <div className="message-reactions">
                          {msg.reactions.map((r) => (
                            <button
                              key={r.emoji}
                              className={`reaction-badge ${r.users.some(u => u.id === user!.id) ? 'mine' : ''}`}
                              onClick={() => handleReaction(msg.id, r.emoji)}
                              title={r.users.map(u => u.name || 'Unknown').join(', ')}
                            >
                              {r.emoji} {r.count > 1 ? r.count : ''}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="chat-message-meta">
                        <span className="chat-time">{formatTime(msg.created_at)}</span>
                        {/* Message actions */}
                        <div className="chat-message-actions">
                          {/* Reply button */}
                          <button
                            className="msg-action-btn"
                            onClick={() => setReplyingTo(msg)}
                            title="Reply"
                          >
                            ↩
                          </button>
                          {/* Reaction button */}
                          <button
                            className="msg-action-btn"
                            onClick={() => setShowReactionPicker(showReactionPicker === msg.id ? null : msg.id)}
                            title="React"
                          >
                            +😊
                          </button>
                          {/* Play audio button (for Chinese content) */}
                          {hasChineseContent && (
                            <button
                              className={`msg-action-btn ${isPlaying ? 'playing' : ''}`}
                              onClick={() => handlePlayMessageAudio(msg)}
                              title="Play audio"
                            >
                              {isPlaying ? '⏹' : '🔊'}
                            </button>
                          )}
                          {/* Check button (for user's own messages) */}
                          {isMe && hasChineseContent && !checkResult && (
                            <button
                              className="msg-action-btn"
                              onClick={() => handleCheckMessage(msg)}
                              disabled={isChecking}
                              title="Check my Chinese"
                            >
                              {isChecking ? '...' : '✓?'}
                            </button>
                          )}
                          {/* View check result (if has corrections) */}
                          {isMe && checkResult?.status === 'needs_improvement' && (
                            <button
                              className="msg-action-btn"
                              onClick={() => {
                                setCurrentCheckResult({ messageId: msg.id, result: checkResult });
                                setShowCheckResultModal(true);
                              }}
                              title="View corrections"
                            >
                              📝
                            </button>
                          )}
                          {/* Recording indicator */}
                          {msg.recording_url && (
                            <span className="has-recording" title="Has recording">🎤</span>
                          )}
                          {/* Translate + Flashcard button (for other person's Chinese messages) */}
                          {!isMe && hasChineseContent && (
                            <button
                              className="msg-action-btn"
                              onClick={() => handleTranslateFlashcard(msg)}
                              disabled={translatingMessageId === msg.id}
                              title="Translate &amp; make flashcard"
                            >
                              {translatingMessageId === msg.id ? '...' : '🔤'}
                            </button>
                          )}
                          {/* Discuss with Claude button */}
                          <button
                            className={`msg-action-btn ${msg.has_discussion ? 'has-discussion' : ''}`}
                            onClick={() => setDiscussingMessage(msg)}
                            title={msg.has_discussion ? 'Continue discussion' : 'Discuss with Claude'}
                          >
                            💬
                          </button>
                        </div>
                        {/* Quick emoji picker */}
                        {showReactionPicker === msg.id && (
                          <div className="reaction-picker">
                            {QUICK_EMOJIS.map((emoji) => (
                              <button
                                key={emoji}
                                className="reaction-picker-btn"
                                onClick={() => handleReaction(msg.id, emoji)}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        {isWaitingForAI && (
          <div className="chat-message received">
            <div className="chat-message-avatar">
              <div className="placeholder">🤖</div>
            </div>
            <div className="chat-message-content">
              <div className="chat-bubble typing">
                <span className="dot"></span>
                <span className="dot"></span>
                <span className="dot"></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply preview bar */}
      {replyingTo && (
        <div className="reply-bar">
          <div className="reply-bar-content">
            <span className="reply-bar-name">{replyingTo.sender.name || 'Unknown'}</span>
            <span className="reply-bar-text">{replyingTo.content.length > 80 ? replyingTo.content.slice(0, 80) + '...' : replyingTo.content}</span>
          </div>
          <button className="reply-bar-close" onClick={() => setReplyingTo(null)}>x</button>
        </div>
      )}

      {/* Input */}
      <OfflineWarning message="You're offline. Messages can't be sent right now." />
      <form className="chat-input-form" onSubmit={handleSend}>
        <button
          type="button"
          className="btn btn-secondary chat-help-btn"
          onClick={handleIDontKnow}
          disabled={!isOnline || isGeneratingOptions || messages.length === 0}
          title="I don't know what to say"
        >
          {isGeneratingOptions ? '...' : '❓'}
        </button>
        <textarea
          value={newMessage}
          onChange={(e) => {
            setNewMessage(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend(e);
            }
          }}
          placeholder={isAIConversation ? "Type in Chinese..." : "Type a message..."}
          className="chat-input"
          rows={1}
        />
        <button
          type="submit"
          className="btn btn-primary chat-send"
          disabled={!isOnline || !newMessage.trim() || sendMutation.isPending || isWaitingForAI}
        >
          {isWaitingForAI ? '...' : 'Send'}
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

      {/* "I don't know" Input Dialog */}
      {showIdkDialog && (
        <div className="modal-overlay" onClick={() => setShowIdkDialog(false)}>
          <div className="modal idk-dialog-modal" onClick={(e) => e.stopPropagation()}>
            <h3>I don't know what to say</h3>
            <div className="idk-field">
              <label htmlFor="idk-intended">What are you trying to say?</label>
              <textarea
                id="idk-intended"
                value={idkIntendedMeaning}
                onChange={(e) => setIdkIntendedMeaning(e.target.value)}
                placeholder='e.g. "I want to ask about their weekend plans"'
                className="idk-input"
                rows={2}
                autoFocus
              />
            </div>
            <div className="idk-field">
              <label htmlFor="idk-guess">Your guess (optional)</label>
              <textarea
                id="idk-guess"
                value={idkGuess}
                onChange={(e) => setIdkGuess(e.target.value)}
                placeholder="e.g. 你周末想..."
                className="idk-input"
                rows={2}
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowIdkDialog(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleIdkSubmit}
                disabled={!idkIntendedMeaning.trim()}
              >
                Help me say this
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Response Options Modal (I don't know) */}
      {showResponseOptionsModal && responseOptions && (
        <div className="modal-overlay" onClick={() => setShowResponseOptionsModal(false)}>
          <div className="modal response-options-modal" onClick={(e) => e.stopPropagation()}>
            <h3>What could I say?</h3>
            {responseExplanation && (
              <div className="idk-explanation" style={{
                backgroundColor: '#f0f7ff',
                border: '1px solid #bfdbfe',
                borderRadius: '8px',
                padding: '0.75rem',
                marginBottom: '0.75rem',
                fontSize: '0.875rem',
                lineHeight: '1.5',
              }}>
                {responseExplanation}
              </div>
            )}
            <p className="modal-subtitle">Select the responses you'd like to save as flashcards:</p>
            <div className="response-options-list">
              {responseOptions.map((option, index) => (
                <div
                  key={index}
                  className={`response-option-card ${selectedOptions.has(index) ? 'selected' : ''}`}
                  onClick={() => toggleOptionSelection(index)}
                >
                  <div className="option-checkbox">
                    {selectedOptions.has(index) ? '✓' : ''}
                  </div>
                  <div className="option-content">
                    <div className="option-hanzi">{option.hanzi}</div>
                    <div className="option-pinyin">{option.pinyin}</div>
                    <div className="option-english">{option.english}</div>
                    {option.fun_facts && (
                      <div className="option-funfacts">{option.fun_facts}</div>
                    )}
                    {option.context && (
                      <div className="option-context">
                        <small>Context: {option.context}</small>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {selectedOptions.size > 0 && (
              <DeckSelectorWithCreate
                onSelect={(deckId) => handleSaveResponseOptions(deckId)}
                isSaving={isSavingOptions}
                selectedCount={selectedOptions.size}
              />
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowResponseOptionsModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Check Result Modal */}
      {showCheckResultModal && currentCheckResult && (
        <div className="modal-overlay" onClick={() => setShowCheckResultModal(false)}>
          <div className="modal check-result-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Check Result</h3>
            <div className="check-feedback">
              <p>{currentCheckResult.result.feedback}</p>
            </div>
            {currentCheckResult.result.corrections && currentCheckResult.result.corrections.length > 0 && (
              <>
                <h4>Suggested Corrections</h4>
                <div className="corrections-list">
                  {currentCheckResult.result.corrections.map((correction, index) => (
                    <div key={index} className="correction-card">
                      <div className="correction-hanzi">{correction.hanzi}</div>
                      <div className="correction-pinyin">{correction.pinyin}</div>
                      <div className="correction-english">{correction.english}</div>
                      {correction.fun_facts && (
                        <div className="correction-funfacts">{correction.fun_facts}</div>
                      )}
                    </div>
                  ))}
                </div>
                <DeckSelector
                  onSelect={(deckId) => handleSaveCorrections(deckId)}
                  isSaving={isSaving}
                />
              </>
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCheckResultModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Message Discussion Modal */}
      {discussingMessage && (
        <MessageDiscussionModal
          message={discussingMessage}
          onClose={() => setDiscussingMessage(null)}
        />
      )}

      {/* Translate + Flashcard Modal */}
      {showTranslateModal && translateResult && (
        <div className="modal-overlay" onClick={() => setShowTranslateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Translation</h3>
            <div className="translate-result">
              <div className="translate-english">{translateResult.translation}</div>
            </div>
            <h4>Flashcard</h4>
            <div className="generated-card-preview">
              <div className="preview-hanzi">{translateResult.flashcard.hanzi}</div>
              <div className="preview-pinyin">{translateResult.flashcard.pinyin}</div>
              <div className="preview-english">{translateResult.flashcard.english}</div>
              {translateResult.flashcard.fun_facts && (
                <div className="preview-funfacts">{translateResult.flashcard.fun_facts}</div>
              )}
              {translateResult.flashcard.context && (
                <div className="preview-context" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                  Context: {translateResult.flashcard.context}
                </div>
              )}
            </div>
            <DeckSelectorWithCreate
              onSelect={(deckId) => handleSaveTranslateCard(deckId)}
              isSaving={isSavingTranslateCard}
              selectedCount={1}
            />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowTranslateModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voice Settings Modal */}
      {showVoiceSettings && (
        <div className="modal-overlay" onClick={() => setShowVoiceSettings(false)}>
          <div className="modal voice-settings-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Voice Settings</h3>
            <div className="voice-setting-group">
              <label>Voice:</label>
              <select
                value={conversation?.voice_id || 'Chinese (Mandarin)_Gentleman'}
                onChange={(e) => handleVoiceChange(e.target.value)}
              >
                {MINIMAX_VOICES.map((voice) => (
                  <option key={voice.id} value={voice.id}>{voice.name}</option>
                ))}
              </select>
            </div>
            <div className="voice-setting-group">
              <label>Speed: {conversation?.voice_speed || 0.8}x</label>
              <input
                type="range"
                min="0.3"
                max="1.0"
                step="0.1"
                value={conversation?.voice_speed || 0.8}
                onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setShowVoiceSettings(false)}>
                Done
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

// Deck selector with create new deck option
function DeckSelectorWithCreate({
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
      // Refresh decks list
      decksQuery.refetch();
      onSelect(newDeck.id);
    } catch (error) {
      console.error('Failed to create deck:', error);
      alert('Failed to create deck');
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
            + Create new deck
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
              {isCreatingDeck ? '...' : 'Create & Save'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
