/**
 * A Claude chat's message list — context-agnostic (docs/CHAT.md "Ask Claude chat"): it takes a
 * thread id and plain messages, so the Coach's "💬 Ask Claude" and later Claude chats share it.
 *
 * - The tutor chat's Signal bubbles (chat-signal.css), mine right / Claude's left.
 * - Every Chinese word is a chip (the device segmenter) → the language explorer; each tap is kept
 *   as a word to recap for this thread (services/claudeChatRecap.ts).
 * - Under each of Claude's Chinese messages (`readBackOffered`): ▶ Listen (the Read-aloud clip in
 *   Claude's voice, cached on the device), 拼 / EN toggles, and 🎤 Read it back — he reads the
 *   message aloud, the take is judged with the graded readers' comparison
 *   (shared/reader/readAloud.ts, `useReadAloud`) and the message is marked in place; words with a
 *   real mistake join the recap words. Practice only: nothing is stored on the server.
 * - 🎧 Listen first: Claude's Chinese arrives as the chat's hidden bubble (tap plays, hold / 👁
 *   reveals) and a new one plays once by itself (`askAutoPlayId`), like Ask Claude on a card.
 * - English answers are Markdown; a pending reply shows "Thinking…" (or what Claude is doing, e.g.
 *   "Looking through your cards…"), a reply being STREAMED shows its text so far, a failed one Retry.
 * - Anything that isn't a plain text message (a Coach check / explain / translate result, a mistake
 *   lesson) is drawn by the caller (`renderSpecial`); tool results under a reply by `renderAfter`.
 * - My message written offline shows "🕓 Will send when you're online" until it is sent.
 * - A long press (right-click / ⋯ on desktop) on any finished bubble opens the chat's message menu
 *   with the parts that fit (`askClaudeMenu`: Copy, Translate, Pinyin, Explain, Save as flashcard,
 *   Open in Coach, Read aloud). My own Chinese carries the chat's auto-check when the server ran it
 *   (a card question, `auto_check`): the ✎ mark, "How to say it better" first in the menu and the
 *   "Open in Coach" chip.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { readBackMistakeWords, readBackOffered, READ_BACK_LABEL, READ_BACK_LISTENING } from '@shared/coach/askChat';
import { askClaudeMenu, type MenuActionId, type MenuItem } from '@shared/chats/messageMenu';
import { sayBetterLabel, sayBetterState, showCoachChip, type AutoCheckResult } from '@shared/chats/autoCheck';
import { ASK_CLAUDE_SPEED, ASK_CLAUDE_VOICE, askAnswerHidden, askAutoPlayId } from '@shared/study/askClaude';
import { itemForText } from '@shared/explorer';
import type { ReadAloudResult } from '@shared/reader/readAloud';
import { readAloudBucket } from '@shared/reader/readAloud';
import { ChatWordsText, type TappedWord } from '../chat/ChatWords';
import { ChatTranslation, CoachChip, SayBetterMark } from '../chat/ChatBubbleParts';
import { MessageMenu, type MenuAnchor } from '../chat/MessageMenu';
import { ExplainSheet } from '../chat/ExplainSheet';
import { SayBetterSheet, type SayBetterMessage } from '../chat/SayBetterSheet';
import { ListeningBubble, useListeningPlayer } from '../chat/ListeningBubble';
import { looksLikeChinese } from '../chat/messageTools';
import { useLongPress } from '../chat/useLongPress';
import { ReadAloudMic, ReadAloudPanel, useReadAloud } from '../reader/ReadAloud';
import { useExplorer, type ExplorerSource } from '../explorer/ExplorerContext';
import { useKnownHanzi } from '../reader/ReaderWords';
import { useSegmentedWords } from '../../services/chineseSegmenter';
import { revealAskAnswer, useAskRevealed } from '../../services/askClaudeListening';
import { recordRecapWord, recordRecapWords } from '../../services/claudeChatRecap';
import { getTTSWithCache } from '../../services/ttsCache';
import { speakWithBrowserTTS } from '../../services/audioCache';
import { createAudioPlayer } from '../../utils/audioPlayback';
import { track } from '../../services/analytics';
import '../chat/chat-learning.css';
import '../chat/chat-signal.css';
import '../chat/chat-listening.css';
import '../askClaude/ask-claude.css';
import './claude-chat.css';

export interface ClaudeChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Claude's reply: 'zh' = plain Chinese (chips, ▶, 🎧, 🎤), 'en' = Markdown. */
  answer_lang?: 'zh' | 'en' | null;
  /** null = done; pending = being written; failed = see error (Retry). */
  status?: 'pending' | 'failed' | null;
  error?: string | null;
  translation?: string | null;
  /** 'text' (default) | 'analysis' | 'mistake_lesson' — anything but text goes to `renderSpecial`. */
  content_type?: string;
  /** Pending with some text: the reply is being streamed (its text so far). */
  streaming?: boolean;
  /** Mine, written offline: waiting in the outbox. */
  queued?: boolean;
  /** Mine, refused when the outbox sent it (`error` says why). */
  queueFailed?: boolean;
  /** Mine: the chat's "check my Chinese" of it (a card question), when the server ran it. */
  auto_check?: AutoCheckResult | null;
}

/** "Me" in the auto-check rules (they compare a sender id with the viewer). */
const ME = 'me';

/** My message as the chat's message shape (the auto-check rules and the How-to-say-it-better sheet read it). */
function asChatMessage(m: ClaudeChatMessage): SayBetterMessage & { id: string } {
  return { id: m.id, sender_id: m.role === 'user' ? ME : 'claude', content: m.text, auto_check: m.auto_check ?? null, correction: null, attachment: null, translation: m.translation ?? null, deleted_at: null };
}

const CLAUDE_VOICE = { voice: ASK_CLAUDE_VOICE, speed: ASK_CLAUDE_SPEED };

export interface ClaudeChatThreadProps {
  threadId: string;
  messages: ClaudeChatMessage[];
  /** 🎧 Listen first. */
  listening: boolean;
  thinkingLabel: string;
  /** The English of a message (kept by the caller / server); null = couldn't. */
  onTranslate: (m: ClaudeChatMessage) => Promise<string | null>;
  onRetry: (m: ClaudeChatMessage) => void;
  retryingId?: string | null;
  explorerSource?: ExplorerSource;
  /** A message the learner is sending (shown until the server has it). */
  pendingText?: string | null;
  /** A non-text message (Coach result card, mistake lesson): the caller draws it. */
  renderSpecial?: (m: ClaudeChatMessage) => ReactNode;
  /** Under one of Claude's finished text replies (tool results). */
  renderAfter?: (m: ClaudeChatMessage) => ReactNode;
  /** What a pending reply says instead of `thinkingLabel` (Claude using a tool). */
  statusLineFor?: (m: ClaudeChatMessage) => string | null;
  /** ✕ on my message the outbox couldn't send. */
  onDiscardQueued?: (m: ClaudeChatMessage) => void;
  /** "Open in Coach" (the menu, the chip under my checked question); without it the menu leaves it out. */
  onOpenInCoach?: (m: ClaudeChatMessage, source: 'menu' | 'chip' | 'sheet') => void;
  /** A text for the composer (How to say it better → "Ask why"). */
  onDraft?: (text: string) => void;
  /** Answers come in Chinese (the "Ask why" wording). */
  language?: 'zh' | 'en';
  online?: boolean;
  /** The voice Claude's lines are read in (a role-play: the persona's; default Claude's own). */
  voice?: { voice: string; speed: number };
}

type Tool = 'play' | 'pinyin' | 'translate' | 'listen' | 'reveal' | 'word' | MenuActionId;

export function ClaudeChatThread({ threadId, messages, listening, thinkingLabel, onTranslate, onRetry, retryingId, explorerSource = 'claude_chat', pendingText, renderSpecial, renderAfter, statusLineFor, onDiscardQueued, onOpenInCoach, onDraft, language = 'zh', online = true, voice = CLAUDE_VOICE }: ClaudeChatThreadProps) {
  const explorer = useExplorer();
  const press = useLongPress();
  const [menu, setMenu] = useState<{ m: ClaudeChatMessage; anchor: MenuAnchor } | null>(null);
  const [explain, setExplain] = useState<{ text: string; mode: 'explain' | 'save' } | null>(null);
  const [sayBetterFor, setSayBetterFor] = useState<ClaudeChatMessage | null>(null);
  const known = useKnownHanzi();
  const revealed = useAskRevealed();
  const playerRef = useRef(createAudioPlayer());
  const [playing, setPlaying] = useState<string | null>(null);
  const [pinyinOn, setPinyinOn] = useState<Set<string>>(new Set());
  const [translateOn, setTranslateOn] = useState<Set<string>>(new Set());
  const [translations, setTranslations] = useState<Record<string, string | null>>({});
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const listenIdRef = useRef<string | null>(null);
  const autoRef = useRef(false);
  const listenPlayer = useListeningPlayer(
    (message) => {
      const id = listenIdRef.current;
      if (!id) return;
      const offline = /not downloaded/i.test(message) || (typeof navigator !== 'undefined' && !navigator.onLine);
      setNotice({ id, text: offline ? '🎧 Listening needs a connection the first time — hold to read it instead.' : "Couldn't play it — tap to try again, or hold to read it." });
    },
    { onPlay: () => { track('coach.ask_tool', { action: autoRef.current ? 'listen_auto' : 'listen', role: 'claude' }); autoRef.current = false; } },
  );
  useEffect(() => () => playerRef.current.stop(), []);

  const tool = (action: Tool, role: 'mine' | 'claude') => track('coach.ask_tool', { action, role });

  const entries = useMemo(() => messages.filter((m) => m.role === 'assistant' && !m.status && (m.content_type ?? 'text') === 'text').map((m) => ({ id: m.id, answer: m.text, answer_lang: m.answer_lang ?? null })), [messages]);
  const hidden = (m: ClaudeChatMessage) => askAnswerHidden({ id: m.id, answer: m.text, answer_lang: m.answer_lang ?? null }, { listening, revealed });

  // A new answer that arrives hidden plays once by itself — unless audio is already going.
  const seenRef = useRef<Set<string>>(new Set(entries.map((e) => e.id)));
  const audioBusy = playing !== null || listenPlayer.playingId !== null || listenPlayer.loadingId !== null;
  useEffect(() => {
    const last = entries[entries.length - 1];
    const id = askAutoPlayId({ listening, entries, seen: seenRef.current, revealed, audioBusy });
    if (last) seenRef.current.add(last.id);
    if (id && last) listen(last.id, last.answer, true);
    // Only a new answer starts this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length]);

  const listen = (id: string, text: string, auto = false) => {
    playerRef.current.stop();
    setPlaying(null);
    setNotice(null);
    listenIdRef.current = id;
    autoRef.current = auto;
    listenPlayer.play({ id, content: text }, { voice: voice.voice, speed: voice.speed });
  };

  const reveal = (m: ClaudeChatMessage) => {
    if (!hidden(m)) return;
    navigator.vibrate?.(18);
    if (listenPlayer.playingId === m.id || listenPlayer.loadingId === m.id) listenPlayer.stop();
    tool('reveal', 'claude');
    revealAskAnswer(m.id);
  };

  /** ▶: the message in Claude's voice (the Read-aloud clip, cached by text + voice + speed). */
  const play = async (m: ClaudeChatMessage) => {
    if (playing === m.id) {
      playerRef.current.stop();
      setPlaying(null);
      return;
    }
    listenPlayer.stop();
    setPlaying(m.id);
    tool('play', m.role === 'user' ? 'mine' : 'claude');
    try {
      const blob = await getTTSWithCache(m.text, voice.speed, voice.voice);
      if (blob) {
        playerRef.current.play(blob, { onEnded: () => setPlaying(null), onError: () => setPlaying(null) });
        return;
      }
      await speakWithBrowserTTS(m.text, null);
    } catch (err) {
      console.warn('[claude-chat] play failed:', err);
    }
    setPlaying(null);
  };

  const flip = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const translate = async (m: ClaudeChatMessage) => {
    const on = translateOn.has(m.id);
    setTranslateOn((s) => flip(s, m.id));
    if (on) return;
    tool('translate', m.role === 'user' ? 'mine' : 'claude');
    if (m.translation || translations[m.id]) return;
    const t = await onTranslate(m);
    setTranslations((prev) => ({ ...prev, [m.id]: t }));
    if (!t) setTranslateOn((s) => flip(s, m.id));
  };

  const tapWord = (tapped: TappedWord, role: 'mine' | 'claude') => {
    const item = itemForText(tapped.word.text, { pinyin: tapped.word.pinyin || undefined, gloss: tapped.word.gloss || undefined, sentence: tapped.sentence });
    if (!item) return;
    tool('word', role);
    recordRecapWord(threadId, { hanzi: tapped.word.text, pinyin: tapped.word.pinyin || undefined, gloss: tapped.word.gloss || undefined, sentence: tapped.sentence, reasons: ['tapped'] });
    explorer.open(item, { source: explorerSource });
  };

  const isMarkdown = (m: ClaudeChatMessage) => m.role === 'assistant' && m.answer_lang !== 'zh' && !looksLikeChinese(m.text);
  const menuFor = (m: ClaudeChatMessage): MenuItem[] =>
    askClaudeMenu(
      { mine: m.role === 'user', text: m.text, translation: m.translation ?? translations[m.id] ?? null, auto_check: m.role === 'user' ? m.auto_check ?? null : null, markdown: isMarkdown(m) },
      { pinyinOn: pinyinOn.has(m.id), translateOn: translateOn.has(m.id) },
    ).items.filter((i) => i.id !== 'open_coach' || !!onOpenInCoach);
  const openMenu = (m: ClaudeChatMessage, anchor: MenuAnchor) => {
    if (m.queued || m.queueFailed) return;
    if (menuFor(m).length > 0) setMenu({ m, anchor });
  };
  const onMenuAction = (id: MenuActionId) => {
    if (!menu) return;
    const m = menu.m;
    setMenu(null);
    tool(id, m.role === 'user' ? 'mine' : 'claude');
    switch (id) {
      case 'say_better':
        setSayBetterFor(m);
        break;
      case 'open_coach':
        onOpenInCoach?.(m, 'menu');
        break;
      case 'copy':
        void navigator.clipboard?.writeText(m.text).catch(() => undefined);
        break;
      case 'translate':
        void translate(m);
        break;
      case 'pinyin':
        setPinyinOn((set) => flip(set, m.id));
        break;
      case 'explain':
        setExplain({ text: m.text.trim(), mode: 'explain' });
        break;
      case 'save_card':
        setExplain({ text: m.text.trim(), mode: 'save' });
        break;
      case 'play':
        void play(m);
        break;
      default:
        break;
    }
  };
  /** The gestures that open the menu on a finished bubble (long press, right-click). */
  const menuGestures = (m: ClaudeChatMessage) => ({
    ...press.bind(() => openMenu(m, null)),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      openMenu(m, { x: e.clientX, y: e.clientY });
    },
  });

  return (
    <div className="ask-thread claude-chat-thread" data-testid="claude-chat-thread">
      {messages.map((m) => {
        if (m.role === 'user') {
          return (
            <MineBubble
              key={m.id}
              m={m}
              known={known}
              pinyin={pinyinOn.has(m.id)}
              translateOn={translateOn.has(m.id)}
              translation={m.translation ?? translations[m.id] ?? null}
              translateFailed={translations[m.id] === null && !m.translation}
              onTapWord={(w) => tapWord(w, 'mine')}
              onDiscard={onDiscardQueued}
              gestures={menuGestures(m)}
              suppressTap={press.suppressTap}
              menuOpen={menu?.m.id === m.id}
              onMenu={(anchor) => openMenu(m, anchor)}
              onOpenCoach={onOpenInCoach ? () => { tool('open_coach', 'mine'); onOpenInCoach(m, 'chip'); } : undefined}
            />
          );
        }
        if ((m.content_type ?? 'text') !== 'text' && renderSpecial) {
          return <div key={m.id} className="claude-chat-special" data-testid="claude-chat-special">{renderSpecial(m)}</div>;
        }
        if (m.status === 'pending' && m.text) {
          return <StreamingBubble key={m.id} m={m} statusLine={statusLineFor?.(m) ?? null} />;
        }
        if (m.status === 'pending') {
          return (
            <div key={m.id} className="chat-message received group-first group-last" data-testid="claude-chat-pending">
              <div className="chat-message-content">
                <div className="chat-bubble claude-chat-thinking">
                  <span className="chat-spinner" aria-hidden="true" /> {statusLineFor?.(m) ?? thinkingLabel}
                </div>
              </div>
            </div>
          );
        }
        if (m.status === 'failed') {
          return (
            <div key={m.id} className="coach-error claude-chat-failed" role="alert" data-testid="claude-chat-failed">
              {m.error || 'Claude couldn’t answer — try again.'}
              <button type="button" className="coach-error-retry" onClick={() => onRetry(m)} disabled={retryingId === m.id} data-testid="claude-chat-retry">
                {retryingId === m.id ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          );
        }
        if (hidden(m)) {
          const playingThis = listenPlayer.playingId === m.id;
          return (
            <HiddenBubble
              key={m.id}
              m={m}
              playing={playingThis}
              loading={listenPlayer.loadingId === m.id}
              progress={playingThis ? listenPlayer.progress : 0}
              durationSec={listenPlayer.durations[m.id] ?? null}
              slow={listenPlayer.slow}
              onToggleSlow={listenPlayer.toggleSlow}
              notice={notice?.id === m.id ? notice.text : null}
              onListen={() => listen(m.id, m.text)}
              onReveal={() => reveal(m)}
            />
          );
        }
        const after = renderAfter?.(m);
        const bubble = (
          <ClaudeBubble
            key={m.id}
            threadId={threadId}
            m={m}
            known={known}
            pinyin={pinyinOn.has(m.id)}
            translateOn={translateOn.has(m.id)}
            translation={m.translation ?? translations[m.id] ?? null}
            translateFailed={translations[m.id] === null && !m.translation}
            playing={playing === m.id}
            onPlay={() => void play(m)}
            onPinyin={() => {
              tool('pinyin', 'claude');
              setPinyinOn((s) => flip(s, m.id));
            }}
            onTranslate={() => void translate(m)}
            onTapWord={(w) => tapWord(w, 'claude')}
            gestures={menuGestures(m)}
            suppressTap={press.suppressTap}
            menuOpen={menu?.m.id === m.id}
            onMenu={(anchor) => openMenu(m, anchor)}
            onStopAudio={() => {
              playerRef.current.stop();
              setPlaying(null);
              listenPlayer.stop();
            }}
          />
        );
        return after ? (
          <div key={m.id} className="claude-chat-with-after">
            {bubble}
            {after}
          </div>
        ) : bubble;
      })}
      {pendingText && (
        <div className="chat-message sent group-first group-last">
          <div className="chat-message-content">
            <div className="chat-bubble pending">{pendingText}</div>
          </div>
        </div>
      )}
      {menu && (
        <MessageMenu
          senderName={menu.m.role === 'user' ? 'You' : 'Claude'}
          preview={menu.m.text}
          items={menuFor(menu.m)}
          reactions={false}
          isOnline={online}
          anchor={menu.anchor}
          quickEmojis={[]}
          recentEmojis={[]}
          allEmojis={[]}
          onAction={onMenuAction}
          onReact={() => undefined}
          onClose={() => setMenu(null)}
        />
      )}
      {explain && <ExplainSheet text={explain.text} mode={explain.mode} isOnline={online} onClose={() => setExplain(null)} />}
      {sayBetterFor && (
        <SayBetterSheet
          message={asChatMessage(messages.find((x) => x.id === sayBetterFor.id) ?? sayBetterFor)}
          viewerId={ME}
          tutorName="Claude"
          playing={playing === `better:${sayBetterFor.id}`}
          onPlay={(text) => void play({ ...sayBetterFor, id: `better:${sayBetterFor.id}`, text })}
          onDiscuss={() => {
            const corrected = sayBetterFor.auto_check?.corrected ?? sayBetterFor.text;
            setSayBetterFor(null);
            onDraft?.(language === 'zh' ? `为什么「${corrected}」更好？` : `Why is "${corrected}" better?`);
          }}
          onOpenCoach={
            onOpenInCoach
              ? () => {
                  const m = sayBetterFor;
                  setSayBetterFor(null);
                  onOpenInCoach(m, 'sheet');
                }
              : undefined
          }
          onClose={() => setSayBetterFor(null)}
        />
      )}
    </div>
  );
}

/** The ⋯ beside a bubble (desktop hover; the menu without a long press). */
function HoverMenuButton({ onMenu }: { onMenu: (anchor: MenuAnchor) => void }) {
  return (
    <div className="chat-hover-tools">
      <button type="button" className="chat-hover-btn" aria-label="Message actions" onClick={(e) => onMenu({ x: e.clientX, y: e.clientY })}>
        ⋯
      </button>
    </div>
  );
}

interface BubbleGestures {
  gestures: Record<string, unknown>;
  suppressTap: () => boolean;
  menuOpen: boolean;
  onMenu: (anchor: MenuAnchor) => void;
}

function MineBubble({ m, known, pinyin, translateOn, translation, translateFailed, onTapWord, onDiscard, gestures, suppressTap, menuOpen, onMenu, onOpenCoach }: {
  m: ClaudeChatMessage;
  known: Set<string>;
  pinyin: boolean;
  translateOn: boolean;
  translation: string | null;
  translateFailed: boolean;
  onTapWord: (w: TappedWord) => void;
  onDiscard?: (m: ClaudeChatMessage) => void;
  onOpenCoach?: () => void;
} & BubbleGestures) {
  const asMessage = asChatMessage(m);
  const better = !m.queued && !m.queueFailed ? sayBetterState(asMessage, ME) : null;
  const sent = !m.queued && !m.queueFailed;
  return (
    <div className={`chat-message sent group-first group-last${menuOpen ? ' menu-open' : ''}`} data-testid="claude-chat-mine" data-queued={m.queued ? 'true' : undefined}>
      <div className="chat-message-content">
        <div className="chat-bubble-row">
          <div className={`chat-bubble${m.queued ? ' pending' : ''}`} {...(sent ? gestures : {})}>
            {looksLikeChinese(m.text) ? <ChatWordsText text={m.text} words={null} showPinyin={pinyin} known={known} onTapWord={onTapWord} suppressTap={suppressTap} /> : <span className="chat-text">{m.text}</span>}
            {translateOn && <ChatTranslation text={translation ?? (translateFailed ? "Couldn't translate — hold to try again" : null)} />}
            {better && (
              <span className="chat-bubble-meta">
                <SayBetterMark state={better} label={sayBetterLabel(better)} />
              </span>
            )}
          </div>
          {sent && <HoverMenuButton onMenu={onMenu} />}
        </div>
        {sent && onOpenCoach && showCoachChip(asMessage, ME) && <CoachChip onClick={onOpenCoach} />}
        {m.queued && (
          <div className="claude-chat-queued" data-testid="claude-chat-queued">
            🕓 Will send when you’re online
          </div>
        )}
        {m.queueFailed && (
          <div className="claude-chat-queued failed" role="alert" data-testid="claude-chat-queue-failed">
            Couldn’t send: {m.error || 'refused'}
            {onDiscard && (
              <button type="button" className="claude-chat-queued-discard" onClick={() => onDiscard(m)} aria-label="Remove this message">
                ✕
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A reply being written: its text so far (plain Chinese, or Markdown), a caret, what Claude is doing. */
function StreamingBubble({ m, statusLine }: { m: ClaudeChatMessage; statusLine: string | null }) {
  return (
    <div className="chat-message received group-first group-last" data-testid="claude-chat-streaming" aria-live="polite" aria-busy="true">
      <div className="chat-message-content">
        <div className="chat-bubble claude-chat-streaming">
          {m.answer_lang === 'zh' ? (
            <span className="chat-text claude-chat-stream-text">{m.text}</span>
          ) : (
            <div className="claude-response">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
            </div>
          )}
          <span className="claude-chat-caret" aria-hidden="true" />
        </div>
        {statusLine && <div className="claude-chat-status-line">{statusLine}</div>}
      </div>
    </div>
  );
}

function HiddenBubble(props: {
  m: ClaudeChatMessage;
  playing: boolean;
  loading: boolean;
  progress: number;
  durationSec: number | null;
  slow: boolean;
  onToggleSlow: () => void;
  notice: string | null;
  onListen: () => void;
  onReveal: () => void;
}) {
  const press = useLongPress();
  const { m } = props;
  return (
    <div className="chat-message received group-first group-last" data-testid="claude-chat-reply" data-hidden="true">
      <div className="chat-message-content">
        <div className="chat-bubble-row">
          <div
            className="chat-bubble listening"
            data-testid="claude-chat-listening-bubble"
            role="button"
            tabIndex={0}
            aria-label="Claude's answer, hidden. Tap to listen, hold to reveal"
            {...press.bind(props.onReveal)}
            onClick={() => {
              if (press.suppressTap()) return;
              props.onListen();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (press.suppressTap()) return;
              props.onReveal();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                props.onListen();
              }
            }}
          >
            <ListeningBubble
              messageId={m.id}
              text={m.text}
              playing={props.playing}
              loading={props.loading}
              progress={props.progress}
              durationSec={props.durationSec}
              slow={props.slow}
              onToggleSlow={props.onToggleSlow}
            />
          </div>
          <button type="button" className="chat-listening-reveal" onClick={props.onReveal} aria-label="Reveal the answer" title="Reveal" data-testid="claude-chat-reveal">
            👁
          </button>
        </div>
        {props.notice && (
          <p className="ask-listen-notice" role="status">
            {props.notice}
          </p>
        )}
      </div>
    </div>
  );
}

function ClaudeBubble(props: {
  threadId: string;
  m: ClaudeChatMessage;
  known: Set<string>;
  pinyin: boolean;
  translateOn: boolean;
  translation: string | null;
  translateFailed: boolean;
  playing: boolean;
  onPlay: () => void;
  onPinyin: () => void;
  onTranslate: () => void;
  onTapWord: (w: TappedWord) => void;
  onStopAudio: () => void;
} & BubbleGestures) {
  const { m } = props;
  const offered = readBackOffered({ role: m.role, content: m.text, answer_lang: m.answer_lang, status: m.status });
  const segments = useSegmentedWords(m.text, offered);
  const segRef = useRef<string[]>([]);
  segRef.current = segments ? segments.map((w) => w.text) : [];
  const readBack = useReadAloud(
    m.text,
    {
      // He reads: anything playing stops so it doesn't talk over him.
      onStart: props.onStopAudio,
      onResult: (r: ReadAloudResult) => {
        recordRecapWords(props.threadId, readBackMistakeWords(m.text, segRef.current, r));
      },
    },
    {
      surface: 'claude_chat_read_back',
      event: 'coach.ask_read_back',
      props: (r) => ({ wrong_words: r ? readBackMistakeWords(m.text, segRef.current, r).length : 0 }),
    },
  );
  const listeningNow = readBack.dictation.state.phase === 'listening';
  const result = listeningNow ? null : readBack.result;

  const open = props.menuOpen ? ' menu-open' : '';
  if (m.answer_lang !== 'zh' && !looksLikeChinese(m.text)) {
    return (
      <div className={`chat-message received group-first group-last${open}`} data-testid="claude-chat-reply">
        <div className="chat-message-content">
          <div className="chat-bubble-row">
            <div className="chat-bubble" {...props.gestures}>
              <div className="claude-response">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
              </div>
            </div>
            <HoverMenuButton onMenu={props.onMenu} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={`chat-message received group-first group-last${open}`} data-testid="claude-chat-reply" data-bucket={readBack.result ? readAloudBucket(readBack.result.pct) : undefined}>
      <div className="chat-message-content">
        <div className="chat-bubble-row">
        <div className="chat-bubble" {...props.gestures}>
          {m.answer_lang === 'zh' ? (
            <ChatWordsText text={m.text} words={segments} showPinyin={props.pinyin} known={props.known} onTapWord={props.onTapWord} marks={result} suppressTap={props.suppressTap} />
          ) : (
            <div className="claude-response">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
            </div>
          )}
          {props.translateOn && <ChatTranslation text={props.translation ?? (props.translateFailed ? "Couldn't translate — tap EN to try again" : null)} />}
        </div>
        <HoverMenuButton onMenu={props.onMenu} />
        </div>
        {offered && (
          <>
            <div className="claude-chat-tools" role="group" aria-label="Message tools">
              <button type="button" className={`claude-chat-tool${props.playing ? ' on' : ''}`} onClick={props.onPlay} aria-label={props.playing ? 'Stop' : 'Listen'} data-testid="claude-chat-play">
                {props.playing ? '■' : '▶'}
              </button>
              <button type="button" className={`claude-chat-tool${props.pinyin ? ' on' : ''}`} onClick={props.onPinyin} aria-pressed={props.pinyin} aria-label="Pinyin" data-testid="claude-chat-pinyin">
                拼
              </button>
              <button type="button" className={`claude-chat-tool${props.translateOn ? ' on' : ''}`} onClick={props.onTranslate} aria-pressed={props.translateOn} aria-label="English" data-testid="claude-chat-translate">
                EN
              </button>
              <ReadAloudMic ra={readBack} idleLabel={READ_BACK_LABEL} testId="claude-chat-read-back" />
              {!readBack.result && readBack.dictation.state.phase === 'idle' && <span className="claude-chat-tool-hint">{READ_BACK_LABEL}</span>}
            </div>
            <div className="claude-chat-read-back">
              <ReadAloudPanel ra={readBack} listeningText={READ_BACK_LISTENING} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
