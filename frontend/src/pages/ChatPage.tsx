import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { LiveCallBanner } from '../components/calls/CallBanner';
import { useParams, Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { chatBackTarget } from '../components/chat/chatBack';
import { base64ToBlob, getTTSWithCache } from '../services/ttsCache';
import { speakWithBrowserTTS } from '../services/audioCache';
import { readConversationVoices } from '../services/conversationVoices';
import { chatReadAloudSpeed, chatReadAloudVoice, parseVoiceGender } from '@shared/chats/voice';
import { createAudioPlayer } from '../utils/audioPlayback';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getRelationship,
  generateResponseOptions,
  createNote,
  createConversation,
  getAIResponse,
  checkMessage,
  updateConversationVoiceSettings,
  updateConversationTitle,
  getConversations,
  markNotificationsReadByConversation,
  toggleMessageReaction,
  translateMessageSegmented,
  coachSentence,
} from '../api/client';
import type { VocabularyDefinition } from '../api/client';
import {
  MessageWithSender,
  getOtherUserInRelationship,
  getMyRoleInRelationship,
  MINIMAX_VOICES,
  GeneratedNoteWithContext,
  CheckMessageResponse,
  CLAUDE_AI_USER_ID,
} from '../types';
import { InteractiveMessage } from '../components/InteractiveMessage';
import { Loading, ErrorMessage } from '../components/Loading';
import { MessageDiscussionModal } from '../components/MessageDiscussionModal';
import { MessageMenu, type MenuAnchor } from '../components/chat/MessageMenu';
import { looksLikeChinese } from '../components/chat/messageTools';
import { messageMenu, menuText, type MenuActionId } from '@shared/chats/messageMenu';
import { firstLink, layoutBubbles, type BubbleLayout } from '@shared/chats/bubbles';
import { ExplainSheet } from '../components/chat/ExplainSheet';
import { LinkPreviewCard } from '../components/chat/LinkPreviewCard';
import { FileBubble } from '../components/chat/FileBubble';
import { VideoBubble } from '../components/chat/VideoBubble';
import { ForwardSheet, type ForwardTarget } from '../components/chat/ForwardSheet';
import { MessageInfoSheet } from '../components/chat/MessageInfoSheet';
import { newClientId } from '../services/chatOutbox';
import { loadDraft, queueLabel, saveDraft } from '../services/chatDrafts';
import { createCall } from '../api/calls';
import { InlineNotice, describeError } from '../components/chat/InlineNotice';
import type { Notice } from '../components/chat/InlineNotice';
import { SpinnerButton } from '../components/chat/SpinnerButton';
import { ChatNotifyNudge } from '../components/chat/ChatNotifyNudge';
import { newestCreatedAt, useChatReadMarker } from '../services/chatNotifications';
import { useAuth } from '../contexts/AuthContext';
import { useNetwork } from '../contexts/NetworkContext';
import { OfflineWarning } from '../components/OfflineWarning';
import { DeckSelectorWithCreate } from '../components/chat/DeckSelectors';
import { FULL_EMOJI_LIST, getQuickEmojis, getRecentEmojis, saveRecentEmoji } from '../components/chat/emojis';
import { attachmentLabel, useChatThread, type ChatMessage } from '../hooks/useChatThread';
import { useChatScroll } from '../hooks/useChatScroll';
import { firstUnreadId, shouldSendTyping } from '../services/chatThread';
import { compressPhoto, fileProblem, videoInfo, VIDEO_MAX_BYTES } from '../services/chatMedia';
import { searchMessages } from '@shared/chats/search';
import { HIDE_ALL_SINCE, shouldHideMessage, sinceWhenTurnedOn } from '@shared/chats/listening';
import {
  prefetchMessageClips,
  refreshChatListening,
  revealMessage,
  setConversationListening,
  toListeningMessage,
  useChatListening,
  useRevealed,
} from '../services/chatListening';
import { ListeningBubble, useListeningPlayer } from '../components/chat/ListeningBubble';
import { editChatMessage, deleteChatMessage, pinChatMessage, setMessageCorrection, clearMessageCorrection, forwardChatMessage } from '../api/chat';
import { ChatWordsText, type TappedWord } from '../components/chat/ChatWords';
import { CorrectionBlock, CorrectMessageSheet } from '../components/chat/ChatCorrection';
import { MakeFlashcardsSheet } from '../components/chat/MakeFlashcardsSheet';
import { CheckDraftPanel, type DraftCheck } from '../components/chat/CheckDraftPanel';
import { ReaderWordSheet } from '../components/reader/ReaderWordSheet';
import { useKnownHanzi } from '../components/reader/ReaderWords';
import { useLazyMessageWords } from '../hooks/useLazyMessageWords';
import {
  isShown,
  loadDisplayPrefs,
  saveDisplayPrefs,
  setShownForAll,
  toggleShown,
  usableWords,
  wordsTextOf,
  type ChatDisplayPrefs,
  type DisplayKind,
  type FlashcardScope,
} from '../services/chatLearning';
import { PhotoBubble, PhotoViewer } from '../components/chat/PhotoBubble';
import { VoiceBubble } from '../components/chat/VoiceBubble';
import { VoiceComposer, type VoiceCommand } from '../components/chat/VoiceComposer';
import { PhotoComposeSheet } from '../components/chat/PhotoComposeSheet';
import { PinnedBar } from '../components/chat/PinnedBar';
import { ChatSearchBar } from '../components/chat/ChatSearchBar';
import { track, trackError } from '../services/analytics';
import {
  ConfirmDeleteSheet,
  EditMessageSheet,
  NewMessagesPill,
  OutboxState,
  TypingIndicator,
} from '../components/chat/ChatBits';
import './ChatPage.css';
import '../components/chat/chat-rich.css';
import '../components/chat/chat-learning.css';
import '../components/chat/chat-signal.css';
import '../components/chat/chat-listening.css';

const LONG_PRESS_MS = 500;

export function ChatPage() {
  const { relId, convId } = useParams<{ relId: string; convId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Opened from the Chats tab → back returns to the inbox, else to the person's page.
  const backTo = chatBackTarget(location.state, relId);
  const { user } = useAuth();
  const { isOnline } = useNetwork();
  const queryClient = useQueryClient();

  // `?new=1` (or `/chat/new`) opens a fresh, untitled conversation for the
  // relationship and replaces the URL with the new conversation's id.
  const wantsNew = searchParams.get('new') === '1' || convId === 'new';
  const creatingRef = useRef(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [newMessage, setNewMessage] = useState(() => loadDraft(convId));
  // The draft follows the conversation (round 2 PR 3): restored on open, kept as it changes.
  const draftConv = useRef(convId);
  useEffect(() => {
    if (draftConv.current === convId) return;
    draftConv.current = convId;
    setNewMessage(loadDraft(convId));
  }, [convId]);
  useEffect(() => {
    if (draftConv.current === convId) saveDraft(convId, newMessage);
  }, [convId, newMessage]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Rich messages (docs/CHAT.md PR 2)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<Array<{ blob: Blob; width: number; height: number }> | null>(null);
  // Forward (message ids, oldest first) / Message info (round 2 PR 3).
  const [forwarding, setForwarding] = useState<string[] | null>(null);
  const [infoFor, setInfoFor] = useState<ChatMessage | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  // Voice: 'held' while the finger is on the mic, 'locked' once slid up (or tapped open).
  const [recording, setRecording] = useState<false | 'held' | 'locked'>(false);
  const [voiceCmd, setVoiceCmd] = useState<VoiceCommand | null>(null);
  const [dragX, setDragX] = useState(0);
  const micPress = useRef<{ x: number; y: number; at: number; id: number } | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // Explain / Save as flashcard (docs/CHAT.md "Round 2").
  const [explain, setExplain] = useState<{ text: string; mode: 'explain' | 'save' } | null>(null);
  // Bubbles whose time was tapped open (the last of a group always shows it).
  const [shownTimes, setShownTimes] = useState<Set<string>>(new Set());
  // Swipe right to reply (touch).
  const swipe = useRef<{ id: string; x: number; y: number; dx: number; locked: 'h' | 'v' | null; buzzed: boolean } | null>(null);
  const [swipeState, setSwipeState] = useState<{ id: string; dx: number } | null>(null);
  const [callBusy, setCallBusy] = useState(false);
  const [viewer, setViewer] = useState<{ url: string; caption: string | null } | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ChatMessage | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  // Learning tools (docs/CHAT.md PR 3)
  const [displayPrefs, setDisplayPrefs] = useState<ChatDisplayPrefs>(() => loadDisplayPrefs(convId || ''));
  const [tappedWord, setTappedWord] = useState<TappedWord | null>(null);
  const [knownVersion, setKnownVersion] = useState(0);
  const known = useKnownHanzi(knownVersion);
  const [fetchedTranslations, setFetchedTranslations] = useState<Map<string, string | null>>(new Map());
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cardScope, setCardScope] = useState<FlashcardScope | null>(null);
  const [correcting, setCorrecting] = useState<ChatMessage | null>(null);
  const [correctBusy, setCorrectBusy] = useState(false);
  const [correctError, setCorrectError] = useState<string | null>(null);
  const [draftCheck, setDraftCheck] = useState<DraftCheck | null>(null);

  // Inline notices: one under the composer, one inside whichever modal is open.
  const [notice, setNotice] = useState<Notice | null>(null);
  const [modalNotice, setModalNotice] = useState<Notice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const clearModalNotice = useCallback(() => setModalNotice(null), []);
  const showError = (fallback: string, error: unknown) => {
    trackError('chat', error);
    setNotice({ kind: 'error', text: describeError(error, fallback) });
  };
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
  const [sheet, setSheet] = useState<{ message: ChatMessage; anchor: MenuAnchor; emojiFirst?: boolean } | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const pressFiredAt = useRef(0);

  // Reset state when conversation changes
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchIndex(0);
    setRecording(false);
    setPendingPhotos(null);
    setForwarding(null);
    setInfoFor(null);
    setCheckResults(new Map());
    setWordByWord(new Set());
    setDisplayPrefs(loadDisplayPrefs(convId || ''));
    setFetchedTranslations(new Map());
    setSelecting(false);
    setSelectedIds(new Set());
    setCardScope(null);
    setDraftCheck(null);
    setNotice(null);
    setSheet(null);
    setShowHeaderMenu(false);
    setExplain(null);
    setShownTimes(new Set());
    setAttachOpen(false);
    setEmojiOpen(false);
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
        navigate(`/connections/${relId}/chat/${conv.id}`, { replace: true, state: location.state });
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

  const me = useMemo(
    () => (user ? { id: user.id, name: user.name ?? null, picture_url: user.picture_url ?? null } : null),
    [user],
  );
  const myId = user?.id ?? '';

  // Claude's practice chat answers each message of mine once the server has it.
  const askAI = async () => {
    setIsWaitingForAI(true);
    try {
      const response = await getAIResponse(convId!);
      thread.applyMessage(response.message);
      if (response.audio_base64 && response.audio_content_type) {
        playBase64Audio(response.audio_base64, response.audio_content_type, response.message.id);
      }
    } catch (error) {
      console.error('Failed to get AI response:', error);
      showError("Claude couldn't reply. Your message was sent — try sending another to retry.", error);
    } finally {
      setIsWaitingForAI(false);
    }
  };
  const askAIRef = useRef(askAI);
  askAIRef.current = askAI;

  const thread = useChatThread(wantsNew ? undefined : convId, me, {
    onDelivered: () => {
      if (isAIConversation) void askAIRef.current();
    },
  });
  const messages = thread.messages;
  const serverMessages = thread.serverMessages;

  // Open + visible: close this chat's notifications and move the read marker (docs/CHAT.md).
  useChatReadMarker(wantsNew ? undefined : convId, newestCreatedAt(serverMessages));

  const otherUserForTyping = relationshipQuery.data && user ? getOtherUserInRelationship(relationshipQuery.data, user.id) : null;
  const dividerId = useMemo(
    () => (isAIConversation ? null : firstUnreadId(serverMessages, myId, thread.readMarkerAtOpen)),
    // The divider stays where it was when the chat opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [thread.openedAt, isAIConversation, myId, thread.readMarkerAtOpen, serverMessages.length > 0],
  );
  // ----- Listening mode (docs/CHAT.md "Listening mode") -----
  // Chats with a person only: Claude role-play replies are spoken already (as in the Lab app).
  const listeningRaw = useChatListening(wantsNew ? undefined : convId);
  const listening = isAIConversation ? { ...listeningRaw, setting: { on: false, since: null } } : listeningRaw;
  const revealed = useRevealed(wantsNew ? undefined : convId);
  const listenPlayer = useListeningPlayer((m) => setNotice({ kind: 'error', text: m }));
  const readAloudParamsRef = useRef(readAloudParams);
  readAloudParamsRef.current = readAloudParams;
  const [revealingId, setRevealingId] = useState<string | null>(null);
  // While undecided (the Settings default, never opened since): what was unread when the chat opened hides.
  const listeningMarker = thread.openedAt !== null ? thread.readMarkerAtOpen : thread.readState.me;
  const isHidden = (msg: ChatMessage): boolean =>
    !msg.outbox &&
    shouldHideMessage(toListeningMessage(msg), { viewerId: myId, setting: listening.setting, readMarkerAtOpen: listeningMarker, revealed });
  useEffect(() => {
    void refreshChatListening();
  }, [convId]);
  useEffect(() => {
    // Store the undecided choice once, so every device hides the same messages.
    if (!convId || wantsNew || !listening.setting.on || listening.decided || thread.openedAt === null) return;
    void setConversationListening(convId, true, thread.readMarkerAtOpen ?? HIDE_ALL_SINCE);
  }, [convId, wantsNew, listening.setting.on, listening.decided, thread.openedAt, thread.readMarkerAtOpen]);
  useEffect(() => {
    // Clips ready before a tap: on open, and as messages arrive.
    if (!myId || serverMessages.length === 0 || isAIConversation) return;
    // A little later than the send, so the server's pre-generated clip is usually there already.
    const t = window.setTimeout(() => void prefetchMessageClips(serverMessages, myId, readAloudParamsRef.current), 2500);
    return () => window.clearTimeout(t);
  }, [serverMessages, myId]);
  const toggleListening = () => {
    if (!convId) return;
    const turnOn = !listening.setting.on;
    void setConversationListening(convId, turnOn, turnOn ? sinceWhenTurnedOn(serverMessages, new Date().toISOString()) : listening.setting.since);
    if (!turnOn) listenPlayer.stop();
  };
  const hideAll = () => {
    if (convId) void setConversationListening(convId, true, HIDE_ALL_SINCE);
  };
  const reveal = (msg: ChatMessage) => {
    if (!convId) return;
    navigator.vibrate?.(18);
    if (listenPlayer.playingId === msg.id) listenPlayer.stop();
    setRevealingId(msg.id);
    revealMessage(convId, msg.id);
    window.setTimeout(() => setRevealingId((id) => (id === msg.id ? null : id)), 420);
  };

  const showTyping = thread.otherTyping && !isAIConversation;

  // Analytics: chat.open once per conversation, when the first load has the read marker.
  const openTrackedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!convId || thread.openedAt === null || !conversation || openTrackedRef.current === convId) return;
    openTrackedRef.current = convId;
    const marker = thread.readMarkerAtOpen;
    const unread = serverMessages.filter((m) => m.sender_id !== myId && (!marker || m.created_at > marker)).length;
    track('chat.open', { is_ai: isAIConversation, unread });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId, thread.openedAt, conversation]);
  const trackSend = (kind: 'text' | 'image' | 'voice' | 'file' | 'video') =>
    track('chat.send', { kind, is_ai: isAIConversation, reply: !!replyingTo, offline: !isOnline });
  const scroll = useChatScroll({
    messages,
    myId,
    ready: thread.openedAt !== null,
    dividerId,
    resetKey: convId,
    followKey: `${showTyping}-${isWaitingForAI}`,
  });

  // Search inside the chat (shared rules: shared/chats/search.ts).
  const searchHits = useMemo(
    () => (searchOpen && searchQuery.trim() ? searchMessages(serverMessages, searchQuery) : []),
    [searchOpen, searchQuery, serverMessages],
  );
  const currentHit = searchHits.length ? searchHits[Math.min(searchIndex, searchHits.length - 1)] : null;
  useEffect(() => {
    if (currentHit) scroll.jumpTo(currentHit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHit]);

  const pinned = useMemo(
    () =>
      serverMessages
        .filter((m) => m.pinned_at && !m.deleted_at)
        .sort((a, b) => ((a.pinned_at || '') < (b.pinned_at || '') ? 1 : -1)),
    [serverMessages],
  );

  // Word chips for older messages: asked for once they scroll into view (docs/CHAT.md PR 3).
  const serverMessagesRef = useRef(serverMessages);
  serverMessagesRef.current = serverMessages;
  useLazyMessageWords(scroll.containerRef, serverMessages, isOnline && thread.openedAt !== null, (id, words, source) => {
    const m = serverMessagesRef.current.find((x) => x.id === id);
    if (m) thread.applyMessage({ ...m, words, words_source: source });
  });

  // Pinyin / translation toggles, remembered per conversation on this device.
  const updateDisplay = (fn: (p: ChatDisplayPrefs) => ChatDisplayPrefs) => {
    setDisplayPrefs((prev) => {
      const next = fn(prev);
      if (convId) saveDisplayPrefs(convId, next);
      return next;
    });
  };

  const translationOf = (msg: MessageWithSender): string | null => {
    if (msg.attachment?.kind === 'voice') return msg.attachment.translation || null;
    return msg.translation || fetchedTranslations.get(msg.id) || null;
  };

  // A text message without a stored translation gets one on demand (the server caches it).
  const ensureTranslation = (msg: MessageWithSender) => {
    if (msg.attachment || msg.translation || fetchedTranslations.has(msg.id)) return;
    setFetchedTranslations((prev) => new Map(prev).set(msg.id, null));
    translateMessageSegmented(msg.id)
      .then((r) => setFetchedTranslations((prev) => new Map(prev).set(msg.id, r.translation || '')))
      .catch((error) => {
        setFetchedTranslations((prev) => {
          const next = new Map(prev);
          next.delete(msg.id);
          return next;
        });
        // Don't leave "Translating…" spinning: switch it back off for this message.
        updateDisplay((p) => (isShown(p, 'translate', msg.id) && !p.translateAll ? toggleShown(p, 'translate', msg.id) : p));
        showError("Couldn't translate that message.", error);
      });
  };

  const toggleDisplay = (msg: MessageWithSender, kind: DisplayKind) => {
    const turningOn = !isShown(displayPrefs, kind, msg.id);
    if (kind === 'translate' && turningOn) ensureTranslation(msg);
    updateDisplay((p) => toggleShown(p, kind, msg.id));
  };

  const setDisplayForAll = (kind: DisplayKind, on: boolean) => updateDisplay((p) => setShownForAll(p, kind, on));

  // With "translations for all" on, fetch the visible ones that are missing (online only).
  useEffect(() => {
    if (!displayPrefs.translateAll || !isOnline) return;
    const missing = serverMessages.filter(
      (m) => !m.deleted_at && !m.attachment && !m.translation && !fetchedTranslations.has(m.id) && looksLikeChinese(m.content) && m.sender_id !== myId,
    );
    for (const m of missing.slice(-10)) ensureTranslation(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayPrefs.translateAll, isOnline, serverMessages.length]);

  // Typing frames: at most every 2.5 s while the box is non-empty and changing.
  const lastTypingSent = useRef(0);
  const noteTyping = (text: string) => {
    if (isAIConversation) return;
    const now = Date.now();
    if (shouldSendTyping(text, lastTypingSent.current, now)) {
      lastTypingSent.current = now;
      thread.sendTyping();
    }
  };

  const resetInputHeight = () => {
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = newMessage.trim();
    if (!text || isWaitingForAI || !convId) return;
    setNotice(null);
    setDraftCheck(null);
    trackSend('text');
    void thread.sendText(text, replyingTo).catch((error) => showError("Couldn't queue your message.", error));
    setNewMessage('');
    setReplyingTo(null);
    lastTypingSent.current = 0;
    resetInputHeight();
  };

  // Photos: pick one or several → compress on the device → caption sheet → outbox (one message each).
  const handlePhotoPicked = async (files: FileList | null | undefined) => {
    const list = files ? Array.from(files).slice(0, 10) : [];
    if (!list.length) return;
    setNotice(null);
    setPreparingPhoto(true);
    try {
      const done: Array<{ blob: Blob; width: number; height: number }> = [];
      for (const f of list) done.push(await compressPhoto(f));
      setPendingPhotos(done);
      if (files && files.length > 10) setNotice({ kind: 'info', text: 'Up to 10 photos at a time — the first 10 are ready to send.' });
    } catch (error) {
      showError("Couldn't read that picture.", error);
    } finally {
      setPreparingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  const sendPhoto = (caption: string) => {
    if (!pendingPhotos?.length) return;
    trackSend('image');
    pendingPhotos.forEach((p, i) => {
      void thread
        .sendMedia({ kind: 'image', blob: p.blob, width: p.width, height: p.height, caption: i === 0 ? caption : '', replyTo: i === 0 ? replyingTo : null })
        .catch((error) => showError("Couldn't queue the photo.", error));
    });
    setPendingPhotos(null);
    setReplyingTo(null);
  };

  // A document (PDF, Office, text, zip…) goes straight to the outbox.
  const handleDocPicked = (file: File | undefined) => {
    if (docInputRef.current) docInputRef.current.value = '';
    if (!file) return;
    const problem = fileProblem(file);
    if (problem) {
      setNotice({ kind: 'error', text: problem });
      return;
    }
    setNotice(null);
    trackSend('file');
    void thread
      .sendMedia({ kind: 'file', blob: file, name: file.name, replyTo: replyingTo })
      .catch((error) => showError("Couldn't queue the file.", error));
    setReplyingTo(null);
  };

  // A short video clip (≤ 25 MB): its length and shape are read on the device.
  const handleVideoPicked = async (file: File | undefined) => {
    if (videoInputRef.current) videoInputRef.current.value = '';
    if (!file) return;
    if (file.size > VIDEO_MAX_BYTES) {
      setNotice({ kind: 'error', text: 'Video clips can be at most 25 MB — trim it or send a shorter one.' });
      return;
    }
    setNotice(null);
    const info = await videoInfo(file);
    trackSend('video');
    void thread
      .sendMedia({ kind: 'video', blob: file, width: info.width ?? undefined, height: info.height ?? undefined, duration_ms: info.duration_ms ?? undefined, replyTo: replyingTo })
      .catch((error) => showError("Couldn't queue the video.", error));
    setReplyingTo(null);
  };

  // Forward: each message as a forwarded copy into the chosen conversation, in order.
  const doForward = async (ids: string[], target: ForwardTarget) => {
    setForwarding(null);
    stopSelecting();
    let sent = 0;
    for (const id of ids) {
      try {
        await forwardChatMessage(id, target.conversationId, newClientId());
        sent++;
      } catch (error) {
        showError(sent ? `Forwarded ${sent} of ${ids.length}.` : "Couldn't forward that.", error);
        return;
      }
    }
    if (target.conversationId === convId) void thread.pollNow();
    track('chat.forward', { kind: serverMessages.find((m) => m.id === ids[0])?.attachment?.kind ?? 'text' });
    showSuccess(`Forwarded ${sent === 1 ? 'the message' : `${sent} messages`} to ${target.label}${target.sub ? ` · ${target.sub}` : ''}.`);
  };

  const sendVoice = (blob: Blob, durationMs: number) => {
    setRecording(false);
    trackSend('voice');
    void thread
      .sendMedia({ kind: 'voice', blob, duration_ms: durationMs, replyTo: replyingTo })
      .catch((error) => showError("Couldn't queue the voice message.", error));
    setReplyingTo(null);
  };

  // Edit / delete / pin: shown at once, the server's copy replaces it.
  const isMessageWithSender = (m: unknown): m is MessageWithSender => !!m && typeof (m as { id?: unknown }).id === 'string';

  const saveEdit = async (text: string) => {
    if (!editing) return;
    const msg = editing;
    setEditBusy(true);
    setEditError(null);
    try {
      const updated = await editChatMessage(msg.id, text);
      thread.applyMessage(isMessageWithSender(updated) ? updated : { ...msg, content: text, edited_at: new Date().toISOString() });
      setEditing(null);
      void thread.pollNow();
    } catch (error) {
      setEditError(describeError(error, "Couldn't save the edit."));
    } finally {
      setEditBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const msg = deleting;
    setDeleteBusy(true);
    try {
      const res = await deleteChatMessage(msg.id);
      thread.applyMessage(
        isMessageWithSender(res) ? res : { ...msg, content: '', attachment: null, media_url: null, deleted_at: new Date().toISOString() },
      );
      setDeleting(null);
      void thread.pollNow();
    } catch (error) {
      setDeleting(null);
      showError("Couldn't delete the message.", error);
    } finally {
      setDeleteBusy(false);
    }
  };

  const togglePin = async (msg: MessageWithSender) => {
    const pinnedNow = !msg.pinned_at;
    try {
      const res = await pinChatMessage(msg.id, pinnedNow);
      thread.applyMessage(
        isMessageWithSender(res)
          ? res
          : { ...msg, pinned_at: pinnedNow ? new Date().toISOString() : null, pinned_by: pinnedNow ? myId : null },
      );
      void thread.pollNow();
    } catch (error) {
      showError(pinnedNow ? "Couldn't pin the message." : "Couldn't unpin the message.", error);
    }
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    setSheet(null);
    saveRecentEmoji(emoji);
    try {
      await toggleMessageReaction(messageId, emoji);
      track('chat.reaction');
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

  /**
   * The voice a message is read in (shared/chats/voice.ts): the sender's voice_gender over MY
   * conversation voices; Claude's lines in a role-play keep the persona voice. Cache-first by
   * (text, voice, speed), so a message plays offline once heard. Read aloud and listening mode's tap.
   */
  function readAloudParams(msg: Pick<MessageWithSender, 'sender_id'>) {
    const fromAi = isAIConversation && msg.sender_id === CLAUDE_AI_USER_ID;
    const rel = relationshipQuery.data;
    const sender = msg.sender_id === user?.id ? user : rel && user ? getOtherUserInRelationship(rel, user.id) : null;
    const senderGender = fromAi ? null : parseVoiceGender(sender && sender.id === msg.sender_id ? sender.voice_gender : null);
    const voice = chatReadAloudVoice({ senderGender, enabled: readConversationVoices(), fromAi, personaVoice: conversation?.voice_id });
    const speed = chatReadAloudSpeed({ fromAi, personaSpeed: conversation?.voice_speed });
    return { voice, speed, senderGender };
  }

  const handlePlayMessageAudio = async (msg: MessageWithSender) => {
    if (playingAudioMessageId === msg.id) {
      // Stop playing
      playerRef.current.stop();
      setPlayingAudioMessageId(null);
      return;
    }

    setPlayingAudioMessageId(msg.id);
    const { voice, speed, senderGender } = readAloudParams(msg);
    try {
      const blob = await getTTSWithCache(msg.content, speed, voice);
      if (blob) {
        playerRef.current.play(blob, {
          onEnded: () => setPlayingAudioMessageId(null),
          onError: () => setPlayingAudioMessageId(null),
        });
        return;
      }
      if (navigator.onLine) throw new Error('No audio came back');
      // Offline and never fetched: a Mandarin device voice of the sender's gender.
      await speakWithBrowserTTS(msg.content, senderGender === 'other' ? null : senderGender);
      setPlayingAudioMessageId(null);
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

  // ----- Make flashcards from this chat (docs/CHAT.md PR 3) -----
  const startSelecting = (firstId?: string) => {
    setShowHeaderMenu(false);
    setSearchOpen(false);
    setSelectedIds(new Set(firstId ? [firstId] : []));
    setSelecting(true);
    setNotice(null);
  };

  const stopSelecting = () => {
    setSelecting(false);
    setSelectedIds(new Set());
  };

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openCards = (scope: FlashcardScope) => {
    setSelecting(false);
    setCardScope(scope);
  };

  const messageTextFor = (id: string): string | null => {
    const m = serverMessages.find((x) => x.id === id);
    if (!m || m.deleted_at) return null;
    return wordsTextOf(m)?.text ?? (m.content || null);
  };

  // ----- Corrections (the tutor) -----
  const saveCorrection = async (text: string, note: string) => {
    if (!correcting) return;
    const msg = correcting;
    setCorrectBusy(true);
    setCorrectError(null);
    try {
      const updated = await setMessageCorrection(msg.id, text, note || null);
      thread.applyMessage(
        isMessageWithSender(updated)
          ? updated
          : { ...msg, correction: { text, note: note || null, by: myId, at: new Date().toISOString() } },
      );
      setCorrecting(null);
      track('chat.correction');
      void thread.pollNow();
    } catch (error) {
      trackError('chat_correction', error);
      setCorrectError(describeError(error, "Couldn't save the correction."));
    } finally {
      setCorrectBusy(false);
    }
  };

  const removeCorrection = async (msg: MessageWithSender) => {
    try {
      const updated = await clearMessageCorrection(msg.id);
      thread.applyMessage(isMessageWithSender(updated) ? updated : { ...msg, correction: null });
      void thread.pollNow();
    } catch (error) {
      showError("Couldn't remove the correction.", error);
    }
  };

  // ----- Check my Chinese before sending -----
  const runDraftCheck = async (draft: string) => {
    if (!isOnline) {
      setDraftCheck({ kind: 'error', draft, text: 'Checking needs a connection — you can still send it as is.' });
      return;
    }
    setDraftCheck({ kind: 'loading', draft });
    track('chat.check_draft');
    try {
      const result = await coachSentence(draft);
      setDraftCheck((cur) => (cur && cur.draft === draft ? { kind: 'ready', draft, result } : cur));
    } catch (error) {
      setDraftCheck((cur) =>
        cur && cur.draft === draft ? { kind: 'error', draft, text: describeError(error, "Couldn't check that just now.") } : cur,
      );
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

  // ----- The message menu (docs/CHAT.md "Round 2") -----
  const openSheet = (message: ChatMessage, anchor: MenuAnchor, emojiFirst = false) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator && !anchor) navigator.vibrate?.(12);
    setSheet({ message, anchor, emojiFirst });
  };

  const clearPress = () => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressStart.current = null;
  };

  const startPress = (msg: ChatMessage, hidden = false) => (e: React.PointerEvent<HTMLElement>) => {
    // Long-press is for touch / pen; a mouse right-clicks (or uses the hover ⋯).
    if (e.pointerType === 'mouse') return;
    clearPress();
    pressStart.current = { x: e.clientX, y: e.clientY };
    if (!selecting) {
      swipe.current = { id: msg.id, x: e.clientX, y: e.clientY, dx: 0, locked: null, buzzed: false };
    }
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      pressFiredAt.current = Date.now();
      swipe.current = null;
      setSwipeState(null);
      // Listening mode: a long press on a hidden message reveals it (no menu until then).
      if (hidden) reveal(msg);
      else openSheet(msg, null);
    }, LONG_PRESS_MS);
  };

  const SWIPE_MAX = 72;
  const SWIPE_REPLY = 56;

  const movePress = (e: React.PointerEvent<HTMLElement>) => {
    if (pressStart.current && (Math.abs(e.clientX - pressStart.current.x) > 10 || Math.abs(e.clientY - pressStart.current.y) > 10)) {
      clearPress();
    }
    const sw = swipe.current;
    if (!sw) return;
    const dx = e.clientX - sw.x;
    const dy = e.clientY - sw.y;
    if (!sw.locked && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) sw.locked = Math.abs(dx) > Math.abs(dy) && dx > 0 ? 'h' : 'v';
    if (sw.locked !== 'h') return;
    sw.dx = Math.max(0, Math.min(SWIPE_MAX, dx));
    if (sw.dx >= SWIPE_REPLY && !sw.buzzed) {
      sw.buzzed = true;
      navigator.vibrate?.(10);
    }
    setSwipeState({ id: sw.id, dx: sw.dx });
  };

  const endPress = (msg: ChatMessage) => () => {
    clearPress();
    const sw = swipe.current;
    swipe.current = null;
    if (sw && sw.locked === 'h' && sw.dx >= SWIPE_REPLY) {
      setReplyingTo(msg);
      inputRef.current?.focus();
    }
    setSwipeState(null);
  };

  const toggleTime = (id: string) =>
    setShownTimes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleSheetAction = (id: MenuActionId) => {
    if (!sheet) return;
    const msg = sheet.message;
    setSheet(null);
    track('chat.menu_action', { action: id, kind: msg.attachment?.kind ?? 'text' });
    switch (id) {
      case 'reply':
        setReplyingTo(msg);
        inputRef.current?.focus();
        break;
      case 'copy':
        void handleCopy(msg);
        break;
      case 'translate':
        toggleDisplay(msg, 'translate');
        break;
      case 'pinyin':
        toggleDisplay(msg, 'pinyin');
        break;
      case 'explain':
        setExplain({ text: menuText(msg), mode: 'explain' });
        break;
      case 'save_card':
        setExplain({ text: menuText(msg), mode: 'save' });
        break;
      case 'forward':
        setForwarding([msg.id]);
        break;
      case 'info':
        setInfoFor(msg);
        break;
      case 'select_cards':
      case 'select':
        startSelecting(msg.id);
        break;
      case 'play':
        void handlePlayMessageAudio(msg);
        break;
      case 'check':
        void handleCheckMessage(msg);
        break;
      case 'view_corrections':
        openCheckResult(msg);
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
        track('chat.discuss');
        setDiscussingMessage(msg);
        break;
      case 'pin':
      case 'unpin':
        void togglePin(msg);
        break;
      case 'edit':
        setEditError(null);
        setEditing(msg);
        break;
      case 'delete':
        setDeleting(msg);
        break;
      case 'correction_card':
        openCards({ kind: 'correction', id: msg.id });
        break;
      case 'correct':
        setCorrectError(null);
        setCorrecting(msg);
        break;
      case 'remove_correction':
        void removeCorrection(msg);
        break;
    }
  };

  // Copy the selected messages (selection mode's bar), oldest first.
  const copySelected = async () => {
    const text = serverMessages
      .filter((m) => selectedIds.has(m.id))
      .map((m) => menuText(m))
      .filter(Boolean)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showSuccess(selectedIds.size === 1 ? 'Copied.' : `Copied ${selectedIds.size} messages.`);
      stopSelecting();
    } catch (error) {
      showError("Couldn't copy to the clipboard.", error);
    }
  };

  const handleVideoCall = async () => {
    if (!relId || callBusy) return;
    setCallBusy(true);
    try {
      const { call } = await createCall({ relationship_id: relId });
      track('call.start', { solo: false });
      navigate(`/calls/${call.id}`);
    } catch (error) {
      showError("Couldn't start the call.", error);
      setCallBusy(false);
    }
  };

  // ----- The mic: hold to record, slide left to cancel, slide up to lock -----
  const MIC_CANCEL_PX = 100;
  const MIC_LOCK_PX = 80;
  const MIC_MIN_HOLD_MS = 350;

  const micDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    micPress.current = { x: e.clientX, y: e.clientY, at: Date.now(), id: e.pointerId };
    setNotice(null);
    setDragX(0);
    setVoiceCmd(null);
    setRecording('held');
    navigator.vibrate?.(15);
  };

  const micMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = micPress.current;
    if (!p || recording !== 'held') return;
    const dx = Math.min(0, e.clientX - p.x);
    const dy = e.clientY - p.y;
    setDragX(dx);
    if (dx <= -MIC_CANCEL_PX) {
      micPress.current = null;
      setVoiceCmd({ action: 'cancel', seq: Date.now() });
      navigator.vibrate?.([10, 40, 10]);
    } else if (dy <= -MIC_LOCK_PX) {
      micPress.current = null;
      setDragX(0);
      setRecording('locked');
      navigator.vibrate?.(15);
    }
  };

  const micUp = () => {
    const p = micPress.current;
    micPress.current = null;
    if (!p || recording !== 'held') return;
    if (Date.now() - p.at < MIC_MIN_HOLD_MS) {
      setVoiceCmd({ action: 'cancel', seq: Date.now() });
      setNotice({ kind: 'info', text: 'Hold the mic to record, release to send.' });
      return;
    }
    setVoiceCmd({ action: 'send', seq: Date.now() });
  };

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? newMessage.length;
    const end = el?.selectionEnd ?? newMessage.length;
    const next = newMessage.slice(0, start) + emoji + newMessage.slice(end);
    setNewMessage(next);
    saveRecentEmoji(emoji);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = start + emoji.length;
    });
  };

  if (wantsNew) {
    if (createError) {
      return (
        <div className="chat-page">
          <div className="chat-header">
            <Link to={backTo} className="chat-back" aria-label="Back">←</Link>
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

  if (thread.isLoading || relationshipQuery.isLoading) {
    return <Loading />;
  }

  if (thread.error || relationshipQuery.error) {
    return <ErrorMessage message="Failed to load chat" />;
  }

  const relationship = relationshipQuery.data!;
  const otherUser = getOtherUserInRelationship(relationship, user!.id);
  const viewerRole = getMyRoleInRelationship(relationship, user!.id);
  const otherFirstName = (otherUserForTyping?.name || 'They').split(' ')[0];

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

  // Signal-like groups, day separators and ticks (shared/chats/bubbles.ts).
  const offsetMinutes = -new Date().getTimezoneOffset();
  const layouts = layoutBubbles(
    messages.map((m) => ({
      id: m.id,
      sender_id: m.sender_id,
      created_at: m.created_at,
      deleted_at: m.deleted_at,
      pending: m.outbox ? (m.outbox.status === 'failed' ? ('failed' as const) : ('sending' as const)) : null,
    })),
    myId,
    isAIConversation ? null : thread.readState.other,
    offsetMinutes,
  );

  // A message's check status is whatever we learnt locally, else what the server stored.
  const withCheckStatus = <T extends MessageWithSender>(msg: T): T => {
    const local = checkResults.get(msg.id);
    return local ? { ...msg, check_status: local.status } : msg;
  };

  const menuFor = (raw: ChatMessage) => {
    const msg = withCheckStatus(raw);
    return messageMenu(
      {
        sender_id: msg.sender_id,
        content: msg.content,
        deleted_at: msg.deleted_at,
        pending: !!msg.outbox,
        attachment: msg.attachment
          ? {
              kind: msg.attachment.kind,
              transcript: msg.attachment.kind === 'voice' ? msg.attachment.transcript : null,
              translation: msg.attachment.kind === 'voice' ? msg.attachment.translation : null,
            }
          : null,
        translation: translationOf(msg),
        correction: msg.correction,
        check_status: msg.check_status,
        has_discussion: msg.has_discussion,
        pinned_at: msg.pinned_at,
      },
      viewerRole,
      isAIConversation,
      user!.id,
      { pinyinOn: isShown(displayPrefs, 'pinyin', msg.id), translateOn: isShown(displayPrefs, 'translate', msg.id) },
    );
  };

  const isLearner = viewerRole === 'student' || isAIConversation;
  const otherFirst = (otherUser.name || 'Your tutor').split(' ')[0];
  const suppressWordTap = () => selecting || Date.now() - pressFiredAt.current < 800 || !!swipe.current?.locked;

  const chatToolsBlocked = !isOnline;
  const queueText = queueLabel(messages.filter((m) => m.outbox && m.outbox.status !== 'failed').length, isOnline);
  const hitSet = new Set(searchHits);
  const composerEmpty = !newMessage.trim();
  // ✓ "Check my Chinese" on the compose box: the learner, a draft with Chinese (same rule as the menu).
  const canCheckDraft = isLearner && !composerEmpty && looksLikeChinese(newMessage);

  const replyLine = (m: MessageWithSender['reply_to']) => {
    if (!m) return '';
    if (m.deleted_at) return 'Message deleted';
    if (!m.content) return '📎 Attachment';
    return m.content.length > 80 ? m.content.slice(0, 80) + '…' : m.content;
  };

  const renderBody = (msg: ChatMessage, isMe: boolean, hasChinese: boolean, pinyinOn: boolean, translateOn: boolean) => {
    if (msg.deleted_at) {
      return <span className="chat-deleted-text">🚫 Message deleted</span>;
    }
    const att = msg.attachment;
    if (att?.kind === 'image') {
      return (
        <>
          <PhotoBubble
            messageId={msg.id}
            mediaUrl={msg.media_url}
            width={att.width}
            height={att.height}
            localBlob={msg.outbox?.blob}
            onOpen={(url) => setViewer({ url, caption: msg.content || null })}
          />
          {msg.content && (
            <div className="chat-photo-caption">
              <ChatWordsText text={msg.content} words={usableWords(msg)} showPinyin={pinyinOn} known={known} onTapWord={setTappedWord} suppressTap={suppressWordTap} />
            </div>
          )}
        </>
      );
    }
    if (att?.kind === 'file') {
      return (
        <>
          <FileBubble messageId={msg.id} mediaUrl={msg.media_url} name={att.name} bytes={att.bytes} mime={att.mime} localBlob={msg.outbox?.blob} />
          {msg.content && <div className="chat-photo-caption">{msg.content}</div>}
        </>
      );
    }
    if (att?.kind === 'video') {
      return (
        <>
          <VideoBubble messageId={msg.id} mediaUrl={msg.media_url} width={att.width} height={att.height} durationMs={att.duration_ms} localBlob={msg.outbox?.blob} />
          {msg.content && <div className="chat-photo-caption">{msg.content}</div>}
        </>
      );
    }
    if (att?.kind === 'voice') {
      return (
        <VoiceBubble
          messageId={msg.id}
          mediaUrl={msg.media_url}
          durationMs={att.duration_ms}
          localBlob={msg.outbox?.blob}
          transcriptStatus={msg.outbox ? undefined : att.transcript_status}
          transcript={att.transcript}
          translation={att.translation}
          words={usableWords(msg)}
          showPinyin={pinyinOn}
          showTranslation={translateOn}
          known={known}
          onTapWord={setTappedWord}
          suppressTap={suppressWordTap}
        />
      );
    }
    // The Claude practice chat keeps its word-by-word view.
    if (isAIConversation && !isMe && hasChinese && wordByWord.has(msg.id)) {
      return (
        <InteractiveMessage
          message={msg}
          showTranslation
          onSaveWord={handleSaveWordFromChat}
          onError={(text) => setNotice({ kind: 'error', text })}
        />
      );
    }
    const checkStatus = msg.check_status;
    // A video-call invite ("join here: …/calls/<id>") shows a Join button instead of the raw link.
    const callId = /https?:\/\/\S+\/calls\/([A-Za-z0-9_-]{8,})/.exec(msg.content)?.[1];
    const link = callId ? null : firstLink(msg.content);
    return (
      <>
        {callId ? (
          <>
            {msg.content.replace(/\s*(—\s*join here:)?\s*https?:\/\/\S+\/calls\/\S+/, '')}
            <Link to={`/calls/${callId}`} className="chat-call-link" onClick={(e) => e.stopPropagation()}>📹 Join the call</Link>
          </>
        ) : (
          <ChatWordsText
            text={msg.content}
            words={usableWords(msg)}
            showPinyin={pinyinOn}
            known={known}
            onTapWord={setTappedWord}
            suppressTap={suppressWordTap}
          />
        )}
        {link && <LinkPreviewCard url={link} isOnline={isOnline} />}
        {translateOn && (
          <span className="chat-translation" data-testid="chat-translation">
            {translationOf(msg) ?? (
              <span className="chat-translation-pending">
                <span className="chat-spinner" aria-hidden="true" /> Translating…
              </span>
            )}
          </span>
        )}
        {isMe && checkStatus && (
          <button
            type="button"
            className={`check-status ${checkStatus}`}
            onClick={(e) => {
              e.stopPropagation();
              openCheckResult(msg);
            }}
            title={checkStatus === 'correct' ? 'Checked — looks good' : 'View corrections'}
            aria-label={checkStatus === 'correct' ? 'Checked — looks good' : 'View corrections'}
          >
            {checkStatus === 'correct' ? '✓' : '⚠'}
          </button>
        )}
      </>
    );
  };

  const TICK_LABEL: Record<string, string> = { pending: 'Sending', sent: 'Sent', read: 'Seen', failed: 'Not sent' };
  const tickGlyph = (tick: string) => (tick === 'pending' ? '🕓' : tick === 'read' ? '✓✓' : tick === 'sent' ? '✓' : '!');

  const renderMessage = (rawMsg: ChatMessage, layout: BubbleLayout) => {
    const msg = withCheckStatus(rawMsg);
    const isMe = layout.mine;
    const isPlaying = playingAudioMessageId === msg.id;
    const isChecking = checkingMessageId === msg.id;
    const isDeleted = !!msg.deleted_at;
    const pending = msg.outbox;
    const kind = msg.attachment?.kind ?? null;
    const interactive = !pending && !isDeleted;
    const wordsText = isDeleted ? null : wordsTextOf(msg);
    const hasZh = !!wordsText && looksLikeChinese(wordsText.text);
    const pinyinOn = hasZh && isShown(displayPrefs, 'pinyin', msg.id);
    const canTranslate = hasZh && !pending && (kind === 'voice' ? !!translationOf(msg) : kind !== 'image');
    const translateOn = canTranslate && isShown(displayPrefs, 'translate', msg.id);
    const selectable = selecting && interactive && !!wordsText;
    const selected = selectable && selectedIds.has(msg.id);
    const showMeta = layout.lastInGroup || shownTimes.has(msg.id) || !!pending;
    const swipeDx = swipeState?.id === msg.id ? swipeState.dx : 0;
    const hidden = interactive && !selecting && isHidden(rawMsg);
    const classes = [
      'chat-message',
      isMe ? 'sent' : 'received',
      layout.firstInGroup ? 'group-first' : '',
      layout.lastInGroup ? 'group-last' : '',
      selecting ? 'selecting' : '',
      selectable ? 'selectable' : '',
      selected ? 'selected' : '',
      hitSet.has(msg.id) ? 'search-hit' : '',
      currentHit === msg.id ? 'search-current' : '',
      scroll.flashId === msg.id ? 'flash' : '',
      pending ? `outbox-${pending.status}` : '',
      sheet?.message.id === msg.id ? 'menu-open' : '',
      hidden ? 'listening-hidden' : '',
      revealingId === msg.id ? 'listening-revealing' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div key={msg.id}>
        {layout.newDay && (
          <div className="chat-date-divider">
            <span>{formatDate(msg.created_at)}</span>
          </div>
        )}
        {dividerId === msg.id && (
          <div className="chat-unread-divider" data-unread-divider data-testid="chat-unread-divider">
            <span>New messages</span>
          </div>
        )}
        <div
          className={classes}
          data-msg-id={msg.id}
          data-testid="chat-message"
          onClick={selectable ? () => toggleSelected(msg.id) : undefined}
        >
          {selecting && (
            <span className={`chat-select-box${selected ? ' on' : ''}${selectable ? '' : ' hidden'}`} aria-hidden="true">
              {selected ? '✓' : ''}
            </span>
          )}
          {swipeDx > 0 && (
            <span className={`chat-swipe-reply${swipeDx >= SWIPE_REPLY ? ' ready' : ''}`} style={{ opacity: Math.min(1, swipeDx / SWIPE_REPLY) }} aria-hidden="true">
              ↩
            </span>
          )}
          <div className="chat-message-content" style={swipeDx ? { transform: `translateX(${swipeDx}px)` } : undefined}>
            <div className="chat-bubble-row">
              <div
                className={`chat-bubble${isDeleted ? ' deleted' : ''}${kind ? ` has-${kind}` : ''}${kind === 'image' && !msg.content ? ' photo-only' : ''}${hidden ? ' listening' : ''}`}
                onPointerDown={interactive || pending ? startPress(msg, hidden) : undefined}
                onPointerMove={movePress}
                onPointerUp={endPress(msg)}
                onPointerCancel={endPress(msg)}
                onPointerLeave={() => clearPress()}
                onClick={() => {
                  if (selecting || Date.now() - pressFiredAt.current < 800) return;
                  if (pending?.status === 'failed') return;
                  // Listening mode: a tap plays the hidden message (again, from the start).
                  if (hidden) return listenPlayer.play(msg, readAloudParams(msg));
                  toggleTime(msg.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  // A touch long-press also fires contextmenu; it already opened the sheet.
                  if (pressTimer.current || Date.now() - pressFiredAt.current < 1000 || selecting) return;
                  if (hidden) return reveal(msg);
                  if (interactive || pending) openSheet(msg, { x: e.clientX, y: e.clientY });
                }}
                role={hidden ? 'button' : undefined}
                tabIndex={hidden ? 0 : undefined}
                aria-label={hidden ? 'Hidden message. Tap to listen, hold to reveal' : undefined}
                onKeyDown={
                  hidden
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          listenPlayer.play(msg, readAloudParams(msg));
                        }
                      }
                    : undefined
                }
              >
                {msg.reply_to && !isDeleted && (
                  <button
                    type="button"
                    className="reply-preview"
                    onClick={(e) => {
                      e.stopPropagation();
                      scroll.jumpTo(msg.reply_to!.id);
                    }}
                  >
                    <span className="reply-preview-name">{msg.reply_to.sender.id === myId ? 'You' : msg.reply_to.sender.name || 'Unknown'}</span>
                    <span className="reply-preview-text">{replyLine(msg.reply_to)}</span>
                  </button>
                )}
                {msg.forwarded_from && !isDeleted && <span className="chat-forwarded">↪ Forwarded</span>}
                {hidden ? (
                  <ListeningBubble
                    messageId={msg.id}
                    text={msg.content}
                    playing={listenPlayer.playingId === msg.id}
                    loading={listenPlayer.loadingId === msg.id}
                    progress={listenPlayer.playingId === msg.id ? listenPlayer.progress : 0}
                    durationSec={listenPlayer.durations[msg.id] ?? null}
                    slow={listenPlayer.slow}
                    onToggleSlow={listenPlayer.toggleSlow}
                  />
                ) : (
                  renderBody(msg, isMe, hasZh, pinyinOn, translateOn)
                )}
                {showMeta && (
                  <span className="chat-bubble-meta" data-testid="chat-bubble-meta">
                    {msg.pinned_at && !isDeleted && <span className="chat-pinned-mark" title="Pinned">📌</span>}
                    {msg.edited_at && !isDeleted && <span className="chat-edited">edited</span>}
                    <span className="chat-time">{formatTime(msg.created_at)}</span>
                    {layout.tick === 'pending' ? (
                      <span className="chat-tick pending" data-testid="chat-send-pending" aria-label="Sending" title="Sending…">
                        {tickGlyph('pending')}
                      </span>
                    ) : (
                      layout.tick !== 'none' && (
                        <span className={`chat-tick ${layout.tick}`} data-testid="chat-receipt" data-kind={layout.tick} aria-label={TICK_LABEL[layout.tick]} title={TICK_LABEL[layout.tick]}>
                          {tickGlyph(layout.tick)}
                        </span>
                      )
                    )}
                  </span>
                )}
              </div>
              {hidden && (
                <button
                  type="button"
                  className="chat-listening-reveal"
                  onClick={() => reveal(msg)}
                  aria-label="Reveal the message"
                  title="Reveal"
                  data-testid="chat-listening-reveal"
                >
                  👁
                </button>
              )}
              {interactive && !selecting && !hidden && (
                <div className="chat-hover-tools" aria-hidden="false">
                  <button
                    type="button"
                    className="chat-hover-btn"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      openSheet(msg, { x: r.left, y: r.bottom + 4 }, true);
                    }}
                    aria-label="React"
                    title="React"
                  >
                    😊
                  </button>
                  <button
                    type="button"
                    className="chat-hover-btn"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      openSheet(msg, { x: r.left, y: r.bottom + 4 });
                    }}
                    aria-label="More actions"
                    title="More"
                    aria-haspopup="dialog"
                    data-testid="chat-more-btn"
                  >
                    ⋯
                  </button>
                </div>
              )}
            </div>
            {!isDeleted && msg.reactions && msg.reactions.length > 0 && (
              <div className="message-reactions">
                {msg.reactions.map((r) => (
                  <button
                    key={r.emoji}
                    className={`reaction-badge ${r.users.some((u) => u.id === user!.id) ? 'mine' : ''}`}
                    onClick={() => handleReaction(msg.id, r.emoji)}
                    title={r.users.map((u) => u.name || 'Unknown').join(', ')}
                  >
                    {r.emoji}
                    {r.count > 1 ? ` ${r.count}` : ''}
                  </button>
                ))}
              </div>
            )}
            {msg.correction && !isDeleted && (
              <CorrectionBlock
                original={msg.content}
                correction={msg.correction}
                tutorName={isMe ? otherFirst : 'Your correction'}
                canEdit={viewerRole === 'tutor' && !isMe && !isAIConversation && !selecting}
                canMakeCard={isMe && !selecting}
                onEdit={() => {
                  setCorrectError(null);
                  setCorrecting(msg);
                }}
                onRemove={() => void removeCorrection(msg)}
                onMakeCard={() => openCards({ kind: 'correction', id: msg.id })}
              />
            )}
            {pending?.status === 'failed' && (
              <OutboxState status="failed" onRetry={() => thread.retry(pending.client_id)} onDiscard={() => thread.discard(pending.client_id)} />
            )}
            {(isChecking || isPlaying) && (
              <span className="msg-status" role="status">
                {isPlaying ? (
                  <button type="button" className="chat-stop-audio" onClick={() => void handlePlayMessageAudio(msg)}>
                    ⏹ Stop
                  </button>
                ) : (
                  <>
                    <span className="chat-spinner" aria-hidden="true" /> Checking…
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="chat-page">
      {/* Header */}
      <div className="chat-header">
        <Link to={backTo} className="chat-back" aria-label="Back">←</Link>
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
            {showTyping ? (
              <span className="chat-header-title chat-header-typing">typing…</span>
            ) : queueText ? (
              <span className="chat-header-title chat-header-queue" data-testid="chat-queue-status">{queueText}</span>
            ) : listening.setting.on ? (
              <span className="chat-header-title chat-header-listening" data-testid="chat-listening-status">
                🎧 Listening mode{conversation?.title ? ` · ${conversation.title}` : ''}
              </span>
            ) : (
              conversation?.title && <span className="chat-header-title">{conversation.title}</span>
            )}
          </div>
        </div>
        <div className="chat-header-actions">
          <button
            type="button"
            className={`chat-header-icon chat-search-btn${searchOpen ? ' active' : ''}`}
            onClick={() => {
              setSearchOpen((v) => !v);
              setSearchQuery('');
              setSearchIndex(0);
            }}
            aria-label="Search messages"
            aria-pressed={searchOpen}
            title="Search this chat"
          >
            🔍
          </button>
          {!isAIConversation && (
            <button
              type="button"
              className="chat-header-icon"
              onClick={() => void handleVideoCall()}
              disabled={!isOnline || callBusy}
              aria-label="Video call"
              title={isOnline ? 'Video call' : 'Calls need internet'}
            >
              📹
            </button>
          )}
          <button
            type="button"
            className="chat-header-icon chat-menu-btn"
            onClick={() => setShowHeaderMenu((v) => !v)}
            aria-label="Conversation menu"
            aria-haspopup="menu"
            aria-expanded={showHeaderMenu}
          >
            ⋯
          </button>
        </div>
      </div>

      {searchOpen && (
        <ChatSearchBar
          query={searchQuery}
          onQuery={(q) => {
            setSearchQuery(q);
            setSearchIndex(0);
          }}
          count={searchHits.length}
          index={Math.min(searchIndex, Math.max(0, searchHits.length - 1))}
          onOlder={() => setSearchIndex((i) => Math.min(i + 1, Math.max(0, searchHits.length - 1)))}
          onNewer={() => setSearchIndex((i) => Math.max(0, i - 1))}
          onClose={() => {
            if (searchQuery.trim()) track('chat.search', { results: searchHits.length });
            setSearchOpen(false);
            setSearchQuery('');
          }}
        />
      )}

      {selecting ? (
        <div className="chat-select-hint" role="status">
          Tap the messages to make cards from — or pick a quick option below.
        </div>
      ) : (
        !searchOpen && <PinnedBar pinned={pinned} onJump={(id) => scroll.jumpTo(id)} />
      )}

      {!isAIConversation && <ChatNotifyNudge />}

      {relId && (
        <div className="chat-call-banner">
          <LiveCallBanner variant="inline" relationshipId={relId} />
        </div>
      )}

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
            <button
              type="button"
              role="menuitem"
              className="chat-header-menu-item"
              disabled={!isOnline || serverMessages.length === 0}
              onClick={() => startSelecting()}
            >
              <span aria-hidden="true">🃏</span> Make flashcards
              {!isOnline && <span className="msg-sheet-action-hint">Needs internet</span>}
            </button>
            {!isAIConversation && (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={listening.setting.on}
              className="chat-header-menu-item"
              data-testid="chat-listening-toggle"
              onClick={() => {
                setShowHeaderMenu(false);
                toggleListening();
              }}
            >
              <span aria-hidden="true">🎧</span> Listening mode
              <span className={`chat-menu-switch${listening.setting.on ? ' on' : ''}`} aria-hidden="true" />
            </button>
            )}
            {listening.setting.on && (
              <button
                type="button"
                role="menuitem"
                className="chat-header-menu-item"
                data-testid="chat-listening-hide-all"
                onClick={() => {
                  setShowHeaderMenu(false);
                  hideAll();
                }}
              >
                <span aria-hidden="true">🙈</span> Hide all messages
              </button>
            )}
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={displayPrefs.pinyinAll}
              className="chat-header-menu-item"
              onClick={() => {
                setShowHeaderMenu(false);
                track('chat.pinyin_toggle', { aid: 'pinyin', on: !displayPrefs.pinyinAll });
                setDisplayForAll('pinyin', !displayPrefs.pinyinAll);
              }}
            >
              <span aria-hidden="true">拼</span> {displayPrefs.pinyinAll ? 'Hide pinyin for all' : 'Show pinyin for all'}
            </button>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={displayPrefs.translateAll}
              className="chat-header-menu-item"
              onClick={() => {
                setShowHeaderMenu(false);
                track('chat.pinyin_toggle', { aid: 'translate', on: !displayPrefs.translateAll });
                setDisplayForAll('translate', !displayPrefs.translateAll);
              }}
            >
              <span aria-hidden="true">EN</span> {displayPrefs.translateAll ? 'Hide translations for all' : 'Show translations for all'}
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
      <div className="chat-messages-wrap">
        <div className="chat-messages" ref={scroll.containerRef} onScroll={scroll.onScroll}>
          {messages.length === 0 ? (
            <div className="chat-empty">
              <p>{isAIConversation ? 'Start practicing Chinese!' : 'Start the conversation!'}</p>
            </div>
          ) : (
            messages.map((m, i) => renderMessage(m, layouts[i]))
          )}
          {showTyping && <TypingIndicator name={otherFirstName} />}
          {isWaitingForAI && (
            <div className="chat-message received group-first group-last">
              <div className="chat-message-content">
                <div className="chat-bubble typing">
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                </div>
              </div>
            </div>
          )}
        </div>
        {(scroll.pillCount > 0 || !scroll.atBottom) && <NewMessagesPill count={scroll.pillCount} onClick={() => scroll.scrollToBottom(true)} />}
      </div>

      {/* Reply preview bar */}
      {replyingTo && (
        <div className="reply-bar">
          <div className="reply-bar-content">
            <span className="reply-bar-name">{replyingTo.sender_id === myId ? 'Replying to yourself' : `Replying to ${replyingTo.sender.name || 'Unknown'}`}</span>
            <span className="reply-bar-text">
              {replyingTo.content
                ? replyingTo.content.length > 80
                  ? replyingTo.content.slice(0, 80) + '...'
                  : replyingTo.content
                : replyingTo.attachment?.kind === 'voice'
                  ? '🎤 Voice message'
                  : '📷 Photo'}
            </span>
          </div>
          <button className="reply-bar-close" onClick={() => setReplyingTo(null)} aria-label="Cancel reply">×</button>
        </div>
      )}

      {/* Picking messages for flashcards replaces the composer */}
      {selecting && (
        <div className="chat-select-bar" data-testid="chat-select-bar">
          <div className="chat-select-quick">
            <button type="button" className="chat-chip-btn" onClick={() => openCards({ kind: 'today' })}>
              Today
            </button>
            <button type="button" className="chat-chip-btn" onClick={() => openCards({ kind: 'last50' })}>
              Last 50 messages
            </button>
          </div>
          <div className="chat-select-row">
            <button type="button" className="btn btn-secondary" onClick={stopSelecting}>
              Cancel
            </button>
            <span className="chat-select-count">{selectedIds.size} selected</span>
            <button type="button" className="btn btn-secondary" disabled={selectedIds.size === 0} onClick={() => void copySelected()}>
              Copy
            </button>
            {!isAIConversation && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={selectedIds.size === 0 || !isOnline}
                onClick={() => setForwarding(serverMessages.filter((m) => selectedIds.has(m.id)).map((m) => m.id))}
              >
                Forward
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={selectedIds.size === 0 || !isOnline}
              onClick={() => openCards({ kind: 'selected', ids: serverMessages.filter((m) => selectedIds.has(m.id)).map((m) => m.id) })}
            >
              Make flashcards
            </button>
          </div>
        </div>
      )}

      {/* Composer: [+] [😊 field ✓] [🎤 | ➤] (docs/CHAT.md "Round 2") */}
      <div className="chat-composer" style={selecting ? { display: 'none' } : undefined}>
        <OfflineWarning message="You're offline. Messages you send now wait here and go out when you're back online." />
        <InlineNotice notice={notice} onDismiss={clearNotice} className="chat-composer-notice" />
        {draftCheck && !recording && (
          <CheckDraftPanel
            check={draftCheck}
            onUse={(text) => {
              setNewMessage(text);
              setDraftCheck(null);
              inputRef.current?.focus();
            }}
            onSendAsIs={() => handleSend()}
            onRetry={() => void runDraftCheck(draftCheck.draft)}
            onClose={() => setDraftCheck(null)}
          />
        )}
        {emojiOpen && !recording && (
          <div className="chat-emoji-panel" data-testid="chat-emoji-panel">
            {getRecentEmojis().length > 0 && (
              <>
                <div className="emoji-picker-section-label">Recent</div>
                <div className="msg-sheet-emoji-grid">
                  {getRecentEmojis().map((e) => (
                    <button key={`r-${e}`} type="button" className="msg-sheet-emoji" onClick={() => insertEmoji(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="msg-sheet-emoji-grid">
              {FULL_EMOJI_LIST.map((e) => (
                <button key={e} type="button" className="msg-sheet-emoji" onClick={() => insertEmoji(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {recording === 'held' && (
          <div className="chat-mic-lock-hint" aria-hidden="true">
            <span>🔒</span>
            <span className="chat-mic-lock-arrow">⌃</span>
          </div>
        )}
        <form className="chat-input-form" onSubmit={handleSend}>
          {recording ? (
            <VoiceComposer
              mode={recording}
              command={voiceCmd}
              dragX={dragX}
              onSend={sendVoice}
              onCancel={() => {
                setRecording(false);
                setDragX(0);
              }}
              onError={(text) => setNotice({ kind: 'error', text })}
            />
          ) : (
            <>
              <button
                type="button"
                className={`chat-round-btn chat-attach-btn${attachOpen ? ' open' : ''}`}
                onClick={() => {
                  setEmojiOpen(false);
                  setAttachOpen((v) => !v);
                }}
                disabled={preparingPhoto}
                aria-label="Attach"
                aria-expanded={attachOpen}
                title="Photo, camera, help me say it"
                data-testid="chat-attach-btn"
              >
                {preparingPhoto ? <span className="chat-spinner" aria-hidden="true" /> : '+'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="chat-file-input"
                data-testid="chat-photo-input"
                multiple
                onChange={(e) => void handlePhotoPicked(e.target.files)}
              />
              <input
                ref={videoInputRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/*"
                className="chat-file-input"
                data-testid="chat-video-input"
                onChange={(e) => void handleVideoPicked(e.target.files?.[0])}
              />
              <input
                ref={docInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.txt,.csv,.md,.rtf,.zip,.apkg,.epub,.mp3,.m4a"
                className="chat-file-input"
                data-testid="chat-file-input"
                onChange={(e) => handleDocPicked(e.target.files?.[0])}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="chat-file-input"
                onChange={(e) => void handlePhotoPicked(e.target.files)}
              />
              <div className="chat-input-pill">
                <button
                  type="button"
                  className={`chat-pill-btn${emojiOpen ? ' active' : ''}`}
                  onClick={() => {
                    setAttachOpen(false);
                    setEmojiOpen((v) => !v);
                  }}
                  aria-label="Emoji"
                  aria-expanded={emojiOpen}
                  data-testid="chat-emoji-btn"
                >
                  😊
                </button>
                <textarea
                  ref={inputRef}
                  value={newMessage}
                  onChange={(e) => {
                    setNewMessage(e.target.value);
                    if (draftCheck && e.target.value.trim() !== draftCheck.draft) setDraftCheck(null);
                    noteTyping(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
                  }}
                  onFocus={() => setAttachOpen(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleSend(e);
                    }
                  }}
                  placeholder={isAIConversation ? 'Type in Chinese…' : 'Message'}
                  className="chat-input"
                  rows={1}
                  aria-label="Message"
                />
                {canCheckDraft && (
                  <button
                    type="button"
                    className={`chat-pill-btn chat-check-btn${draftCheck ? ' active' : ''}`}
                    onClick={() => void runDraftCheck(newMessage.trim())}
                    disabled={draftCheck?.kind === 'loading'}
                    aria-label="Check my Chinese"
                    title={isOnline ? 'Check my Chinese before sending' : 'Checking needs internet'}
                  >
                    ✓
                  </button>
                )}
              </div>
            </>
          )}
          {recording === 'locked' ? null : composerEmpty && !isAIConversation ? (
            <button
              type="button"
              className={`chat-round-btn chat-mic-btn${recording === 'held' ? ' recording' : ''}`}
              onPointerDown={micDown}
              onPointerMove={micMove}
              onPointerUp={micUp}
              onPointerCancel={micUp}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={(e) => {
                // Keyboard: Enter / Space opens the locked recorder.
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setNotice(null);
                  setRecording('locked');
                }
              }}
              aria-label="Hold to record a voice message"
              title="Hold to record, release to send"
              data-testid="chat-mic-btn"
            >
              🎤
            </button>
          ) : (
            <SpinnerButton
              type="submit"
              className="chat-round-btn chat-send"
              busy={isWaitingForAI}
              disabled={composerEmpty}
              aria-label="Send"
            >
              ➤
            </SpinnerButton>
          )}
        </form>
        {attachOpen && !recording && (
          <div className="chat-attach-menu" role="menu" data-testid="chat-attach-menu">
            {!isAIConversation && (
              <>
                <button type="button" role="menuitem" className="chat-attach-item" onClick={() => { setAttachOpen(false); cameraInputRef.current?.click(); }}>
                  <span className="chat-attach-icon" aria-hidden="true">📷</span> Camera
                </button>
                <button type="button" role="menuitem" className="chat-attach-item" onClick={() => { setAttachOpen(false); fileInputRef.current?.click(); }}>
                  <span className="chat-attach-icon" aria-hidden="true">🖼️</span> Photos
                </button>
                <button type="button" role="menuitem" className="chat-attach-item" onClick={() => { setAttachOpen(false); videoInputRef.current?.click(); }}>
                  <span className="chat-attach-icon" aria-hidden="true">🎬</span> Video
                </button>
                <button type="button" role="menuitem" className="chat-attach-item" onClick={() => { setAttachOpen(false); docInputRef.current?.click(); }}>
                  <span className="chat-attach-icon" aria-hidden="true">📄</span> File
                </button>
              </>
            )}
            <button
              type="button"
              role="menuitem"
              className="chat-attach-item"
              disabled={chatToolsBlocked || messages.length === 0 || isGeneratingOptions}
              onClick={() => {
                setAttachOpen(false);
                handleHelpMeSayIt();
              }}
            >
              <span className="chat-attach-icon" aria-hidden="true">💡</span> Help me say it
              {chatToolsBlocked && <span className="msg-sheet-action-hint">Needs internet</span>}
            </button>
          </div>
        )}
      </div>

      {pendingPhotos && pendingPhotos.length > 0 && (
        <PhotoComposeSheet
          blobs={pendingPhotos.map((p) => p.blob)}
          onSend={sendPhoto}
          onRemove={(i) => setPendingPhotos((prev) => (prev && prev.length > 1 ? prev.filter((_, j) => j !== i) : null))}
          onCancel={() => setPendingPhotos(null)}
        />
      )}
      {forwarding && user && (
        <ForwardSheet myId={user.id} count={forwarding.length} currentConversationId={convId} onPick={(t) => void doForward(forwarding, t)} onClose={() => setForwarding(null)} />
      )}
      {infoFor && (
        <MessageInfoSheet
          message={infoFor}
          myId={myId}
          otherName={otherFirst}
          otherReadAt={thread.readState.other}
          onClose={() => setInfoFor(null)}
        />
      )}
      {viewer && <PhotoViewer url={viewer.url} caption={viewer.caption} onClose={() => setViewer(null)} />}
      {editing && (
        <EditMessageSheet
          initial={editing.content}
          isCaption={editing.attachment?.kind === 'image'}
          busy={editBusy}
          error={editError}
          onSave={(text) => void saveEdit(text)}
          onCancel={() => setEditing(null)}
        />
      )}
      {deleting && <ConfirmDeleteSheet busy={deleteBusy} onConfirm={() => void confirmDelete()} onCancel={() => setDeleting(null)} />}

      {/* The message menu (long-press / right-click / hover ⋯) */}
      {sheet &&
        (() => {
          const menu = menuFor(sheet.message);
          return (
            <MessageMenu
              senderName={sheet.message.sender_id === myId ? 'You' : sheet.message.sender.name || 'Unknown'}
              preview={menuText(sheet.message) || attachmentLabel(sheet.message.attachment)}
              items={menu.items}
              reactions={menu.reactions}
              isOnline={isOnline}
              anchor={sheet.anchor}
              emojiFirst={sheet.emojiFirst}
              quickEmojis={getQuickEmojis()}
              recentEmojis={getRecentEmojis()}
              allEmojis={FULL_EMOJI_LIST}
              onAction={handleSheetAction}
              onReact={(emoji) => handleReaction(sheet.message.id, emoji)}
              onClose={() => setSheet(null)}
            />
          );
        })()}
      {explain && <ExplainSheet text={explain.text} mode={explain.mode} isOnline={isOnline} onClose={() => setExplain(null)} />}

      {/* Make flashcards from this chat */}
      {cardScope && convId && (
        <MakeFlashcardsSheet
          conversationId={convId}
          scope={cardScope}
          sourceText={messageTextFor}
          onClose={() => setCardScope(null)}
          onAdded={(summary) => {
            setCardScope(null);
            setSelectedIds(new Set());
            setKnownVersion((v) => v + 1);
            showSuccess(summary);
          }}
        />
      )}

      {correcting && (
        <CorrectMessageSheet
          original={correcting.content}
          initial={correcting.correction?.text ?? correcting.content}
          initialNote={correcting.correction?.note ?? ''}
          studentName={(correcting.sender.name || 'their').split(' ')[0]}
          busy={correctBusy}
          error={correctError}
          onSave={(text, note) => void saveCorrection(text, note)}
          onCancel={() => setCorrecting(null)}
        />
      )}

      {tappedWord && (
        <ReaderWordSheet
          word={tappedWord.word}
          sentence={tappedWord.sentence}
          known={known.has(tappedWord.word.text.trim())}
          onClose={() => setTappedWord(null)}
          onAdded={() => setKnownVersion((v) => v + 1)}
        />
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
