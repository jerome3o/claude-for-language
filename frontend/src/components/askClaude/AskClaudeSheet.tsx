import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { askClaudeMenu, type MenuActionId, type MenuItem } from '@shared/chats/messageMenu';
import { coachDeepLink, openInCoachRequest, sayBetterLabel, sayBetterState, showCoachChip } from '@shared/chats/autoCheck';
import { chatReadAloudSpeed, chatReadAloudVoice, parseVoiceGender } from '@shared/chats/voice';
import { ASK_CLAUDE_SPEED, ASK_CLAUDE_VOICE, askAnswerHidden, askAutoPlayId, askQuickActions, revealedWhenListeningOn, type AskLanguage } from '@shared/study/askClaude';
import { fallbackReaderWords } from '@shared/reader/words';
import { itemForText } from '@shared/explorer';
import type { AskToolResult, NoteQuestionWithTools, ReadOnlyToolCall } from '../../api/client';
import { MessageMenu, type MenuAnchor } from '../chat/MessageMenu';
import { ChatWordsText, type TappedWord } from '../chat/ChatWords';
import { ChatTranslation, CoachChip, SayBetterMark } from '../chat/ChatBubbleParts';
import { ExplainSheet } from '../chat/ExplainSheet';
import { SayBetterSheet, type SayBetterMessage } from '../chat/SayBetterSheet';
import { useLongPress } from '../chat/useLongPress';
import { ListeningBubble, useListeningPlayer } from '../chat/ListeningBubble';
import { getAskRevealed, revealAskAnswer, setAskRevealed, useAskRevealed } from '../../services/askClaudeListening';
import { looksLikeChinese } from '../chat/messageTools';
import { useExplorer } from '../explorer/ExplorerContext';
import { useKnownHanzi } from '../reader/ReaderWords';
import { useAuth } from '../../contexts/AuthContext';
import { getTTSWithCache } from '../../services/ttsCache';
import { speakWithBrowserTTS } from '../../services/audioCache';
import { readConversationVoices } from '../../services/conversationVoices';
import { createAudioPlayer } from '../../utils/audioPlayback';
import { track } from '../../services/analytics';
import type { AskClaudeConversation, AskPart } from './useAskClaude';
import '../chat/chat-learning.css';
import '../chat/chat-signal.css';
import '../chat/chat-listening.css';
import './ask-claude.css';

/** Friendly labels for Claude's read-only lookups. */
const TOOL_LABELS: Record<string, string> = {
  search_cards: 'Searched cards',
  list_conversations: 'Checked conversations',
  get_deck_info: 'Looked up deck info',
  get_note_cards: 'Checked card details',
  get_note_history: 'Checked review history',
  get_deck_progress: 'Checked deck progress',
  get_due_cards: 'Checked due cards',
  get_overall_stats: 'Checked study stats',
};

function ToolCallsCollapsible({ calls }: { calls: ReadOnlyToolCall[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="claude-tool-calls-collapsible">
      <button className="claude-tool-calls-toggle" onClick={() => setExpanded(!expanded)}>
        <span className="claude-tool-calls-icon">{expanded ? '▾' : '▸'}</span>
        <span className="claude-tool-calls-summary">
          Used {calls.length} tool{calls.length !== 1 ? 's' : ''}
        </span>
      </button>
      {expanded && (
        <div className="claude-tool-calls-details">
          {calls.map((call, idx) => (
            <div key={idx} className="claude-tool-call-item">
              <span className="claude-tool-call-name">{TOOL_LABELS[call.tool] || call.tool}</span>
              {call.input && Object.keys(call.input).length > 0 && (
                <span className="claude-tool-call-input">({Object.entries(call.input).map(([k, v]) => `${k}: ${v}`).join(', ')})</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Claude's changes: "Claude wants to make changes" with Approve / Reject, or what was applied. */
function ToolResults({ results, pending, onApprove, onReject }: { results: AskToolResult[]; pending: boolean; onApprove: () => void; onReject: () => void }) {
  const count = (tr: AskToolResult) => (tr.data?.count as number) || 0;
  if (pending) {
    return (
      <div className="claude-tool-results">
        <div className="tool-approval-box">
          <div className="tool-approval-header">Claude wants to make changes:</div>
          {results.map((tr, idx) => (
            <div key={idx} className="tool-approval-item">
              {tr.tool === 'edit_current_card' && tr.success && (
                <div>
                  <span className="tool-approval-icon">&#9998;</span>
                  <strong>Edit card</strong>
                  {tr.data?.changes ? (
                    <div className="tool-approval-changes">
                      {Object.entries(tr.data.changes as Record<string, unknown>).map(([field, value]) => (
                        <div key={field} className="tool-approval-change">
                          <span className="tool-approval-field">{field}:</span> {String(value)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
              {tr.tool === 'create_flashcards' && tr.success && (
                <div>
                  <span className="tool-approval-icon">&#43;</span>
                  <strong>
                    Create {count(tr)} new card{count(tr) !== 1 ? 's' : ''}
                  </strong>
                  {Array.isArray(tr.data?.created) && (
                    <div className="tool-approval-card-preview">
                      {(tr.data!.created as Array<{ hanzi: string; pinyin: string; english: string }>).map((note, noteIdx) => (
                        <div key={noteIdx} className="tool-approval-card-item">
                          <span className="hanzi" style={{ fontSize: '1.1rem' }}>{note.hanzi}</span>
                          <span style={{ fontSize: '0.8rem', opacity: 0.7, marginLeft: '0.5rem' }}>{note.pinyin}</span>
                          <span style={{ fontSize: '0.8rem', opacity: 0.7, marginLeft: '0.5rem' }}>— {note.english}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {tr.tool === 'delete_current_card' && tr.success && (
                <div>
                  <span className="tool-approval-icon">&#128465;</span>
                  <strong>Delete this card</strong>
                </div>
              )}
              {tr.tool === 'create_custom_lesson' && tr.success && (
                <div>
                  <span className="tool-approval-icon">&#127891;</span>
                  <strong>Mini lesson created: {String(tr.data?.title || '')}</strong>
                  <div className="tool-approval-changes">It will appear in your next study session.</div>
                </div>
              )}
              {!tr.success && <div>Action failed: {tr.error || 'Unknown error'}</div>}
            </div>
          ))}
          <div className="tool-approval-buttons">
            <button className="btn btn-success btn-sm" onClick={onApprove}>
              Approve
            </button>
            <button className="btn btn-secondary btn-sm" onClick={onReject}>
              Reject
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="claude-tool-results">
      {results.map((tr, idx) => (
        <div key={idx} className={`claude-tool-result ${tr.success ? 'success' : 'error'}`}>
          {tr.tool === 'edit_current_card' && tr.success && (
            <span>Card updated{tr.data?.changes ? `: ${Object.keys(tr.data.changes as Record<string, unknown>).join(', ')} changed` : ''}</span>
          )}
          {tr.tool === 'create_flashcards' && tr.success && (
            <span>
              {count(tr)} new card{count(tr) !== 1 ? 's' : ''} created
            </span>
          )}
          {tr.tool === 'delete_current_card' && tr.success && <span>Card deleted — advancing to next card...</span>}
          {tr.tool === 'create_custom_lesson' && tr.success && (
            <span>Mini lesson created: {String(tr.data?.title || '')} — it'll appear in your next study session</span>
          )}
          {!tr.success && <span>Action failed: {tr.error || 'Unknown error'}</span>}
        </div>
      ))}
    </div>
  );
}

type Target = { entry: NoteQuestionWithTools; part: AskPart };
const keyOf = (t: Target) => `${t.entry.id}:${t.part}`;

/**
 * Ask Claude about the card on screen — the tutor chat's look and tools (docs/STUDY_SESSION.md
 * "Ask Claude"): Claude answers in simple Chinese by default (中文 / EN in the header), every
 * Chinese word is a chip that opens the language explorer, a long press (right-click on desktop)
 * opens the chat's message menu with the parts that fit (Translate, Pinyin, Explain, Save as
 * flashcard, Open in Coach, Read aloud, Copy), and my own Chinese gets the chat's auto-check:
 * the ✎ mark, "How to say it better" and the "Open in Coach" chip.
 *
 * 🎧 Listen first (the header's 🎧, Settings): the chat's listening mode — Claude's Chinese answers
 * arrive as the chat's hidden bubble (`ListeningBubble` + `useListeningPlayer`): a tap plays the
 * Read-aloud clip (Claude's voice, cached by text + voice + speed), a long press / 👁 reveals it, and
 * a new answer plays once by itself when it arrives (`askAutoPlayId`). My questions never hide.
 */
export function AskClaudeSheet({
  hanzi,
  chat,
  typedAnswer,
  hasSentence,
  cardDeleted,
  aiAvailable,
  language,
  onLanguage,
  listening,
  onListening,
  onApprove,
  onClose,
}: {
  hanzi: string;
  chat: AskClaudeConversation;
  typedAnswer: boolean;
  hasSentence: boolean;
  cardDeleted: boolean;
  aiAvailable: boolean;
  language: AskLanguage;
  onLanguage: (language: AskLanguage) => void;
  /** 🎧 Listen first. */
  listening: boolean;
  onListening: (on: boolean) => void;
  onApprove: (results: AskToolResult[]) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const explorer = useExplorer();
  const { user } = useAuth();
  const known = useKnownHanzi();
  const press = useLongPress();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const playerRef = useRef(createAudioPlayer());
  const [menu, setMenu] = useState<{ target: Target; anchor: MenuAnchor } | null>(null);
  const [shown, setShown] = useState<{ pinyin: Set<string>; translate: Set<string> }>({ pinyin: new Set(), translate: new Set() });
  const [explain, setExplain] = useState<{ text: string; mode: 'explain' | 'save' } | null>(null);
  const [sayBetterFor, setSayBetterFor] = useState<NoteQuestionWithTools | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  // ----- 🎧 Listen first (the chat's listening mode, shared/study/askClaude.ts) -----
  const revealed = useAskRevealed();
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [listenNotice, setListenNotice] = useState<{ id: string; text: string } | null>(null);
  const listenIdRef = useRef<string | null>(null);
  const autoRef = useRef(false);
  const listenPlayer = useListeningPlayer(
    (message) => {
      const id = listenIdRef.current;
      if (!id) return;
      const offline = /not downloaded/i.test(message) || (typeof navigator !== 'undefined' && !navigator.onLine);
      setListenNotice({ id, text: offline ? '🎧 Listening needs a connection the first time — hold to read it instead.' : "Couldn't play it — tap to try again, or hold to read it." });
    },
    {
      onPlay: (slow) => {
        track('study.ask_claude_listen_play', { auto: autoRef.current, slow });
        autoRef.current = false;
      },
    },
  );
  /** Answers on screen when the sheet opened (and every answer already looked at): never auto-played. */
  const seenRef = useRef<Set<string>>(new Set(chat.conversation.map((q) => q.id)));
  const quickActions = useMemo(() => askQuickActions({ language, typedAnswer, hasSentence }), [language, typedAnswer, hasSentence]);
  const myId = user?.id ?? 'me';

  const textOf = (t: Target) => (t.part === 'answer' ? t.entry.answer : t.entry.question);
  const isMarkdown = (t: Target) => t.part === 'answer' && t.entry.answer_lang !== 'zh';
  const roleOf = (t: Target) => (t.part === 'question' ? 'mine' : 'claude');

  /** My question as the chat's message shape (the auto-check rules and the How-to-say-it-better sheet read it). */
  const asMessage = (entry: NoteQuestionWithTools): SayBetterMessage & { id: string } => ({
    id: entry.id,
    sender_id: myId,
    content: entry.question,
    auto_check: entry.question_check ?? null,
    correction: null,
    attachment: null,
    translation: entry.question_translation ?? null,
    deleted_at: null,
  });

  const toggle = (kind: 'pinyin' | 'translate', t: Target) =>
    setShown((prev) => {
      const next = new Set(prev[kind]);
      const k = keyOf(t);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return { ...prev, [kind]: next };
    });

  const translate = async (t: Target) => {
    const on = shown.translate.has(keyOf(t));
    toggle('translate', t);
    if (on) return;
    // Couldn't translate: switch it back off so the next tap retries.
    if (!(await chat.ensureTranslation(t.entry, t.part))) toggle('translate', t);
  };

  const readAloud = async (key: string, text: string, mine: boolean) => {
    if (playing === key) {
      playerRef.current.stop();
      setPlaying(null);
      return;
    }
    listenPlayer.stop();
    setPlaying(key);
    // Claude reads in the app voice (ASK_CLAUDE_VOICE); my own lines in my voice (shared/chats/voice.ts).
    const senderGender = mine ? parseVoiceGender(user?.voice_gender) : null;
    const voice = mine ? chatReadAloudVoice({ senderGender, enabled: readConversationVoices(), fromAi: false }) : ASK_CLAUDE_VOICE;
    try {
      const blob = await getTTSWithCache(text, mine ? chatReadAloudSpeed({}) : ASK_CLAUDE_SPEED, voice);
      if (blob) {
        playerRef.current.play(blob, { onEnded: () => setPlaying(null), onError: () => setPlaying(null) });
        return;
      }
      await speakWithBrowserTTS(text, senderGender === 'male' || senderGender === 'female' ? senderGender : null);
    } catch (err) {
      console.warn('[ask] read aloud failed:', err);
    }
    setPlaying(null);
  };

  const openInCoach = (t: Target, source: 'menu' | 'chip' | 'sheet') => {
    const req = openInCoachRequest({ sender_id: t.part === 'question' ? myId : 'claude', content: textOf(t) }, myId);
    if (!req) return;
    track('study.ask_claude_tool', { action: source === 'menu' ? 'open_coach' : `open_coach_${source}`, role: roleOf(t) });
    navigate(coachDeepLink(req));
  };

  const menuFor = (t: Target): MenuItem[] =>
    askClaudeMenu(
      {
        mine: t.part === 'question',
        text: textOf(t),
        translation: t.part === 'answer' ? t.entry.answer_translation : t.entry.question_translation,
        auto_check: t.part === 'question' ? t.entry.question_check ?? null : null,
        markdown: isMarkdown(t),
      },
      { pinyinOn: shown.pinyin.has(keyOf(t)), translateOn: shown.translate.has(keyOf(t)) },
    ).items;

  const onMenuAction = (id: MenuActionId) => {
    if (!menu) return;
    const t = menu.target;
    setMenu(null);
    if (id !== 'open_coach') track('study.ask_claude_tool', { action: id, role: roleOf(t) });
    switch (id) {
      case 'say_better':
        setSayBetterFor(t.entry);
        break;
      case 'open_coach':
        openInCoach(t, 'menu');
        break;
      case 'copy':
        void navigator.clipboard?.writeText(textOf(t)).catch(() => undefined);
        break;
      case 'translate':
        void translate(t);
        break;
      case 'pinyin':
        toggle('pinyin', t);
        break;
      case 'explain':
        setExplain({ text: textOf(t).trim(), mode: 'explain' });
        break;
      case 'save_card':
        setExplain({ text: textOf(t).trim(), mode: 'save' });
        break;
      case 'play':
        void readAloud(keyOf(t), textOf(t), t.part === 'question');
        break;
      default:
        break;
    }
  };

  const tapWord = (tapped: TappedWord, role: 'mine' | 'claude') => {
    const item = itemForText(tapped.word.text, { pinyin: tapped.word.pinyin || undefined, gloss: tapped.word.gloss || undefined, sentence: tapped.sentence });
    if (!item) return;
    track('study.ask_claude_tool', { action: 'word', role });
    explorer.open(item, { source: 'ask_claude', cardHanzi: hanzi });
  };

  /** One bubble: mine (blue, right) or Claude's (grey, left), the chat's markup and gestures. */
  const renderBubble = (t: Target, extra?: React.ReactNode) => {
    const text = textOf(t);
    const mine = t.part === 'question';
    const k = keyOf(t);
    const zh = looksLikeChinese(text);
    const markdown = isMarkdown(t);
    const stored = t.part === 'answer' ? t.entry.answer_words : t.entry.question_words;
    // Until the word chips arrive every character is tappable on its own.
    const words = zh && !markdown ? stored ?? fallbackReaderWords(text) : null;
    const translation = t.part === 'answer' ? t.entry.answer_translation : t.entry.question_translation;
    const translateOn = shown.translate.has(k);
    const better = mine ? sayBetterState(asMessage(t.entry), myId) : null;
    const openMenu = (anchor: MenuAnchor) => setMenu({ target: t, anchor });
    return (
      <div
        className={`chat-message ${mine ? 'sent' : 'received'} group-first group-last${menu && keyOf(menu.target) === k ? ' menu-open' : ''}${!mine && revealingId === t.entry.id ? ' listening-revealing' : ''}`}
        data-testid={mine ? 'ask-mine' : 'ask-claude-reply'}
      >
        <div className="chat-message-content">
          <div className="chat-bubble-row">
            <div
              className="chat-bubble"
              {...press.bind(() => openMenu(null))}
              onContextMenu={(e) => {
                e.preventDefault();
                openMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              {markdown ? (
                <div className="claude-response">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                </div>
              ) : (
                <ChatWordsText text={text} words={words} showPinyin={shown.pinyin.has(k)} known={known} onTapWord={(w) => tapWord(w, roleOf(t))} suppressTap={press.suppressTap} />
              )}
              {translateOn && <ChatTranslation text={translation ?? (chat.translateErrors.has(k) ? "Couldn't translate — hold to try again" : null)} />}
              {better && (
                <span className="chat-bubble-meta">
                  <SayBetterMark state={better} label={sayBetterLabel(better)} />
                </span>
              )}
              {extra}
            </div>
            <div className="chat-hover-tools">
              <button type="button" className="chat-hover-btn" aria-label="Message actions" onClick={(e) => openMenu({ x: e.clientX, y: e.clientY })}>
                ⋯
              </button>
            </div>
          </div>
          {mine && showCoachChip(asMessage(t.entry), myId) && <CoachChip onClick={() => openInCoach(t, 'chip')} />}
        </div>
      </div>
    );
  };

  const isHidden = (entry: NoteQuestionWithTools) => askAnswerHidden(entry, { listening, revealed });

  /** A tap on a hidden answer: the Read-aloud clip, from the start (again). */
  const listen = (entry: NoteQuestionWithTools, auto = false) => {
    playerRef.current.stop();
    setPlaying(null);
    setListenNotice(null);
    listenIdRef.current = entry.id;
    autoRef.current = auto;
    listenPlayer.play({ id: entry.id, content: entry.answer }, { voice: ASK_CLAUDE_VOICE, speed: ASK_CLAUDE_SPEED });
  };

  /** Long press / 👁: the text for good on this device (the chat's un-blur), then chips + the menu. */
  const reveal = (entry: NoteQuestionWithTools) => {
    if (!isHidden(entry)) return;
    navigator.vibrate?.(18);
    if (listenPlayer.playingId === entry.id || listenPlayer.loadingId === entry.id) listenPlayer.stop();
    setListenNotice((n) => (n?.id === entry.id ? null : n));
    setRevealingId(entry.id);
    revealAskAnswer(entry.id);
    window.setTimeout(() => setRevealingId((id) => (id === entry.id ? null : id)), 420);
  };

  const toggleListening = () => {
    const on = !listening;
    // History stays: what is on screen now keeps showing, anything newer hides.
    if (on) setAskRevealed(revealedWhenListeningOn(chat.conversation, getAskRevealed()));
    else listenPlayer.stop();
    navigator.vibrate?.(10);
    onListening(on);
  };

  // A new answer that arrives hidden plays once by itself — unless audio is already going.
  const audioBusy = playing !== null || listenPlayer.playingId !== null || listenPlayer.loadingId !== null;
  useEffect(() => {
    const last = chat.conversation[chat.conversation.length - 1];
    const id = askAutoPlayId({ listening, entries: chat.conversation, seen: seenRef.current, revealed, audioBusy });
    if (last) seenRef.current.add(last.id);
    if (id && last) listen(last, true);
    // Only a new answer starts this (not a reveal or the end of a clip).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.conversation.length]);

  /** Claude's answer as the chat's hidden bubble: tap plays, long press / right-click / 👁 reveals. */
  const renderHidden = (entry: NoteQuestionWithTools, extra?: React.ReactNode) => {
    const id = entry.id;
    const playingThis = listenPlayer.playingId === id;
    return (
      <div className="chat-message received group-first group-last" data-testid="ask-claude-reply" data-hidden="true">
        <div className="chat-message-content">
          <div className="chat-bubble-row">
            <div
              className="chat-bubble listening"
              data-testid="ask-listening-bubble"
              role="button"
              tabIndex={0}
              aria-label="Claude's answer, hidden. Tap to listen, hold to reveal"
              {...press.bind(() => reveal(entry))}
              onClick={() => {
                if (press.suppressTap()) return;
                listen(entry);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                // A touch long press also fires contextmenu; it already revealed.
                if (press.suppressTap()) return;
                reveal(entry);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  listen(entry);
                }
              }}
            >
              <ListeningBubble
                messageId={id}
                text={entry.answer}
                playing={playingThis}
                loading={listenPlayer.loadingId === id}
                progress={playingThis ? listenPlayer.progress : 0}
                durationSec={listenPlayer.durations[id] ?? null}
                slow={listenPlayer.slow}
                onToggleSlow={listenPlayer.toggleSlow}
              />
            </div>
            <button type="button" className="chat-listening-reveal" onClick={() => reveal(entry)} aria-label="Reveal the answer" title="Reveal" data-testid="ask-listening-reveal">
              👁
            </button>
          </div>
          {listenNotice?.id === id && (
            <p className="ask-listen-notice" role="status" data-testid="ask-listening-notice">
              {listenNotice.text}
            </p>
          )}
          {extra && <div className="ask-hidden-extra">{extra}</div>}
        </div>
      </div>
    );
  };

  const empty = chat.conversation.length === 0 && !chat.isAsking;

  return (
    <div className="modal-overlay claude-modal-overlay">
      <div className="modal claude-modal ask-claude-modal" onClick={(e) => e.stopPropagation()} data-testid="ask-claude-sheet">
        <div className="modal-header">
          <div className="modal-title">Ask about: {hanzi}</div>
          <button
            type="button"
            className={`ask-listen-toggle${listening ? ' on' : ''}`}
            aria-pressed={listening}
            aria-label={listening ? 'Listen first is on: answers arrive hidden. Turn off' : 'Listen first: hear the answer before you read it'}
            title={listening ? 'Listen first: on' : 'Listen first'}
            onClick={toggleListening}
            data-testid="ask-listen-toggle"
          >
            🎧
          </button>
          <div className="ask-lang-toggle" role="group" aria-label="Claude answers in">
            <button type="button" aria-pressed={language === 'zh'} className={language === 'zh' ? 'on' : ''} onClick={() => language !== 'zh' && onLanguage('zh')} data-testid="ask-lang-zh">
              中文
            </button>
            <button type="button" aria-pressed={language === 'en'} className={language === 'en' ? 'on' : ''} onClick={() => language !== 'en' && onLanguage('en')} data-testid="ask-lang-en">
              EN
            </button>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="claude-modal-content ask-thread">
          {empty && (
            <>
              <div className="claude-quick-actions">
                {quickActions.map((a) => (
                  <button key={a.id} className="btn btn-secondary btn-sm" onClick={() => void chat.ask(a.question, { quick: true })}>
                    {a.label}
                  </button>
                ))}
              </div>
              {listening ? (
                <p className="ask-hint" data-testid="ask-hint">
                  🎧 Listen first: Claude’s Chinese answers arrive hidden and play by themselves. Tap to hear again · hold to reveal.
                </p>
              ) : (
                language === 'zh' && (
                  <p className="ask-hint" data-testid="ask-hint">
                    Claude answers in simple Chinese. Tap any word to look it up · hold a message to translate it.
                  </p>
                )
              )}
            </>
          )}

          {chat.conversation.map((entry, i) => {
            const latest = i === chat.conversation.length - 1;
            const hasPending = latest && chat.pendingToolResults !== null;
            const tools =
              entry.toolResults && entry.toolResults.length > 0 ? (
                <ToolResults
                  results={entry.toolResults}
                  pending={hasPending}
                  onApprove={() => {
                    const results = chat.pendingToolResults;
                    chat.setPendingToolResults(null);
                    if (results) onApprove(results);
                  }}
                  onReject={() => chat.setPendingToolResults(null)}
                />
              ) : undefined;
            return (
              <div key={entry.id} className="ask-exchange">
                {renderBubble({ entry, part: 'question' })}
                {entry.readOnlyToolCalls && entry.readOnlyToolCalls.length > 0 && <ToolCallsCollapsible calls={entry.readOnlyToolCalls} />}
                {/* 🎧 Listen first: Claude's Chinese answer as the chat's hidden bubble until revealed. */}
                {isHidden(entry) ? renderHidden(entry, tools) : renderBubble({ entry, part: 'answer' }, tools)}
              </div>
            );
          })}

          {chat.isAsking && (
            <div className="ask-exchange">
              {chat.pendingQuestion && (
                <div className="chat-message sent group-first group-last">
                  <div className="chat-message-content">
                    <div className="chat-bubble pending">{chat.pendingQuestion}</div>
                  </div>
                </div>
              )}
              <div className="claude-loading">{language === 'zh' ? '想一想… Thinking…' : 'Thinking...'}</div>
            </div>
          )}

          {chat.error && !chat.isAsking && (
            <div className="study-inline-error" role="alert" data-testid="ask-claude-error">
              {chat.error}
            </div>
          )}
        </div>

        {!cardDeleted && (
          <div className="claude-input-row">
            <textarea
              ref={inputRef}
              className="form-input claude-autogrow-input"
              value={chat.question}
              onChange={(e) => {
                chat.setQuestion(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
              placeholder={chat.pendingToolResults ? 'Approve or reject changes first...' : language === 'zh' ? '用中文问吧… (or English)' : 'Ask a question...'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void chat.ask(chat.question);
                }
              }}
              disabled={chat.isAsking || !!chat.pendingToolResults}
              rows={1}
              autoFocus
            />
            <button className="btn btn-primary" onClick={() => void chat.ask(chat.question)} disabled={!chat.question.trim() || chat.isAsking || !!chat.pendingToolResults}>
              Ask
            </button>
          </div>
        )}
      </div>

      {menu && (
        <MessageMenu
          senderName={menu.target.part === 'question' ? 'You' : 'Claude'}
          preview={textOf(menu.target)}
          items={menuFor(menu.target)}
          reactions={false}
          isOnline={aiAvailable}
          anchor={menu.anchor}
          quickEmojis={[]}
          recentEmojis={[]}
          allEmojis={[]}
          onAction={onMenuAction}
          onReact={() => undefined}
          onClose={() => setMenu(null)}
        />
      )}
      {explain && <ExplainSheet text={explain.text} mode={explain.mode} isOnline={aiAvailable} onClose={() => setExplain(null)} />}
      {sayBetterFor && (
        <SayBetterSheet
          message={asMessage(chat.conversation.find((q) => q.id === sayBetterFor.id) ?? sayBetterFor)}
          viewerId={myId}
          tutorName="Claude"
          playing={playing === `better:${sayBetterFor.id}`}
          onPlay={(text) => void readAloud(`better:${sayBetterFor.id}`, text, true)}
          onDiscuss={() => {
            const corrected = sayBetterFor.question_check?.corrected ?? sayBetterFor.question;
            setSayBetterFor(null);
            chat.setQuestion(language === 'zh' ? `为什么「${corrected}」更好？` : `Why is "${corrected}" better?`);
            window.setTimeout(() => inputRef.current?.focus(), 50);
          }}
          onOpenCoach={() => {
            const entry = sayBetterFor;
            setSayBetterFor(null);
            openInCoach({ entry, part: 'question' }, 'sheet');
          }}
          onClose={() => setSayBetterFor(null)}
        />
      )}
    </div>
  );
}
