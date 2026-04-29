import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getSituations,
  startRoleplay,
  replyRoleplay,
  revealRoleplayMessage,
  getRoleplayMessageImage,
  completeRoleplay,
  getDecks,
  createNote,
  getReaderImageUrl,
  type Situation,
  type RoleplayMessage,
  type RoleplayChunk,
} from '../api/client';
import { SituationPicker } from '../components/SituationPicker';
import './RoleplayPage.css';

type AiBubble = RoleplayMessage & { audio?: string | null; revealStage: number };

export function RoleplayPage() {
  const navigate = useNavigate();
  const [situations, setSituations] = useState<Situation[]>([]);
  const [sit, setSit] = useState<Situation | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiBubble[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingChunk, setAddingChunk] = useState<RoleplayChunk | null>(null);
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

  useEffect(() => {
    const pending = messages.filter((m) => m.role === 'ai' && !m.image_url).map((m) => m.id);
    if (pending.length === 0) return;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts++;
      for (const id of pending) {
        const r = await getRoleplayMessageImage(id).catch(() => null);
        if (r?.image_url) {
          setMessages((ms) =>
            ms.map((m) => (m.id === id ? { ...m, image_url: r.image_url } : m)),
          );
        }
      }
      if (attempts >= 12) clearInterval(timer);
    }, 2000);
    return () => clearInterval(timer);
  }, [messages.length]);

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
      const msg: AiBubble = { ...r.message, audio: r.audio_base64, revealStage: 0 };
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
      {
        id: `u-${Date.now()}`,
        role: 'user',
        hanzi: text,
        pinyin: null,
        english: null,
        chunks: null,
        image_url: null,
        revealed: false,
        revealStage: 0,
      },
    ]);
    setBusy(true);
    try {
      const r = await replyRoleplay(sessionId, text);
      const msg: AiBubble = { ...r.message, audio: r.audio_base64, revealStage: 0 };
      setMessages((m) => [...m, msg]);
      playAudio(r.audio_base64);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function bumpReveal(id: string) {
    setMessages((m) =>
      m.map((x) => {
        if (x.id !== id) return x;
        const next = Math.min(x.revealStage + 1, 3);
        if (x.revealStage === 0 && next === 1) {
          void revealRoleplayMessage(id).catch(() => {});
        }
        return { ...x, revealStage: next, revealed: next > 0 };
      }),
    );
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
            <div key={m.id} className="rp-ai-block">
              {m.image_url ? (
                <img
                  className="rp-image"
                  src={getReaderImageUrl(m.image_url)}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="rp-image placeholder" />
              )}
              <div className="rp-msg ai">
                <button className="rp-replay" onClick={() => playAudio(m.audio)}>
                  🔊
                </button>
                <div className="rp-content">
                  {m.revealStage >= 1 && (
                    <div className="rp-hanzi">
                      {m.chunks
                        ? m.chunks.map((c, i) => (
                            <button
                              key={i}
                              className="rp-chunk"
                              onClick={() => setAddingChunk(c)}
                            >
                              {c.hanzi}
                            </button>
                          ))
                        : m.hanzi}
                    </div>
                  )}
                  {m.revealStage >= 2 && <div className="rp-pinyin">{m.pinyin}</div>}
                  {m.revealStage >= 3 && <div className="rp-english">{m.english}</div>}
                  {m.revealStage < 3 && (
                    <button className="rp-reveal-btn" onClick={() => bumpReveal(m.id)}>
                      {m.revealStage === 0
                        ? 'Show characters'
                        : m.revealStage === 1
                          ? 'Show pinyin'
                          : 'Show English'}
                    </button>
                  )}
                </div>
              </div>
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
      {addingChunk && (
        <AddChunkModal chunk={addingChunk} onClose={() => setAddingChunk(null)} />
      )}
    </div>
  );
}

function AddChunkModal(props: { chunk: RoleplayChunk; onClose: () => void }) {
  const { chunk, onClose } = props;
  const [decks, setDecks] = useState<Array<{ id: string; name: string }>>([]);
  const [deckId, setDeckId] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getDecks()
      .then((d) => {
        setDecks(d.map((x) => ({ id: x.id, name: x.name })));
        if (d[0]) setDeckId(d[0].id);
      })
      .catch(() => {});
  }, []);

  async function add() {
    if (!deckId) return;
    setBusy(true);
    setErr(null);
    try {
      await createNote(deckId, {
        hanzi: chunk.hanzi,
        pinyin: chunk.pinyin,
        english: chunk.english,
      });
      setDone(true);
      setTimeout(onClose, 800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rp-modal-backdrop" onClick={onClose}>
      <div className="rp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rp-modal-hanzi">{chunk.hanzi}</div>
        <div className="rp-pinyin">{chunk.pinyin}</div>
        <div className="rp-english">{chunk.english}</div>
        {err && <div className="rp-error" style={{ marginTop: '0.5rem' }}>{err}</div>}
        <select
          value={deckId}
          onChange={(e) => setDeckId(e.target.value)}
          className="rp-input"
          style={{ minHeight: 'auto', marginTop: '0.75rem' }}
        >
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <div className="exercise-actions" style={{ marginTop: '0.75rem' }}>
          <button className="rp-finish" onClick={onClose}>
            Cancel
          </button>
          <button className="rp-send" onClick={add} disabled={busy || !deckId}>
            {done ? '✓ Added' : busy ? 'Adding…' : 'Add to deck'}
          </button>
        </div>
      </div>
    </div>
  );
}
