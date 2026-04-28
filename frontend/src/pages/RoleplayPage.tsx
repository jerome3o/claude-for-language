import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getSituations,
  startRoleplay,
  replyRoleplay,
  revealRoleplayMessage,
  completeRoleplay,
  type Situation,
  type RoleplayMessage,
} from '../api/client';
import { SituationPicker } from '../components/SituationPicker';
import './RoleplayPage.css';

type AiBubble = RoleplayMessage & { audio?: string | null };

export function RoleplayPage() {
  const navigate = useNavigate();
  const [situations, setSituations] = useState<Situation[]>([]);
  const [sit, setSit] = useState<Situation | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiBubble[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getSituations()
      .then((r) => setSituations(r.situations))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => () => audioRef.current?.pause(), []);

  function playAudio(b64: string | null | undefined) {
    audioRef.current?.pause();
    if (!b64) return;
    const a = new Audio(`data:audio/mpeg;base64,${b64}`);
    audioRef.current = a;
    void a.play().catch(() => {});
  }

  async function begin(s: Situation) {
    setSit(s);
    setBusy(true);
    setError(null);
    try {
      const r = await startRoleplay(s.id);
      setSessionId(r.session_id);
      const msg: AiBubble = { ...r.message, audio: r.audio_base64 };
      setMessages([msg]);
      playAudio(r.audio_base64);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSit(null);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!input.trim() || !sessionId || busy) return;
    const text = input.trim();
    setInput('');
    setMessages((m) => [
      ...m,
      { id: `u-${Date.now()}`, role: 'user', hanzi: text, pinyin: null, english: null, revealed: false },
    ]);
    setBusy(true);
    try {
      const r = await replyRoleplay(sessionId, text);
      const msg: AiBubble = { ...r.message, audio: r.audio_base64 };
      setMessages((m) => [...m, msg]);
      playAudio(r.audio_base64);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function reveal(id: string) {
    setMessages((m) => m.map((x) => (x.id === id ? { ...x, revealed: true } : x)));
    void revealRoleplayMessage(id).catch(() => {});
  }

  async function finish() {
    if (sessionId) await completeRoleplay(sessionId).catch(() => {});
    navigate('/');
  }

  if (!sit) {
    return (
      <div className="roleplay-page">
        <h1>Role play</h1>
        <p className="rp-sub">
          Pick a situation. You'll hear the other person speak first — try to reply from the audio
          alone. Tap a message to see the characters and translation if you need them.
        </p>
        {error && <div className="rp-error">{error}</div>}
        <SituationPicker situations={situations} busy={busy} onPick={begin} />
      </div>
    );
  }

  const revealedCount = messages.filter((m) => m.role === 'ai' && m.revealed).length;
  const aiCount = messages.filter((m) => m.role === 'ai').length;

  return (
    <div className="roleplay-page chat">
      <div className="rp-context">
        <div className="rp-context-title">{sit.title}</div>
        <div className="rp-context-scenario">{sit.scenario}</div>
        <div className="rp-context-goal">
          <strong>Goal:</strong> {sit.goal}
        </div>
      </div>

      <div className="rp-thread">
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="rp-msg user">
              {m.hanzi}
            </div>
          ) : (
            <div key={m.id} className="rp-msg ai">
              <button className="rp-replay" onClick={() => playAudio(m.audio)}>
                🔊
              </button>
              {m.revealed ? (
                <div className="rp-revealed">
                  <div className="rp-hanzi">{m.hanzi}</div>
                  <div className="rp-pinyin">{m.pinyin}</div>
                  <div className="rp-english">{m.english}</div>
                </div>
              ) : (
                <button className="rp-reveal-btn" onClick={() => reveal(m.id)}>
                  Tap to show text
                </button>
              )}
            </div>
          ),
        )}
        {busy && <div className="rp-msg ai pending">…</div>}
        <div ref={endRef} />
      </div>

      <div className="rp-input-row">
        <textarea
          className="rp-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Speak or type your reply in Chinese…"
          rows={2}
          lang="zh-CN"
          disabled={busy}
        />
        <button className="rp-send" onClick={send} disabled={!input.trim() || busy}>
          Send
        </button>
      </div>

      <div className="rp-footer">
        <span className="rp-stat">
          Looked at text: {revealedCount}/{aiCount}
        </span>
        <button className="rp-finish" onClick={finish}>
          Finish
        </button>
      </div>
      {error && <div className="rp-error">{error}</div>}
    </div>
  );
}
