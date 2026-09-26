import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { base64ToBlob } from '../services/ttsCache';
import { createAudioPlayer } from '../utils/audioPlayback';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getRelationship,
  getMessages,
  sendMessage,
  generateFlashcardFromChat,
  generateResponseOptions,
  createNote,
  createDeck,
  createConversation,
  getDecks,
  getAIResponse,
  generateConversationTTS,
  checkMessage,
  translateMessageFlashcard,
  updateConversationVoiceSettings,
  updateConversationTitle,
  getConversations,
  markNotificationsReadByConversation,
  toggleMessageReaction,
} from '../api/client';
import type { TranslateFlashcardResponse, VocabularyDefinition } from '../api/client';
import {
  MessageWithSender,
  getOtherUserInRelationship,
  getMyRoleInRelationship,
  isClaudeUser,
  MINIMAX_VOICES,
  GeneratedNoteWithContext,
  CheckMessageResponse,
} from '../types';
import { InteractiveMessage } from '../components/InteractiveMessage';
import { Loading, ErrorMessage } from '../components/Loading';
import { MessageDiscussionModal } from '../components/MessageDiscussionModal';
import { MessageActionSheet } from '../components/chat/MessageActionSheet';
import { toolsForMessage } from '../components/chat/messageTools';
import type { MessageToolId } from '../components/chat/messageTools';
import { InlineNotice, describeError } from '../components/chat/InlineNotice';
import type { Notice } from '../components/chat/InlineNotice';
import { SpinnerButton } from '../components/chat/SpinnerButton';
import { useAuth } from '../contexts/AuthContext';
import { useNetwork } from '../contexts/NetworkContext';
import { OfflineWarning } from '../components/OfflineWarning';
import { usePinnedDecks } from '../hooks/usePinnedDecks';
import './ChatPage.css';

const POLL_INTERVAL = 3000; // 3 seconds
const LONG_PRESS_MS = 500;

const DEFAULT_EMOJIS = ['👍', '❤️', '😂', '😮', '👏', '🔥'];
const FULL_EMOJI_LIST = [
  // Smileys
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊',
  '😇', '🥰', '😍', '🤩', '😘', '😗', '😋', '😛', '😜', '🤪',
  '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '😐', '😑', '😶', '😏',
  '😒', '🙄', '😬', '😮‍💨', '🤥', '😌', '😔', '😪', '🤤', '😴',
  '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '🤯',
  '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮',
  '😯', '😲', '😳', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬',
  // Gestures & People
  '👋', '🤚', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟',
  '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊',
  '👊', '🤛', '🤜', '👏', '🙌', '🤲', '🤝', '🙏', '💪', '🦾',
  // Hearts & Symbols
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
  '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️',
  '💯', '💢', '💥', '💫', '💦', '💨', '🕳️', '💣', '💬', '💭',
  // Objects & Nature
  '🔥', '⭐', '🌟', '✨', '⚡', '🎉', '🎊', '🎈', '🎁', '🏆',
  '🥇', '🥈', '🥉', '🏅', '🎯', '🎵', '🎶', '🔔', '📣', '📢',
  '🌈', '☀️', '🌤️', '⛅', '🌙', '🌸', '🌺', '🌻', '🌹', '🍀',
  // Food & Animals
  '🐶', '🐱', '🐭', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁',
  '🍎', '🍕', '🍔', '🍣', '🍜', '🍦', '🍰', '🧁', '☕', '🍵',
];

const RECENT_EMOJIS_KEY = 'chat-recent-emojis';
const MAX_RECENT = 5;

function getRecentEmojis(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_EMOJIS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentEmoji(emoji: string) {
  try {
    const recent = getRecentEmojis().filter((e) => e !== emoji);
    recent.unshift(emoji);
    localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
  } catch {
    // localStorage unavailable — recents are a convenience only
  }
}

function getQuickEmojis(): string[] {
  const recent = getRecentEmojis();
  if (recent.length === 0) return DEFAULT_EMOJIS;
  // Merge: recent first, then fill with defaults that aren't in recent
  const merged = [...recent];
  for (const e of DEFAULT_EMOJIS) {
    if (!merged.includes(e) && merged.length < 6) merged.push(e);
  }
  return merged.slice(0, 6);
}

export function ChatPage() {
  const { relId, convId } = useParams<{ relId: string; convId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isOnline } = useNetwork();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // `?new=1` (or `/chat/new`) opens a fresh, untitled conversation for the
  // relationship and replaces the URL with the new conversation's id.
  const wantsNew = searchParams.get('new') === '1' || convId === 'new';
  const creatingRef = useRef(false);
  const [createError, setCreateError] = useState<string | null>(null);

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

  // Inline notices: one under the composer, one inside whichever modal is open.
  const [notice, setNotice] = useState<Notice | null>(null);
  const [modalNotice, setModalNotice] = useState<Notice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const clearModalNotice = useCallback(() => setModalNotice(null), []);
  const showError = (fallback: string, error: unknown) =>
    setNotice({ kind: 'error', text: describeError(error, fallback) });
  const showModalError = (fallback: string, error: unknown) =>
    setModalNotice({ kind: 'error', text: describeError(error, fallback) });
  const showSuccess = (text: string) => setNotice({ kind: 'success', text });

  // Response options ("Help me say it") state
  const [isGeneratingOptions, setIsGeneratingOptions] = useState(false);
  const [responseOptions, setResponseOptions] = useState<GeneratedNoteWithContext[] | null>(null);
  const [responseExplanation, setResponseExplanation] = useState<string | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<Set<number>>(new Set());
  const [showResponseOptionsModal, setShowResponseOptionsModal] = useState(false);
  const [isSavingOptions, setIsSavingOptions] = useState(false);

  // "Help me say it" input dialog state
  const [showIdkDialog, setShowIdkDialog] = useState(false);
  const [idkIntendedMeaning, setIdkIntendedMeaning] = useState('');
  const [idkGuess, setIdkGuess] = useState('');

  // AI conversation state
  const [isWaitingForAI, setIsWaitingForAI] = useState(false);
  const [playingAudioMessageId, setPlayingAudioMessageId] = useState<string | null>(null);
  const playerRef = useRef(createAudioPlayer());

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

  // Word-by-word (segmented) translation, per message
  const [wordByWord, setWordByWord] = useState<Set<string>>(new Set());

  // Interactive translation word save state
  const [wordToSave, setWordToSave] = useState<VocabularyDefinition | null>(null);
  const [showWordSaveModal, setShowWordSaveModal] = useState(false);
  const [isSavingWord, setIsSavingWord] = useState(false);

  // Voice settings state
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);

  // Header ⋯ menu + rename
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  // Reply state
  const [replyingTo, setReplyingTo] = useState<MessageWithSender | null>(null);

  // Per-message action sheet (⋯ / long-press)
  const [sheet, setSheet] = useState<{ message: MessageWithSender; anchor: DOMRect | null } | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const pressFiredAt = useRef(0);

  // Reset state when conversation changes
  useEffect(() => {
    setNewMessages([]);
    setLastTimestamp(null);
    setCheckResults(new Map());
    setWordByWord(new Set());
    setNotice(null);
    setSheet(null);
    setShowHeaderMenu(false);
    // Stop any playing audio
    playerRef.current.stop();
    setPlayingAudioMessageId(null);
  }, [convId]);

  // Auto-clear chat notifications when opening the conversation
  useEffect(() => {
    if (convId && !wantsNew) {
      markNotificationsReadByConversation(convId).catch(() => {});
    }
  }, [convId, wantsNew]);

  // Open a fresh conversation when asked to
  useEffect(() => {
    if (!wantsNew || !relId || creatingRef.current) return;
    creatingRef.current = true;
    setCreateError(null);
    createConversation(relId)
      .then((conv) => {
        queryClient.invalidateQueries({ queryKey: ['conversations', relId] });
        navigate(`/connections/${relId}/chat/${conv.id}`, { replace: true });
      })
      .catch((error) => {
        setCreateError(describeError(error, "Couldn't start a new conversation."));
      })
      .finally(() => {
        creatingRef.current = false;
      });
  }, [wantsNew, relId, navigate, queryClient]);

  // Escape closes the header menu
  useEffect(() => {
    if (!showHeaderMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowHeaderMenu(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showHeaderMenu]);

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

  const conversation = conversationsQuery.data?.find((c) => c.id === convId);
  const isAIConversation = conversation?.is_ai_conversation ?? false;

  // Initial messages load
  const initialMessagesQuery = useQuery({
    queryKey: ['messages', convId],
    queryFn: () => getMessages(convId!),
    enabled: !!convId && !wantsNew,
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
        setNewMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const uniqueNew = result.messages.filter((m) => !existingIds.has(m.id));
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
  const allMessages = [...(initialMessagesQuery.data?.messages || []), ...newMessages];
  const seenIds = new Set<string>();
  const messages = allMessages.filter((msg) => {
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
      setNewMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev;
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
          setNewMessages((prev) => {
            if (prev.some((m) => m.id === response.message.id)) return prev;
            return [...prev, response.message];
          });
          setLastTimestamp(response.message.created_at);

          // Play audio if available
          if (response.audio_base64 && response.audio_content_type) {
            playBase64Audio(response.audio_base64, response.audio_content_type, response.message.id);
          }
        } catch (error) {
          console.error('Failed to get AI response:', error);
          showError("Claude couldn't reply. Your message was sent — try sending another to retry.", error);
        } finally {
          setIsWaitingForAI(false);
        }
      }
    },
    onError: (error) => {
      console.error('Failed to send message:', error);
      showError("Couldn't send your message. It's still in the box below — try again.", error);
    },
  });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || sendMutation.isPending || isWaitingForAI) return;
    if (!isOnline) {
      setNotice({ kind: 'error', text: "You're offline. Messages can't be sent until you're back online." });
      return;
    }
    setNotice(null);
    sendMutation.mutate({ content: newMessage.trim(), replyToId: replyingTo?.id });
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    setSheet(null);
    saveRecentEmoji(emoji);
    try {
      await toggleMessageReaction(messageId, emoji);
      queryClient.invalidateQueries({ queryKey: ['messages', convId] });
    } catch (error) {
      console.error('Failed to toggle reaction:', error);
      showError("Couldn't add your reaction.", error);
    }
  };

  // Audio playback functions
  const playBase64Audio = (base64: string, contentType: string, messageId: string) => {
    setPlayingAudioMessageId(messageId);
    playerRef.current.play(base64ToBlob(base64, contentType), {
      onEnded: () => setPlayingAudioMessageId(null),
      onError: () => setPlayingAudioMessageId(null),
    });
  };

  const handlePlayMessageAudio = async (msg: MessageWithSender) => {
    if (playingAudioMessageId === msg.id) {
      // Stop playing
      playerRef.current.stop();
      setPlayingAudioMessageId(null);
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
      showError("Couldn't play that message.", error);
    }
  };

  // Message checking
  const handleCheckMessage = async (msg: MessageWithSender) => {
    if (checkingMessageId) return;

    setCheckingMessageId(msg.id);
    try {
      const result = await checkMessage(msg.id);
      setCheckResults((prev) => new Map(prev).set(msg.id, result));

      if (result.status === 'needs_improvement' && result.corrections) {
        setModalNotice(null);
        setCurrentCheckResult({ messageId: msg.id, result });
        setShowCheckResultModal(true);
      } else if (result.status === 'correct') {
        showSuccess('Looks good — no corrections needed.');
      }
    } catch (error) {
      console.error('Failed to check message:', error);
      showError("Couldn't check that message.", error);
    } finally {
      setCheckingMessageId(null);
    }
  };

  const openCheckResult = (msg: MessageWithSender) => {
    const local = checkResults.get(msg.id);
    const result: CheckMessageResponse | null = local
      ? local
      : msg.check_status
        ? { status: msg.check_status, feedback: msg.check_feedback || '', corrections: null }
        : null;
    if (!result) return;
    setModalNotice(null);
    setCurrentCheckResult({ messageId: msg.id, result });
    setShowCheckResultModal(true);
  };

  const deckNameFor = (deckId: string) =>
    queryClient.getQueryData<Array<{ id: string; name: string }>>(['decks'])?.find((d) => d.id === deckId)?.name;

  const handleGenerateFlashcard = async () => {
    if (!convId) return;
    setIsGenerating(true);
    setGeneratedCard(null);
    setNotice(null);
    try {
      const result = await generateFlashcardFromChat(convId);
      setGeneratedCard(result.flashcard);
      setModalNotice(null);
      setShowSaveModal(true);
    } catch (error) {
      console.error('Failed to generate flashcard:', error);
      showError("Couldn't make a card from this conversation — it needs some Chinese vocabulary to work from.", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveFlashcard = async (deckId: string) => {
    if (!generatedCard) return;
    setIsSaving(true);
    setModalNotice(null);
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
      showSuccess(`Saved ${generatedCard.hanzi} to ${deckNameFor(deckId) || 'your deck'}.`);
    } catch (error) {
      console.error('Failed to save flashcard:', error);
      showModalError("Couldn't save the flashcard.", error);
    } finally {
      setIsSaving(false);
    }
  };

  // "Help me say it" - open input dialog
  const handleHelpMeSayIt = () => {
    setIdkIntendedMeaning('');
    setIdkGuess('');
    setNotice(null);
    setShowIdkDialog(true);
  };

  // Submit the "Help me say it" dialog and generate response options
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
      setModalNotice(null);
      setShowResponseOptionsModal(true);
    } catch (error) {
      console.error('Failed to generate response options:', error);
      showError("Couldn't come up with suggestions.", error);
    } finally {
      setIsGeneratingOptions(false);
    }
  };

  const toggleOptionSelection = (index: number) => {
    setSelectedOptions((prev) => {
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
    setModalNotice(null);
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
      showSuccess(`Saved ${selectedCards.length} flashcard${selectedCards.length !== 1 ? 's' : ''} to ${deckNameFor(deckId) || 'your deck'}.`);
    } catch (error) {
      console.error('Failed to save flashcards:', error);
      showModalError("Couldn't save the flashcards.", error);
    } finally {
      setIsSavingOptions(false);
    }
  };

  // Save check result corrections as flashcards
  const handleSaveCorrections = async (deckId: string) => {
    if (!currentCheckResult?.result.corrections) return;
    setIsSaving(true);
    setModalNotice(null);
    try {
      for (const correction of currentCheckResult.result.corrections) {
        await createNote(deckId, {
          hanzi: correction.hanzi,
          pinyin: correction.pinyin,
          english: correction.english,
          fun_facts: correction.fun_facts,
        });
      }
      const count = currentCheckResult.result.corrections.length;
      setShowCheckResultModal(false);
      setCurrentCheckResult(null);
      showSuccess(`Saved ${count} correction${count !== 1 ? 's' : ''} as flashcards in ${deckNameFor(deckId) || 'your deck'}.`);
    } catch (error) {
      console.error('Failed to save corrections:', error);
      showModalError("Couldn't save the corrections.", error);
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
      setModalNotice(null);
      setShowTranslateModal(true);
    } catch (error) {
      console.error('Failed to translate message:', error);
      showError("Couldn't translate that message.", error);
    } finally {
      setTranslatingMessageId(null);
    }
  };

  const handleSaveTranslateCard = async (deckId: string) => {
    if (!translateResult) return;
    setIsSavingTranslateCard(true);
    setModalNotice(null);
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
      showSuccess(`Saved ${translateResult.flashcard.hanzi} to ${deckNameFor(deckId) || 'your deck'}.`);
    } catch (error) {
      console.error('Failed to save flashcard:', error);
      showModalError("Couldn't save the flashcard.", error);
    } finally {
      setIsSavingTranslateCard(false);
    }
  };

  // Interactive translation word save handlers
  const handleSaveWordFromChat = (definition: VocabularyDefinition) => {
    setWordToSave(definition);
    setModalNotice(null);
    setShowWordSaveModal(true);
  };

  const handleSaveWord = async (deckId: string) => {
    if (!wordToSave) return;
    setIsSavingWord(true);
    setModalNotice(null);
    try {
      await createNote(deckId, {
        hanzi: wordToSave.hanzi,
        pinyin: wordToSave.pinyin,
        english: wordToSave.english,
        fun_facts: wordToSave.fun_facts,
      });
      setShowWordSaveModal(false);
      setWordToSave(null);
      showSuccess(`Saved ${wordToSave.hanzi} to ${deckNameFor(deckId) || 'your deck'}.`);
    } catch (error) {
      console.error('Failed to save word:', error);
      showModalError("Couldn't save the word.", error);
    } finally {
      setIsSavingWord(false);
    }
  };

  // Voice settings handlers
  const handleVoiceChange = async (voiceId: string) => {
    if (!convId) return;
    setModalNotice(null);
    try {
      await updateConversationVoiceSettings(convId, voiceId, undefined);
      queryClient.invalidateQueries({ queryKey: ['conversations', relId] });
    } catch (error) {
      console.error('Failed to update voice:', error);
      showModalError("Couldn't change the voice.", error);
    }
  };

  const handleSpeedChange = async (speed: number) => {
    if (!convId) return;
    setModalNotice(null);
    try {
      await updateConversationVoiceSettings(convId, undefined, speed);
      queryClient.invalidateQueries({ queryKey: ['conversations', relId] });
    } catch (error) {
      console.error('Failed to update speed:', error);
      showModalError("Couldn't change the speed.", error);
    }
  };

  const handleRename = async () => {
    if (!convId) return;
    setIsRenaming(true);
    setModalNotice(null);
    try {
      await updateConversationTitle(convId, renameValue.trim());
      queryClient.invalidateQueries({ queryKey: ['conversations', relId] });
      setShowRenameModal(false);
    } catch (error) {
      console.error('Failed to rename conversation:', error);
      showModalError("Couldn't save the title.", error);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleCopy = async (msg: MessageWithSender) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      showSuccess('Copied.');
    } catch (error) {
      showError("Couldn't copy to the clipboard.", error);
    }
  };

  // ----- Per-message action sheet -----
  const openSheet = (message: MessageWithSender, anchor: DOMRect | null) => {
    setSheet({ message, anchor });
  };

  const clearPress = () => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressStart.current = null;
  };

  const startPress = (msg: MessageWithSender) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.currentTarget;
    clearPress();
    pressStart.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      pressFiredAt.current = Date.now();
      openSheet(msg, target.getBoundingClientRect());
    }, LONG_PRESS_MS);
  };

  const movePress = (e: React.PointerEvent<HTMLElement>) => {
    if (!pressStart.current) return;
    if (Math.abs(e.clientX - pressStart.current.x) > 10 || Math.abs(e.clientY - pressStart.current.y) > 10) {
      clearPress();
    }
  };

  const handleSheetAction = (id: MessageToolId) => {
    if (!sheet) return;
    const msg = sheet.message;
    setSheet(null);
    switch (id) {
      case 'reply':
        setReplyingTo(msg);
        break;
      case 'play':
        handlePlayMessageAudio(msg);
        break;
      case 'check':
        handleCheckMessage(msg);
        break;
      case 'view_corrections':
        openCheckResult(msg);
        break;
      case 'translate':
        handleTranslateFlashcard(msg);
        break;
      case 'word_by_word':
        setWordByWord((prev) => {
          const next = new Set(prev);
          if (next.has(msg.id)) next.delete(msg.id);
          else next.add(msg.id);
          return next;
        });
        break;
      case 'discuss':
        setDiscussingMessage(msg);
        break;
      case 'copy':
        handleCopy(msg);
        break;
      case 'react':
        break;
    }
  };

  if (wantsNew) {
    if (createError) {
      return (
        <div className="chat-page">
          <div className="chat-header">
            <Link to={`/connections/${relId}`} className="chat-back" aria-label="Back">←</Link>
            <span className="chat-header-name">New conversation</span>
          </div>
          <div className="chat-messages">
            <div className="chat-notice chat-notice-error" role="alert">
              <span className="chat-notice-text">{createError}</span>
            </div>
          </div>
        </div>
      );
    }
    return <Loading message="Starting a new conversation..." />;
  }

  if (initialMessagesQuery.isLoading || relationshipQuery.isLoading) {
    return <Loading />;
  }

  if (initialMessagesQuery.error || relationshipQuery.error) {
    return <ErrorMessage message="Failed to load chat" />;
  }

  const relationship = relationshipQuery.data!;
  const otherUser = getOtherUserInRelationship(relationship, user!.id);
  const viewerRole = getMyRoleInRelationship(relationship, user!.id);

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

  // A message's check status is whatever we learnt locally, else what the server stored.
  const withCheckStatus = (msg: MessageWithSender): MessageWithSender => {
    const local = checkResults.get(msg.id);
    return local ? { ...msg, check_status: local.status } : msg;
  };

  const sheetTools = sheet
    ? toolsForMessage(withCheckStatus(sheet.message), viewerRole, isAIConversation, user!.id).menu
    : [];

  const chatToolsBlocked = !isOnline;

  return (
    <div className="chat-page">
      {/* Header */}
      <div className="chat-header">
        <Link to={`/connections/${relId}`} className="chat-back" aria-label="Back">←</Link>
        <div className="chat-header-user">
          {otherUser.picture_url ? (
            <img src={otherUser.picture_url} alt="" className="chat-avatar" />
          ) : (
            <div className="chat-avatar placeholder">
              {isAIConversation ? '🤖' : (otherUser.name || otherUser.email || '?')[0].toUpperCase()}
            </div>
          )}
          <div className="chat-header-text">
            <span className="chat-header-name">
              {otherUser.name || 'Unknown'}
              {isAIConversation && <span className="ai-badge">AI</span>}
            </span>
            {conversation?.title && <span className="chat-header-title">{conversation.title}</span>}
          </div>
        </div>
        <div className="chat-header-actions">
          <SpinnerButton
            type="button"
            className="btn btn-sm btn-secondary chat-card-btn"
            busy={isGenerating}
            onClick={handleGenerateFlashcard}
            disabled={chatToolsBlocked || messages.length === 0}
            title={chatToolsBlocked ? 'Needs internet' : 'Make a flashcard from this conversation'}
          >
            + Card
          </SpinnerButton>
          <button
            type="button"
            className="btn btn-sm btn-secondary chat-menu-btn"
            onClick={() => setShowHeaderMenu((v) => !v)}
            aria-label="Conversation menu"
            aria-haspopup="menu"
            aria-expanded={showHeaderMenu}
          >
            ⋯
          </button>
        </div>
      </div>

      {showHeaderMenu && (
        <div className="chat-header-menu-overlay" onClick={() => setShowHeaderMenu(false)}>
          <div className="chat-header-menu" role="menu" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              role="menuitem"
              className="chat-header-menu-item"
              disabled={!isOnline}
              onClick={() => {
                setShowHeaderMenu(false);
                navigate(`/connections/${relId}/chat/${convId}?new=1`);
              }}
            >
              <span aria-hidden="true">＋</span> New conversation
              {!isOnline && <span className="msg-sheet-action-hint">Needs internet</span>}
            </button>
            <button
              type="button"
              role="menuitem"
              className="chat-header-menu-item"
              disabled={!isOnline}
              onClick={() => {
                setShowHeaderMenu(false);
                setRenameValue(conversation?.title || '');
                setModalNotice(null);
                setShowRenameModal(true);
              }}
            >
              <span aria-hidden="true">✏️</span> {conversation?.title ? 'Rename conversation' : 'Add a title'}
            </button>
            {isAIConversation && (
              <button
                type="button"
                role="menuitem"
                className="chat-header-menu-item"
                onClick={() => {
                  setShowHeaderMenu(false);
                  setModalNotice(null);
                  setShowVoiceSettings(true);
                }}
              >
                <span aria-hidden="true">🔊</span> Voice settings
              </button>
            )}
            <Link role="menuitem" className="chat-header-menu-item" to={`/connections/${relId}`}>
              <span aria-hidden="true">☰</span> All conversations
            </Link>
          </div>
        </div>
      )}

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
              {group.messages.map((rawMsg) => {
                const msg = withCheckStatus(rawMsg);
                const isMe = msg.sender_id === user!.id;
                const isAI = isClaudeUser(msg.sender_id);
                const isPlaying = playingAudioMessageId === msg.id;
                const isChecking = checkingMessageId === msg.id;
                const isTranslating = translatingMessageId === msg.id;
                const tools = toolsForMessage(msg, viewerRole, isAIConversation, user!.id);
                const canPlay = tools.inline.some((t) => t.id === 'play');
                const checkStatus = msg.check_status;

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
                          <span className="reply-preview-text">
                            {msg.reply_to.content.length > 60 ? msg.reply_to.content.slice(0, 60) + '...' : msg.reply_to.content}
                          </span>
                        </div>
                      )}
                      <div
                        className="chat-bubble"
                        onPointerDown={startPress(msg)}
                        onPointerMove={movePress}
                        onPointerUp={clearPress}
                        onPointerCancel={clearPress}
                        onPointerLeave={clearPress}
                        onContextMenu={(e) => {
                          // A touch long-press also fires contextmenu; keep the native menu out of the way.
                          if (pressTimer.current || Date.now() - pressFiredAt.current < 1000) e.preventDefault();
                        }}
                      >
                        {!isMe && tools.hasChinese ? (
                          <InteractiveMessage
                            message={msg}
                            showTranslation={wordByWord.has(msg.id)}
                            onSaveWord={handleSaveWordFromChat}
                            onError={(text) => setNotice({ kind: 'error', text })}
                          />
                        ) : (
                          <>
                            {/* A video-call invite ("join here: …/calls/<id>") shows a Join button instead of the raw link. */}
                            {(() => {
                              const callId = /https?:\/\/\S+\/calls\/([A-Za-z0-9_-]{8,})/.exec(msg.content)?.[1];
                              if (!callId) return msg.content;
                              return (
                                <>
                                  {msg.content.replace(/\s*(—\s*join here:)?\s*https?:\/\/\S+\/calls\/\S+/, '')}
                                  <Link to={`/calls/${callId}`} className="chat-call-link" onClick={(e) => e.stopPropagation()}>📹 Join the call</Link>
                                </>
                              );
                            })()}
                            {/* Check status indicator */}
                            {isMe && checkStatus && (
                              <button
                                type="button"
                                className={`check-status ${checkStatus}`}
                                onClick={() => openCheckResult(msg)}
                                title={checkStatus === 'correct' ? 'Checked — looks good' : 'View corrections'}
                                aria-label={checkStatus === 'correct' ? 'Checked — looks good' : 'View corrections'}
                              >
                                {checkStatus === 'correct' ? '✓' : '⚠'}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      {/* Reactions display */}
                      {msg.reactions && msg.reactions.length > 0 && (
                        <div className="message-reactions">
                          {msg.reactions.map((r) => (
                            <button
                              key={r.emoji}
                              className={`reaction-badge ${r.users.some((u) => u.id === user!.id) ? 'mine' : ''}`}
                              onClick={() => handleReaction(msg.id, r.emoji)}
                              title={r.users.map((u) => u.name || 'Unknown').join(', ')}
                            >
                              {r.emoji} {r.count > 1 ? r.count : ''}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="chat-message-meta">
                        <span className="chat-time">{formatTime(msg.created_at)}</span>
                        {/* Recording indicator */}
                        {msg.recording_url && (
                          <span className="has-recording" title="Has recording">🎤</span>
                        )}
                        {/* Inline progress for the AI tools */}
                        {isChecking && (
                          <span className="msg-status" role="status">
                            <span className="chat-spinner" aria-hidden="true" /> Checking…
                          </span>
                        )}
                        {isTranslating && (
                          <span className="msg-status" role="status">
                            <span className="chat-spinner" aria-hidden="true" /> Translating…
                          </span>
                        )}
                        {/* Message actions: Reply, Play, ⋯ */}
                        <div className="chat-message-actions">
                          <button
                            type="button"
                            className="msg-action-btn"
                            onClick={() => setReplyingTo(msg)}
                            title="Reply"
                            aria-label="Reply"
                          >
                            ↩
                          </button>
                          {canPlay && (
                            <button
                              type="button"
                              className={`msg-action-btn ${isPlaying ? 'playing' : ''}`}
                              onClick={() => handlePlayMessageAudio(msg)}
                              disabled={chatToolsBlocked && !isPlaying}
                              title={chatToolsBlocked ? 'Play needs internet' : isPlaying ? 'Stop' : 'Play audio'}
                              aria-label={isPlaying ? 'Stop audio' : 'Play audio'}
                            >
                              {isPlaying ? '⏹' : '🔊'}
                            </button>
                          )}
                          <button
                            type="button"
                            className="msg-action-btn msg-more-btn"
                            onClick={(e) => openSheet(msg, e.currentTarget.getBoundingClientRect())}
                            title="More actions"
                            aria-label="More actions"
                            aria-haspopup="dialog"
                          >
                            ⋯
                          </button>
                        </div>
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
            <span className="reply-bar-text">
              {replyingTo.content.length > 80 ? replyingTo.content.slice(0, 80) + '...' : replyingTo.content}
            </span>
          </div>
          <button className="reply-bar-close" onClick={() => setReplyingTo(null)} aria-label="Cancel reply">×</button>
        </div>
      )}

      {/* Composer */}
      <div className="chat-composer">
        <div className="chat-composer-tools">
          <SpinnerButton
            type="button"
            className="btn btn-secondary chat-help-btn"
            busy={isGeneratingOptions}
            onClick={handleHelpMeSayIt}
            disabled={chatToolsBlocked || messages.length === 0}
            title={chatToolsBlocked ? 'Needs internet' : 'Not sure how to say something? Get suggestions in Chinese'}
          >
            <span aria-hidden="true">💡</span> Help me say it
          </SpinnerButton>
          {chatToolsBlocked && <span className="chat-offline-hint">Chat tools need internet</span>}
        </div>
        <OfflineWarning message="You're offline. Messages can't be sent until you're back online (nothing is queued)." />
        <InlineNotice notice={notice} onDismiss={clearNotice} className="chat-composer-notice" />
        <form className="chat-input-form" onSubmit={handleSend}>
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
            placeholder={isAIConversation ? 'Type in Chinese...' : 'Type a message...'}
            className="chat-input"
            rows={1}
            aria-label="Message"
          />
          <SpinnerButton
            type="submit"
            className="btn btn-primary chat-send"
            busy={sendMutation.isPending || isWaitingForAI}
            disabled={!isOnline || !newMessage.trim()}
            title={!isOnline ? "You're offline" : undefined}
          >
            Send
          </SpinnerButton>
        </form>
      </div>

      {/* Per-message action sheet */}
      {sheet && (
        <MessageActionSheet
          message={sheet.message}
          tools={sheetTools}
          isOnline={isOnline}
          anchor={sheet.anchor}
          quickEmojis={getQuickEmojis()}
          recentEmojis={getRecentEmojis()}
          allEmojis={FULL_EMOJI_LIST}
          onAction={handleSheetAction}
          onReact={(emoji) => handleReaction(sheet.message.id, emoji)}
          onClose={() => setSheet(null)}
        />
      )}

      {/* Save Flashcard Modal */}
      {showSaveModal && generatedCard && (
        <div className="modal-overlay" onClick={() => { setShowSaveModal(false); setModalNotice(null); }}>
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
            <InlineNotice notice={modalNotice} onDismiss={clearModalNotice} className="chat-modal-notice" />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowSaveModal(false); setModalNotice(null); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* "Help me say it" Input Dialog */}
      {showIdkDialog && (
        <div className="modal-overlay" onClick={() => setShowIdkDialog(false)}>
          <div className="modal idk-dialog-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Help me say it</h3>
            <p className="modal-subtitle">Tell me what you mean and I'll suggest ways to say it in Chinese.</p>
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
                Suggest replies
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Response Options Modal (Help me say it) */}
      {showResponseOptionsModal && responseOptions && (
        <div className="modal-overlay" onClick={() => { setShowResponseOptionsModal(false); setModalNotice(null); }}>
          <div className="modal response-options-modal" onClick={(e) => e.stopPropagation()}>
            <h3>What could I say?</h3>
            {responseExplanation && (
              <div className="idk-explanation">
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
            <InlineNotice notice={modalNotice} onDismiss={clearModalNotice} className="chat-modal-notice" />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowResponseOptionsModal(false); setModalNotice(null); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Check Result Modal */}
      {showCheckResultModal && currentCheckResult && (
        <div className="modal-overlay" onClick={() => { setShowCheckResultModal(false); setModalNotice(null); }}>
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
                <DeckSelectorWithCreate
                  onSelect={(deckId) => handleSaveCorrections(deckId)}
                  isSaving={isSaving}
                  selectedCount={currentCheckResult.result.corrections?.length || 0}
                />
              </>
            )}
            <InlineNotice notice={modalNotice} onDismiss={clearModalNotice} className="chat-modal-notice" />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowCheckResultModal(false); setModalNotice(null); }}>
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
        <div className="modal-overlay" onClick={() => { setShowTranslateModal(false); setModalNotice(null); }}>
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
                <div className="preview-context">
                  Context: {translateResult.flashcard.context}
                </div>
              )}
            </div>
            <DeckSelectorWithCreate
              onSelect={(deckId) => handleSaveTranslateCard(deckId)}
              isSaving={isSavingTranslateCard}
              selectedCount={1}
            />
            <InlineNotice notice={modalNotice} onDismiss={clearModalNotice} className="chat-modal-notice" />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowTranslateModal(false); setModalNotice(null); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Word Save Modal from Interactive Translation */}
      {showWordSaveModal && wordToSave && (
        <div className="modal-overlay" onClick={() => { setShowWordSaveModal(false); setModalNotice(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Save Word to Flashcards</h3>
            <div className="generated-card-preview">
              <div className="preview-hanzi">{wordToSave.hanzi}</div>
              <div className="preview-pinyin">{wordToSave.pinyin}</div>
              <div className="preview-english">{wordToSave.english}</div>
              {wordToSave.fun_facts && (
                <div className="preview-funfacts">{wordToSave.fun_facts}</div>
              )}
            </div>
            <DeckSelectorWithCreate
              onSelect={(deckId) => handleSaveWord(deckId)}
              isSaving={isSavingWord}
              selectedCount={1}
            />
            <InlineNotice notice={modalNotice} onDismiss={clearModalNotice} className="chat-modal-notice" />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowWordSaveModal(false); setModalNotice(null); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename conversation modal */}
      {showRenameModal && (
        <div className="modal-overlay" onClick={() => { setShowRenameModal(false); setModalNotice(null); }}>
          <div className="modal idk-dialog-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{conversation?.title ? 'Rename conversation' : 'Add a title'}</h3>
            <div className="idk-field">
              <label htmlFor="conv-title-input">Title (optional)</label>
              <input
                id="conv-title-input"
                type="text"
                className="new-deck-input chat-title-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="e.g. This week's homework"
                maxLength={120}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleRename();
                  }
                }}
              />
            </div>
            <InlineNotice notice={modalNotice} onDismiss={clearModalNotice} className="chat-modal-notice" />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowRenameModal(false); setModalNotice(null); }}>
                Cancel
              </button>
              <SpinnerButton type="button" className="btn btn-primary" busy={isRenaming} onClick={handleRename}>
                Save
              </SpinnerButton>
            </div>
          </div>
        </div>
      )}

      {/* Voice Settings Modal */}
      {showVoiceSettings && (
        <div className="modal-overlay" onClick={() => { setShowVoiceSettings(false); setModalNotice(null); }}>
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
            <InlineNotice notice={modalNotice} onDismiss={clearModalNotice} className="chat-modal-notice" />
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => { setShowVoiceSettings(false); setModalNotice(null); }}>
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
  const { isPinned, togglePin, sortWithPinnedFirst } = usePinnedDecks();
  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: () => getDecks(),
  });

  if (decksQuery.isLoading) {
    return <Loading message="Loading decks..." />;
  }

  const decks = sortWithPinnedFirst(decksQuery.data || []);

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
          <div key={deck.id} className="deck-option-row">
            <button
              className="deck-option"
              onClick={() => onSelect(deck.id)}
              disabled={isSaving}
            >
              {isPinned(deck.id) && <span className="deck-pin-mark">📌</span>}
              {deck.name}
            </button>
            <button
              onClick={() => togglePin(deck.id)}
              title={isPinned(deck.id) ? 'Unpin deck' : 'Pin deck to top'}
              aria-label={isPinned(deck.id) ? 'Unpin deck' : 'Pin deck to top'}
              disabled={isSaving}
              className={`deck-pin-btn ${isPinned(deck.id) ? 'pinned' : ''}`}
            >
              📌
            </button>
          </div>
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
  const [createError, setCreateError] = useState<Notice | null>(null);
  const { isPinned, togglePin, sortWithPinnedFirst } = usePinnedDecks();

  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: () => getDecks(),
  });

  const handleCreateAndSelect = async () => {
    if (!newDeckName.trim()) return;
    setIsCreatingDeck(true);
    setCreateError(null);
    try {
      const newDeck = await createDeck(newDeckName.trim());
      // Refresh decks list
      decksQuery.refetch();
      onSelect(newDeck.id);
    } catch (error) {
      console.error('Failed to create deck:', error);
      setCreateError({ kind: 'error', text: describeError(error, "Couldn't create the deck.") });
      setIsCreatingDeck(false);
    }
  };

  if (decksQuery.isLoading) {
    return <Loading message="Loading decks..." />;
  }

  const decks = sortWithPinnedFirst(decksQuery.data || []);

  return (
    <div className="deck-selector">
      <label>Save {selectedCount} card{selectedCount !== 1 ? 's' : ''} to:</label>
      <div className="deck-options">
        {decks.map((deck) => (
          <div key={deck.id} className="deck-option-row">
            <button
              className="deck-option"
              onClick={() => onSelect(deck.id)}
              disabled={isSaving || isCreatingDeck}
            >
              {isPinned(deck.id) && <span className="deck-pin-mark">📌</span>}
              {deck.name}
            </button>
            <button
              onClick={() => togglePin(deck.id)}
              title={isPinned(deck.id) ? 'Unpin deck' : 'Pin deck to top'}
              aria-label={isPinned(deck.id) ? 'Unpin deck' : 'Pin deck to top'}
              disabled={isSaving || isCreatingDeck}
              className={`deck-pin-btn ${isPinned(deck.id) ? 'pinned' : ''}`}
            >
              📌
            </button>
          </div>
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
            <SpinnerButton
              type="button"
              className="btn btn-primary btn-sm"
              busy={isCreatingDeck}
              onClick={handleCreateAndSelect}
              disabled={!newDeckName.trim()}
            >
              Create & Save
            </SpinnerButton>
          </div>
        )}
        <InlineNotice notice={createError} onDismiss={() => setCreateError(null)} className="chat-modal-notice" />
      </div>
    </div>
  );
}
