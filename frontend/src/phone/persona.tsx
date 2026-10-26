/**
 * Chats with the people inside the simulated apps (docs/PHONE_PRACTICE.md "Personas"): the
 * transcript lives in the event log (`persona.message`), replies come from the worker's
 * POST /api/phone/persona-reply (Claude playing the persona; a canned stand-in in E2E), and the
 * actions a reply carries become `persona.action` events the goals check. Offline → the message
 * waits with "对方暂时无法回复（需要联网）" and a retry; the rest of the phone keeps working.
 *
 * `AppChat` is the chat screen the ride / food / restaurant apps use (the messenger has its own
 * look, apps/ChatApp.tsx, on the same hook).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findPersona, ZH, type PersonaMessage } from '@shared/phone';
import { requestPersonaReply } from '../api/phone';
import { track } from '../services/analytics';
import { usePhone } from './runtime';
import { AppBar, PhoneMic } from './ui';

export interface ChatLine {
  from: 'me' | 'them';
  text: string;
  english?: string;
  at: number;
  /** A note the app added for the persona (a transfer), drawn by the app itself. */
  system?: boolean;
}

export function usePersona(personaId: string | undefined, context?: string) {
  const p = usePhone();
  const persona = personaId ? findPersona(p.spec, personaId) : null;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<'offline' | 'failed' | null>(null);
  const abort = useRef<AbortController | null>(null);

  const lines: ChatLine[] = useMemo(
    () =>
      p.events
        .filter((e) => e.type === 'persona.message' && e.persona === personaId)
        .map((e) => ({ from: e.from === 'me' ? 'me' : 'them', text: String(e.text ?? ''), english: typeof e.english === 'string' ? e.english : undefined, at: e.at, system: e.system === true })),
    [p.events, personaId],
  );
  const linesRef = useRef(lines);
  linesRef.current = lines;

  /** The persona's opening line (once). */
  const start = useCallback(() => {
    if (!persona?.opening) return;
    if (linesRef.current.some((l) => l.from === 'them')) return;
    p.emit({ type: 'persona.message', persona: persona.id, from: 'them', text: persona.opening });
  }, [p, persona]);

  const ask = useCallback(
    async (history: PersonaMessage[], via: string) => {
      if (!persona) return;
      if (!p.online) {
        setError('offline');
        track('phone.persona_message', { scenario: p.spec.id, persona: persona.id, turn: history.filter((m) => m.from === 'me').length, actions: 0, outcome: 'offline', via });
        return;
      }
      setPending(true);
      setError(null);
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      try {
        const reply = await requestPersonaReply({ scenario_id: p.spec.id, persona_id: persona.id, messages: history, context }, ctl.signal);
        p.emit({ type: 'persona.message', persona: persona.id, from: 'them', text: reply.reply, english: reply.english });
        for (const a of reply.actions) p.emit({ type: 'persona.action', persona: persona.id, action: a.name, params: a.params });
        track('phone.persona_message', { scenario: p.spec.id, persona: persona.id, turn: history.filter((m) => m.from === 'me').length, actions: reply.actions.length, outcome: 'ok', via });
      } catch (err) {
        if (ctl.signal.aborted) return;
        const offline = !navigator.onLine || (err as { status?: number }).status === 0;
        setError(offline ? 'offline' : 'failed');
        track('phone.persona_message', { scenario: p.spec.id, persona: persona.id, turn: history.filter((m) => m.from === 'me').length, actions: 0, outcome: offline ? 'offline' : 'failed', via });
      } finally {
        if (abort.current === ctl) {
          abort.current = null;
          setPending(false);
        }
      }
    },
    [p, persona, context],
  );

  const send = useCallback(
    (text: string, via: 'typed' | 'voice' | 'quick' = 'typed') => {
      const t = text.trim();
      if (!t || !persona) return;
      p.emit({ type: 'persona.message', persona: persona.id, from: 'me', text: t });
      const history: PersonaMessage[] = [...linesRef.current.map((l) => ({ from: l.from, text: l.text })), { from: 'me', text: t }];
      void ask(history, via);
    },
    [ask, p, persona],
  );

  /** A note the persona sees in the chat (a transfer: "[转账] ¥6500.00 押金") — asks for a reply. */
  const sendEvent = useCallback(
    (text: string) => {
      if (!persona) return;
      p.emit({ type: 'persona.message', persona: persona.id, from: 'me', text, system: true });
      void ask([...linesRef.current.map((l) => ({ from: l.from, text: l.text })), { from: 'me', text }], 'quick');
    },
    [ask, p, persona],
  );

  const retry = useCallback(() => void ask(linesRef.current.map((l) => ({ from: l.from, text: l.text })), 'typed'), [ask]);

  useEffect(() => () => abort.current?.abort(), []);

  return { persona, lines, pending, error, start, send, sendEvent, retry };
}

/** One of their bubbles: tap 译 for the English (stored with the message). */
export function TheirBubble(props: { line: ChatLine; avatar?: string; color?: string }) {
  const [en, setEn] = useState(false);
  return (
    <div className="ph-msg ph-msg-them">
      <span className="ph-msg-avatar" style={{ background: props.color ?? '#9aa5b1' }}>
        {props.avatar ?? '人'}
      </span>
      <div className="ph-msg-col">
        <div className="ph-msg-bubble" lang="zh-CN">
          {props.line.text}
        </div>
        {props.line.english && (
          <button type="button" className="ph-msg-tr" onClick={() => setEn((v) => !v)} aria-pressed={en} data-testid="persona-translate">
            {en ? props.line.english : '译'}
          </button>
        )}
      </div>
    </div>
  );
}

/** The chat screen of the ride / food / restaurant apps. */
export function AppChat(props: {
  personaId: string;
  title: string;
  subtitle?: string;
  context?: string;
  quick?: string[];
  accent: string;
  avatar?: string;
  onBack: () => void;
  testId?: string;
  /** The grey line at the top of the chat. */
  tip?: string;
}) {
  const chat = usePersona(props.personaId, props.context);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const { start } = chat;
  useEffect(() => {
    start();
  }, [start]);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.lines.length, chat.pending, chat.error]);

  const sendDraft = (via: 'typed' | 'voice' | 'quick' = 'typed', text = draft) => {
    if (!text.trim()) return;
    chat.send(text, via);
    setDraft('');
  };

  return (
    <div className="ph-chat" data-testid={props.testId ?? 'persona-chat'}>
      <AppBar title={<span className="ph-chat-title">{props.title}{props.subtitle && <small>{props.subtitle}</small>}</span>} onBack={props.onBack} />
      <div className="ph-chat-list" ref={listRef}>
        <div className="ph-chat-tip">{props.tip ?? '为保护隐私，号码已加密，聊天内容仅在订单进行中可见'}</div>
        {chat.lines.filter((l) => !l.system).map((l, i) =>
          l.from === 'me' ? (
            <div key={i} className="ph-msg ph-msg-me">
              <div className="ph-msg-bubble" style={{ background: props.accent }} lang="zh-CN">
                {l.text}
              </div>
            </div>
          ) : (
            <TheirBubble key={i} line={l} avatar={props.avatar} color={props.accent} />
          ),
        )}
        {chat.pending && <div className="ph-chat-typing">对方正在输入…</div>}
        {chat.error && (
          <div className="ph-chat-error" data-testid="persona-error">
            {chat.error === 'offline' ? ZH.needsConnection : '消息发送失败'}
            <button type="button" onClick={chat.retry}>
              重试
            </button>
          </div>
        )}
      </div>
      {props.quick && props.quick.length > 0 && (
        <div className="ph-chat-quick">
          {props.quick.map((q) => (
            <button key={q} type="button" onClick={() => sendDraft('quick', q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      <div className="ph-chat-input">
        <PhoneMic onText={(t) => setDraft((d) => d + t)} testId="persona-mic" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="输入消息…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) sendDraft();
          }}
          data-testid="persona-input"
          lang="zh-CN"
          enterKeyHint="send"
        />
        <button type="button" className="ph-chat-send" style={{ background: draft.trim() ? props.accent : undefined }} disabled={!draft.trim()} onClick={() => sendDraft()} data-testid="persona-send">
          发送
        </button>
      </div>
    </div>
  );
}
