/**
 * 🧪 A live group class (EXPERIMENTAL web-only prototype, docs/GROUP_CLASSES.md)
 * — `/group-class/:id`, immersive. A gallery of everyone's camera (the active
 * speaker ringed), the tutor's spotlight or a shared screen big on top, and a
 * side panel (a bottom sheet on phones): People (hands, the tutor's mute /
 * spotlight), Board (the 1:1 call's shared text board), Chat, Quiz.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { galleryGrid, galleryOrder, stageOf, QUIZ_MAX_OPTIONS, type GroupPeer, type GroupQuizView } from '@shared/group';
import { useAuth } from '../../contexts/AuthContext';
import { getGroupSession, type GroupSession, type GroupSummary } from '../../api/groupClasses';
import { TextBoard } from '../../components/calls/TextBoard';
import { useGroupClass, type GroupClassState } from './useGroupClass';
import '../CallPage.css';
import './group.css';

type Panel = 'people' | 'board' | 'chat' | 'quiz';

function GroupVideo({ stream, muted, mirrored, testId }: { stream: MediaStream | null; muted: boolean; mirrored?: boolean; testId?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) void el.play().catch(() => {});
  }, [stream]);
  return <video ref={ref} className={`gcl-video${mirrored ? ' is-mirrored' : ''}`} autoPlay playsInline muted={muted} data-testid={testId} />;
}

function useBoxSize<T extends HTMLElement>(): [{ width: number; height: number }, React.RefObject<T>] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [size, ref];
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

interface Person {
  peer: GroupPeer;
  stream: MediaStream | null;
  isMe: boolean;
  connection?: RTCPeerConnectionState;
}

function Tile({ person, g, style }: { person: Person; g: GroupClassState; style?: React.CSSProperties }) {
  const { peer, stream, isMe } = person;
  const mutedByTutor = g.room.muted.includes(peer.user_id);
  const hand = g.room.hands.some((h) => h.user_id === peer.user_id);
  const camOn = isMe ? g.cam && !!stream?.getVideoTracks().length : peer.state.cam;
  const micOn = isMe ? g.mic : peer.state.mic && !mutedByTutor;
  const canControl = g.isTutor && !isMe && peer.role === 'student';
  return (
    <div
      className={`gcl-tile${g.speaker === peer.user_id ? ' is-speaking' : ''}${hand ? ' has-hand' : ''}`}
      style={style}
      data-testid="group-tile"
      data-user={peer.user_id}
      data-speaking={g.speaker === peer.user_id ? '1' : undefined}
    >
      {/* Audio plays from here (exactly once per person); a muted student is silenced on every page. */}
      <GroupVideo stream={stream} muted={isMe || mutedByTutor} mirrored={isMe} />
      {!camOn && (
        <div className="gcl-tile-off">
          {peer.picture_url ? <img src={peer.picture_url} alt="" /> : <span>{Array.from(peer.name)[0] ?? '?'}</span>}
        </div>
      )}
      <div className="gcl-tile-label">
        {!micOn && <span title={mutedByTutor ? 'Muted by the tutor' : 'Mic off'}>{mutedByTutor ? '🔇' : '🎙️̸'}</span>}
        <span className="gcl-tile-name">{isMe ? `${peer.name} (you)` : peer.name}</span>
        {peer.role === 'tutor' && <span className="gcl-chip">Tutor</span>}
        {person.connection && person.connection !== 'connected' && !isMe && <span className="gcl-chip gcl-chip-warn">{person.connection === 'failed' ? 'no link' : 'connecting'}</span>}
      </div>
      {hand && <span className="gcl-hand" aria-label="Hand raised">✋</span>}
      {canControl && (
        <div className="gcl-tile-tools">
          <button type="button" onClick={() => g.control({ kind: 'mute', user_id: peer.user_id, muted: !mutedByTutor })} title={mutedByTutor ? 'Let them speak' : 'Mute'} data-testid="tile-mute">
            {mutedByTutor ? '🔈' : '🔇'}
          </button>
          <button type="button" onClick={() => g.control({ kind: 'spotlight', user_id: g.room.spotlight === peer.user_id ? null : peer.user_id })} title="Spotlight" data-testid="tile-spotlight">
            ⭐
          </button>
          {hand && (
            <button type="button" onClick={() => g.control({ kind: 'lower_hand', user_id: peer.user_id })} title="Lower hand">
              ✋↓
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PeoplePanel({ g, people }: { g: GroupClassState; people: Person[] }) {
  const handOrder = new Map(g.room.hands.map((h, i) => [h.user_id, i + 1]));
  return (
    <div className="gcl-people">
      {g.isTutor && (
        <div className="gcl-panel-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => g.control({ kind: 'mute_all' })} data-testid="mute-all">🔇 Mute all students</button>
          {g.room.spotlight && <button type="button" className="btn btn-secondary btn-sm" onClick={() => g.control({ kind: 'spotlight', user_id: null })}>End spotlight</button>}
        </div>
      )}
      <ul>
        {people.map(({ peer, isMe }) => {
          const muted = g.room.muted.includes(peer.user_id);
          return (
            <li key={peer.client_id} className="gcl-person">
              <span className="gcl-person-name">
                {handOrder.has(peer.user_id) && <span title="Hand raised">✋{handOrder.get(peer.user_id)} </span>}
                {peer.name}
                {isMe && ' (you)'}
                {peer.role === 'tutor' && <span className="gcl-chip">Tutor</span>}
                {g.room.spotlight === peer.user_id && <span className="gcl-chip">⭐ Spotlight</span>}
              </span>
              <span className="gcl-person-state">{muted ? '🔇 muted by tutor' : peer.state.mic ? '🎤' : 'mic off'}</span>
              {g.isTutor && peer.role === 'student' && (
                <span className="gcl-person-tools">
                  <button type="button" onClick={() => g.control({ kind: 'mute', user_id: peer.user_id, muted: !muted })} data-testid="person-mute">{muted ? 'Allow' : 'Mute'}</button>
                  <button type="button" onClick={() => g.control({ kind: 'spotlight', user_id: g.room.spotlight === peer.user_id ? null : peer.user_id })}>⭐</button>
                  {handOrder.has(peer.user_id) && <button type="button" onClick={() => g.control({ kind: 'lower_hand', user_id: peer.user_id })}>✋↓</button>}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ChatPanel({ g, myUserId }: { g: GroupClassState; myUserId: string }) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [g.chat.length]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && g.sendChat(text.trim())) setText('');
  };
  return (
    <div className="gcl-chat">
      <div className="gcl-chat-list" ref={listRef} data-testid="group-chat-list">
        {g.chat.length === 0 && <p className="gc-muted">Messages here go to everyone in the class.</p>}
        {g.chat.map((m) => (
          <div key={m.id} className={`gcl-msg${m.user_id === myUserId ? ' is-mine' : ''}`}>
            <span className="gcl-msg-name">{m.name}</span>
            <span lang="zh">{m.text}</span>
          </div>
        ))}
      </div>
      <form className="gcl-chat-form" onSubmit={submit}>
        <input className="form-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Message everyone…" maxLength={1000} data-testid="group-chat-input" />
        <button type="submit" className="btn btn-primary" disabled={!text.trim()}>Send</button>
      </form>
    </div>
  );
}

function QuizPanel({ g }: { g: GroupClassState }) {
  const q = g.quiz;
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '', '']);
  const [correct, setCorrect] = useState<number | null>(0);
  if (!q) {
    if (!g.isTutor) return <p className="gc-muted gcl-pad">No question right now — your tutor can ask one.</p>;
    const filled = options.map((o) => o.trim()).filter(Boolean);
    return (
      <form
        className="gcl-quiz-form gcl-pad"
        onSubmit={(e) => {
          e.preventDefault();
          const opts = options.map((o) => o.trim());
          const kept = opts.filter(Boolean);
          const c = correct !== null && opts[correct] ? kept.indexOf(opts[correct]) : null;
          g.startQuiz({ question: question.trim(), options: kept, correct: c });
        }}
      >
        <label className="gc-label" htmlFor="gq-q">Ask everyone a question</label>
        <input id="gq-q" className="form-input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="“bank” in Chinese is…" data-testid="quiz-question" lang="zh" />
        {options.map((o, i) => (
          <div key={i} className="gcl-quiz-opt">
            <input type="radio" name="gq-correct" checked={correct === i} onChange={() => setCorrect(i)} aria-label={`Answer ${i + 1} is right`} />
            <input className="form-input" value={o} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Answer ${i + 1}`} data-testid={`quiz-option-${i}`} lang="zh" />
          </div>
        ))}
        <div className="gcl-quiz-row">
          {options.length < QUIZ_MAX_OPTIONS && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOptions([...options, ''])}>＋ Answer</button>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCorrect(null)} disabled={correct === null}>No right answer</button>
        </div>
        <button type="submit" className="btn btn-primary" disabled={!question.trim() || filled.length < 2} data-testid="quiz-ask">Ask</button>
      </form>
    );
  }
  return <QuizView q={q} g={g} />;
}

function QuizView({ q, g }: { q: GroupQuizView; g: GroupClassState }) {
  const total = Math.max(1, q.answered);
  return (
    <div className="gcl-quiz gcl-pad" data-testid="quiz-view">
      <div className="gcl-quiz-q" lang="zh">{q.question}</div>
      <div className="gc-muted gc-small">{q.answered} answered{q.revealed ? ' · answer shown' : ''}</div>
      <ul className="gcl-quiz-options">
        {q.options.map((o, i) => {
          const count = q.counts?.[i] ?? null;
          const right = q.correct === i;
          const names = q.answers?.filter((a) => a.choice === i).map((a) => a.name) ?? [];
          return (
            <li key={i}>
              <button
                type="button"
                className={`gcl-quiz-choice${q.mine === i ? ' is-mine' : ''}${right && (q.revealed || g.isTutor) ? ' is-right' : ''}`}
                disabled={g.isTutor || q.revealed}
                onClick={() => g.answerQuiz(q.id, i)}
                data-testid={`quiz-choice-${i}`}
              >
                <span lang="zh">{o}</span>
                {count !== null && (
                  <span className="gcl-quiz-bar" style={{ width: `${(count / total) * 100}%` }} aria-hidden="true" />
                )}
                {count !== null && <span className="gcl-quiz-count">{count}</span>}
              </button>
              {names.length > 0 && <div className="gcl-quiz-names" data-testid={`quiz-names-${i}`}>{names.join(', ')}</div>}
            </li>
          );
        })}
      </ul>
      {g.isTutor && (
        <div className="gcl-quiz-row">
          {!q.revealed && <button type="button" className="btn btn-primary btn-sm" onClick={() => g.revealQuiz(q.id)} data-testid="quiz-reveal">Show the answer</button>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => g.closeQuiz()}>{q.revealed ? 'Next question' : 'Cancel'}</button>
        </div>
      )}
      {!g.isTutor && !q.revealed && <p className="gc-muted gc-small">{q.mine === null ? 'Tap your answer.' : 'You can change your answer until your tutor shows it.'}</p>}
    </div>
  );
}

function LiveClass({ g, group, myUserId }: { g: GroupClassState; group: GroupSummary; myUserId: string }) {
  const [panel, setPanel] = useState<Panel | null>(() => (typeof window !== 'undefined' && window.innerWidth >= 1024 ? 'people' : null));
  const [now, setNow] = useState(Date.now());
  const [unread, setUnread] = useState(0);
  const lastChat = useRef(g.chat.length);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (g.chat.length > lastChat.current && panel !== 'chat') setUnread((u) => u + g.chat.length - lastChat.current);
    lastChat.current = g.chat.length;
  }, [g.chat.length, panel]);
  useEffect(() => {
    if (g.quiz && !g.isTutor) setPanel('quiz');
  }, [g.quiz?.id, g.isTutor]); // eslint-disable-line react-hooks/exhaustive-deps

  const people: Person[] = useMemo(() => {
    const list: Person[] = g.remotes.map((r) => ({ peer: r.peer, stream: r.stream, isMe: false, connection: r.connection }));
    if (g.self) list.push({ peer: { ...g.self, state: { mic: g.mic, cam: g.cam, screen: !!g.screenStream } }, stream: g.localStream, isMe: true });
    return list;
  }, [g.remotes, g.self, g.mic, g.cam, g.screenStream, g.localStream]);

  const stage = stageOf(people.map((p) => ({ user_id: p.peer.user_id, state: p.peer.state })), g.room);
  const stagePerson = stage ? people.find((p) => p.peer.user_id === stage.user_id) ?? null : null;
  const gallery = galleryOrder(people.map((p) => ({ ...p, user_id: p.peer.user_id, name: p.peer.name, role: p.peer.role })), stage?.kind === 'spotlight' ? g.room : { spotlight: null }, myUserId);
  const [box, boxRef] = useBoxSize<HTMLDivElement>();
  const grid = galleryGrid(gallery.length, box.width, box.height);
  const myHand = g.room.hands.some((h) => h.user_id === myUserId);
  const stageStream = stage?.kind === 'screen' ? (stagePerson?.isMe ? g.screenStream : g.remotes.find((r) => r.peer.user_id === stage.user_id)?.screen ?? null) : stagePerson?.stream ?? null;
  const openPanel = (p: Panel) => {
    setPanel((cur) => (cur === p ? null : p));
    if (p === 'chat') setUnread(0);
  };

  return (
    <div className={`gcl${panel ? ' has-panel' : ''}`} data-testid="group-live">
      <header className="gcl-top">
        <span className="gcl-title">🧪 {group.name}</span>
        <span className="gcl-meta">
          {people.length} in class · {g.startedAt ? clock(now - g.startedAt) : '0:00'}
          {g.status !== 'open' && <span className="gcl-chip gcl-chip-warn"> reconnecting…</span>}
        </span>
      </header>
      {g.notice && <div className="gcl-notice" role="status">{g.notice}</div>}
      <main className="gcl-main">
        {stage && (
          <div className="gcl-stage" data-testid="group-stage">
            <GroupVideo stream={stageStream} muted={stage.kind === 'screen' || !!stagePerson?.isMe || g.room.muted.includes(stage.user_id)} mirrored={stage.kind === 'spotlight' && stagePerson?.isMe} />
            <div className="gcl-tile-label">
              {stage.kind === 'screen' ? `🖥 ${stagePerson?.peer.name ?? ''}'s screen` : `⭐ ${stagePerson?.peer.name ?? ''}`}
            </div>
          </div>
        )}
        <div className="gcl-gallery" ref={boxRef} style={{ gridTemplateColumns: `repeat(${grid.cols}, ${grid.tileW}px)`, gridAutoRows: `${grid.tileH}px` }}>
          {gallery.map((p) => (
            <Tile key={p.peer.client_id} person={p} g={g} />
          ))}
        </div>
      </main>
      {panel && (
        <aside className="gcl-panel" data-testid={`group-panel-${panel}`}>
          <div className="gcl-panel-tabs" role="tablist">
            {(['people', 'board', 'chat', 'quiz'] as Panel[]).map((p) => (
              <button key={p} type="button" role="tab" aria-selected={panel === p} className={panel === p ? 'is-on' : ''} onClick={() => openPanel(p)}>
                {p === 'people' ? '👥 People' : p === 'board' ? '📝 Board' : p === 'chat' ? '💬 Chat' : '🎯 Quiz'}
              </button>
            ))}
            <button type="button" className="gcl-panel-close" onClick={() => setPanel(null)} aria-label="Close panel">✕</button>
          </div>
          <div className="gcl-panel-body">
            {panel === 'people' && <PeoplePanel g={g} people={people} />}
            {panel === 'board' && <TextBoard session={g.board} placeholder="Type here — everyone in the class sees it…" />}
            {panel === 'chat' && <ChatPanel g={g} myUserId={myUserId} />}
            {panel === 'quiz' && <QuizPanel g={g} />}
          </div>
        </aside>
      )}
      <footer className="gcl-controls">
        <button type="button" className={`gcl-btn${g.mic ? '' : ' is-off'}`} onClick={g.toggleMic} aria-label={g.mic ? 'Mute me' : 'Unmute me'} data-testid="group-mic">{g.mic ? '🎤' : '🔇'}</button>
        <button type="button" className={`gcl-btn${g.cam ? '' : ' is-off'}`} onClick={g.toggleCam} aria-label={g.cam ? 'Camera off' : 'Camera on'} data-testid="group-cam">{g.cam ? '📷' : '🚫'}</button>
        {!g.isTutor && (
          <button type="button" className={`gcl-btn${myHand ? ' is-on' : ''}`} onClick={() => g.control({ kind: 'hand', up: !myHand })} aria-label={myHand ? 'Lower hand' : 'Raise hand'} data-testid="group-hand">✋</button>
        )}
        {g.isTutor && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && (
          <button type="button" className={`gcl-btn${g.screenStream ? ' is-on' : ''}`} onClick={() => void g.shareScreen()} aria-label="Share screen" data-testid="group-share">🖥</button>
        )}
        <span className="gcl-sep" />
        <button type="button" className={`gcl-btn${panel === 'people' ? ' is-on' : ''}`} onClick={() => openPanel('people')} aria-label="People" data-testid="open-people">
          👥{g.room.hands.length > 0 && <span className="gcl-badge">{g.room.hands.length}</span>}
        </button>
        <button type="button" className={`gcl-btn${panel === 'board' ? ' is-on' : ''}`} onClick={() => openPanel('board')} aria-label="Board" data-testid="open-board">📝</button>
        <button type="button" className={`gcl-btn${panel === 'chat' ? ' is-on' : ''}`} onClick={() => openPanel('chat')} aria-label="Chat" data-testid="open-chat">
          💬{unread > 0 && <span className="gcl-badge">{unread}</span>}
        </button>
        <button type="button" className={`gcl-btn${panel === 'quiz' ? ' is-on' : ''}`} onClick={() => openPanel('quiz')} aria-label="Quiz" data-testid="open-quiz">
          🎯{g.quiz && !g.quiz.revealed && <span className="gcl-badge">!</span>}
        </button>
        <span className="gcl-sep" />
        <button type="button" className="gcl-btn gcl-leave" onClick={g.leave} aria-label="Leave" data-testid="group-leave">🚪</button>
        {g.isTutor && (
          <button
            type="button"
            className="gcl-btn gcl-end"
            onClick={() => window.confirm('End the class for everyone?') && void g.endForAll()}
            aria-label="End for everyone"
            data-testid="group-end"
          >
            End
          </button>
        )}
      </footer>
    </div>
  );
}

export function GroupClassPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const myUserId = user?.id ?? '';
  const [info, setInfo] = useState<{ session: GroupSession; group: GroupSummary; role: 'tutor' | 'student' } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const g = useGroupClass(id, myUserId);

  useEffect(() => {
    getGroupSession(id)
      .then(setInfo)
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not open the class'));
  }, [id, g.phase === 'ended']); // eslint-disable-line react-hooks/exhaustive-deps

  if (g.phase === 'live' && info) return <LiveClass g={g} group={info.group} myUserId={myUserId} />;

  const ended = info?.session.status === 'ended' || g.phase === 'ended';
  return (
    <div className="gcl-lobby" data-testid="group-lobby">
      <div className="gcl-lobby-card">
        <div className="gcl-lobby-emoji">{ended ? '👋' : '🧑‍🏫'}</div>
        <span className="gc-beta">🧪 Group class · prototype</span>
        <h1>{info?.group.name ?? 'Group class'}</h1>
        {loadError && <p className="gc-error">{loadError}</p>}
        {g.error && <p className="gc-error">{g.error}</p>}
        {info && !ended && (
          <>
            <p className="gc-muted">
              With {info.group.tutor_name} and {info.group.members.length} students: {info.group.members.map((m) => m.name).join(', ')}.
            </p>
            <p className="gc-muted gc-small">Your camera and microphone are used for the class. Nothing is recorded.</p>
          </>
        )}
        {ended && <p>{g.phase === 'ended' ? 'The class has ended.' : 'This class has ended.'}</p>}
        {g.phase === 'left' && !ended && <p>You left the class. It is still going.</p>}
        <div className="gcl-lobby-actions">
          {info && !ended && (
            <button type="button" className="btn btn-primary" disabled={g.phase === 'joining'} onClick={() => void g.join()} data-testid="group-join">
              {g.phase === 'joining' ? 'Joining…' : g.phase === 'left' ? 'Rejoin the class' : 'Join the class'}
            </button>
          )}
          <Link className="btn btn-secondary" to="/group-classes">Group classes</Link>
        </div>
      </div>
    </div>
  );
}
