/**
 * The live group class (EXPERIMENTAL prototype, docs/GROUP_CLASSES.md): media,
 * the room socket and the mesh of WebRTC links.
 *
 * Mesh: one `PeerLink` (the 1:1 call's link class, services/calls/peer.ts) per
 * other person; `isPolite` picks the offerer of each pair. My camera is asked
 * for small (`groupCameraConstraints`) because it goes out N−1 times. A peer
 * that leaves loses its link at once (no 30 s grace like the 1:1 call); one
 * that comes back gets a new link.
 *
 * Tutor controls arrive as `room` messages: when I am muted my mic goes off
 * and stays off until the tutor lifts it; everyone else also silences a muted
 * person's audio (the page renders their video muted).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { linkSignalAction, newInstanceId, type CallChatMessage } from '@shared/calls';
import {
  EMPTY_ROOM_STATE,
  groupCameraConstraints,
  isAudible,
  isPolite,
  nextSpeaker,
  type GroupControl,
  type GroupPeer,
  type GroupQuizView,
  type GroupRoomState,
  type GroupServerMessage,
  type QuizSpec,
  type SpeakerState,
} from '@shared/group';
import { PeerLink, type SignalData } from '../../services/calls/peer';
import { TextBoardSession } from '../../services/calls/textBoard';
import { GroupRoomSocket, type GroupRoomStatus } from '../../services/group/groupRoomSocket';
import { endGroupSession } from '../../api/groupClasses';
import { track } from '../../services/analytics';

export type GroupPhase = 'lobby' | 'joining' | 'live' | 'ended' | 'left' | 'error';

export interface RemotePerson {
  peer: GroupPeer;
  stream: MediaStream | null;
  screen: MediaStream | null;
  connection: RTCPeerConnectionState;
}

interface LinkEntry {
  link: PeerLink;
  retired: string[];
}

export function useGroupClass(sessionId: string, myUserId: string) {
  const [phase, setPhase] = useState<GroupPhase>('lobby');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<GroupRoomStatus>('connecting');
  const [self, setSelf] = useState<GroupPeer | null>(null);
  const [tutorId, setTutorId] = useState('');
  const [remotes, setRemotes] = useState<Record<string, RemotePerson>>({});
  const [room, setRoom] = useState<GroupRoomState>(EMPTY_ROOM_STATE);
  const [chat, setChat] = useState<CallChatMessage[]>([]);
  const [quiz, setQuiz] = useState<GroupQuizView | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const socketRef = useRef<GroupRoomSocket | null>(null);
  const linksRef = useRef(new Map<string, LinkEntry>());
  const peersRef = useRef(new Map<string, GroupPeer>());
  const localRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const iceRef = useRef<RTCIceServer[]>([]);
  const selfIdRef = useRef('');
  const roomRef = useRef<GroupRoomState>(EMPTY_ROOM_STATE);
  const micRef = useRef(true);
  const camRef = useRef(true);
  const joinedAtRef = useRef(0);
  const instance = useRef(newInstanceId()).current;
  const remotesRef = useRef(remotes);
  remotesRef.current = remotes;
  const boardRef = useRef<TextBoardSession | null>(null);
  // The board session also knows page messages (the 1:1 board's pages); a group room has one page, so only text / carets go out.
  if (!boardRef.current) boardRef.current = new TextBoardSession(myUserId, (m) => (m.type === 'text' || m.type === 'text_cursor' ? socketRef.current?.send(m) ?? false : false));

  const say = useCallback((text: string) => {
    setNotice(text);
    setTimeout(() => setNotice((n) => (n === text ? null : n)), 4000);
  }, []);

  const sendState = useCallback(() => {
    socketRef.current?.send({ type: 'state', state: { mic: micRef.current, cam: camRef.current, screen: !!screenRef.current } });
  }, []);

  const updateRemote = useCallback((clientId: string, patch: Partial<RemotePerson>) => {
    setRemotes((cur) => (cur[clientId] ? { ...cur, [clientId]: { ...cur[clientId], ...patch } } : cur));
  }, []);

  // ---------------------------------------------------------------- links

  const closeLink = useCallback((clientId: string) => {
    linksRef.current.get(clientId)?.link.close();
    linksRef.current.delete(clientId);
  }, []);

  const openLink = useCallback((peer: GroupPeer, fresh?: string) => {
    const old = linksRef.current.get(peer.client_id);
    const retired = old ? [...old.retired, ...(old.link.remoteLink ? [old.link.remoteLink] : [])].slice(-20) : [];
    old?.link.close();
    const stream = localRef.current;
    let link: PeerLink | null = null;
    const mine = () => !!link && linksRef.current.get(peer.client_id)?.link === link;
    link = new PeerLink({
      iceServers: iceRef.current,
      polite: isPolite(selfIdRef.current, peer.client_id),
      audioTrack: stream?.getAudioTracks()[0] ?? null,
      videoTrack: stream?.getVideoTracks()[0] ?? null,
      screenTrack: screenRef.current?.getVideoTracks()[0] ?? null,
      sendSignal: (data: SignalData) => socketRef.current?.send({ type: 'signal', to: peer.client_id, data }) ?? false,
      signallingOpen: () => !!socketRef.current?.isOpen,
      onRemoteStream: (s) => mine() && updateRemote(peer.client_id, { stream: s }),
      onRemoteScreen: (s) => mine() && updateRemote(peer.client_id, { screen: s }),
      onConnectionState: (connection) => mine() && updateRemote(peer.client_id, { connection }),
    });
    if (fresh) link.remoteLink = fresh;
    linksRef.current.set(peer.client_id, { link, retired });
  }, [updateRemote]);

  const addPeer = useCallback((peer: GroupPeer) => {
    peersRef.current.set(peer.client_id, peer);
    setRemotes((cur) => ({ ...cur, [peer.client_id]: { peer, stream: null, screen: null, connection: 'new' } }));
    boardRef.current?.setPeer(peer.client_id, peer.name, peer.user_id);
    openLink(peer);
  }, [openLink]);

  const dropPeer = useCallback((clientId: string) => {
    closeLink(clientId);
    peersRef.current.delete(clientId);
    boardRef.current?.dropPeer(clientId);
    boardRef.current?.dropCursor(clientId);
    setRemotes(({ [clientId]: _gone, ...rest }) => rest);
  }, [closeLink]);

  // ---------------------------------------------------------------- media

  const releaseMedia = useCallback(() => {
    localRef.current?.getTracks().forEach((t) => t.stop());
    screenRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    screenRef.current = null;
    setLocalStream(null);
    setScreenStream(null);
  }, []);

  const teardown = useCallback(() => {
    for (const id of [...linksRef.current.keys()]) closeLink(id);
    peersRef.current.clear();
    setRemotes({});
    releaseMedia();
  }, [closeLink, releaseMedia]);

  const applyMuted = useCallback((next: GroupRoomState, prev: GroupRoomState) => {
    const nowMuted = next.muted.includes(myUserId);
    const wasMuted = prev.muted.includes(myUserId);
    if (nowMuted && !wasMuted) {
      const track = localRef.current?.getAudioTracks()[0];
      if (track) track.enabled = false;
      micRef.current = false;
      setMic(false);
      sendState();
      say('Your tutor muted you. Raise your hand ✋ to ask to speak.');
    } else if (!nowMuted && wasMuted) {
      say('Your tutor lets you speak — turn your mic on when you are ready.');
    }
  }, [myUserId, say, sendState]);

  // ---------------------------------------------------------------- room messages

  const onMessage = useCallback((msg: GroupServerMessage) => {
    const board = boardRef.current!;
    switch (msg.type) {
      case 'welcome': {
        // A (re)join: every link starts over with the people here now.
        for (const id of [...linksRef.current.keys()]) closeLink(id);
        peersRef.current.clear();
        setRemotes({});
        selfIdRef.current = msg.client_id;
        setSelf(msg.me);
        setTutorId(msg.tutor_id);
        setStartedAt(msg.started_at);
        const prev = roomRef.current;
        roomRef.current = msg.room;
        setRoom(msg.room);
        setChat(msg.chat);
        setQuiz(msg.quiz);
        board.resetPeers(msg.peers.map((p) => ({ client_id: p.client_id, name: p.name, user_id: p.user_id })));
        board.welcome({ text: msg.text, text_cursors: msg.text_cursors });
        for (const p of msg.peers) addPeer(p);
        applyMuted(msg.room, prev);
        if (msg.room.muted.includes(myUserId)) {
          const track = localRef.current?.getAudioTracks()[0];
          if (track) track.enabled = false;
          micRef.current = false;
          setMic(false);
        }
        sendState();
        setPhase('live');
        if (!joinedAtRef.current) {
          joinedAtRef.current = Date.now();
          track('group.join', { role: msg.me.role, people: msg.peers.length + 1 });
        }
        return;
      }
      case 'peer_joined':
        addPeer(msg.peer);
        return;
      case 'peer_left':
        dropPeer(msg.client_id);
        return;
      case 'peer_state': {
        if (msg.client_id === selfIdRef.current) {
          setSelf((s) => (s ? { ...s, state: msg.state } : s));
          return;
        }
        const p = peersRef.current.get(msg.client_id);
        if (p) peersRef.current.set(msg.client_id, { ...p, state: msg.state });
        setRemotes((cur) => (cur[msg.client_id] ? { ...cur, [msg.client_id]: { ...cur[msg.client_id], peer: { ...cur[msg.client_id].peer, state: msg.state } } } : cur));
        return;
      }
      case 'signal': {
        const peer = peersRef.current.get(msg.from);
        if (!peer) return;
        const data = msg.data as SignalData;
        let entry = linksRef.current.get(msg.from);
        if (!entry) {
          openLink(peer, data.link);
          entry = linksRef.current.get(msg.from)!;
        }
        const action = linkSignalAction(entry.link.remoteLink, entry.retired, data.link);
        if (action === 'ignore') return;
        if (action === 'replace' && data.link) openLink(peer, data.link);
        void linksRef.current.get(msg.from)?.link.handleSignal(data);
        return;
      }
      case 'room': {
        const prev = roomRef.current;
        roomRef.current = msg.room;
        setRoom(msg.room);
        applyMuted(msg.room, prev);
        return;
      }
      case 'text':
        board.applyRemote(msg.ops);
        return;
      case 'text_cursor':
        board.setCursor({ client_id: msg.client_id, user_id: msg.user_id, name: msg.name, sel: msg.sel, compose: msg.compose ?? null });
        return;
      case 'chat':
        setChat((c) => [...c, msg.message].slice(-500));
        return;
      case 'quiz':
        setQuiz(msg.quiz);
        return;
      case 'ended':
        teardown();
        setPhase('ended');
        if (msg.by) say(`${msg.by} ended the class`);
        return;
      case 'replaced':
        teardown();
        setError('You joined this class from another tab or device.');
        setPhase('error');
        return;
      case 'error':
        say(msg.message);
        return;
      case 'pong':
        return;
    }
  }, [addPeer, applyMuted, closeLink, dropPeer, myUserId, openLink, say, sendState, teardown]);

  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // ---------------------------------------------------------------- join / leave

  const join = useCallback(async () => {
    if (phase === 'joining' || phase === 'live') return;
    setPhase('joining');
    setError(null);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: groupCameraConstraints(3),
      });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        camRef.current = false;
        setCam(false);
        say('No camera — you joined with sound only.');
      } catch {
        say('No microphone or camera — you can still watch, type on the board and chat.');
      }
    }
    localRef.current = stream;
    setLocalStream(stream);
    if (!stream?.getAudioTracks().length) {
      micRef.current = false;
      setMic(false);
    }
    const socket = new GroupRoomSocket(sessionId, {
      onMessage: (m) => onMessageRef.current(m),
      onStatus: setStatus,
      onJoinInfo: (info) => {
        iceRef.current = info.ice_servers;
      },
      onFatal: (message) => {
        teardown();
        setError(message);
        setPhase('error');
      },
    }, instance);
    socketRef.current = socket;
    await socket.connect();
  }, [instance, phase, say, sessionId, teardown]);

  const leave = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    teardown();
    setPhase('left');
    if (joinedAtRef.current) track('group.leave', { duration_ms: Date.now() - joinedAtRef.current });
  }, [teardown]);

  const endForAll = useCallback(async () => {
    socketRef.current?.send({ type: 'end' });
    track('group.end', { duration_ms: joinedAtRef.current ? Date.now() - joinedAtRef.current : 0, people: Object.keys(remotes).length + 1 });
    try {
      await endGroupSession(sessionId);
    } catch {
      /* the room's own end went out */
    }
    socketRef.current?.close();
    socketRef.current = null;
    teardown();
    setPhase('ended');
  }, [remotes, sessionId, teardown]);

  useEffect(() => {
    const onHide = () => socketRef.current?.close({ beacon: true });
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      socketRef.current?.close();
      socketRef.current = null;
      for (const entry of linksRef.current.values()) entry.link.close();
      linksRef.current.clear();
      localRef.current?.getTracks().forEach((t) => t.stop());
      screenRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ---------------------------------------------------------------- my devices

  const toggleMic = useCallback(() => {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track) return;
    if (!micRef.current && roomRef.current.muted.includes(myUserId)) {
      say('Your tutor muted you. Raise your hand ✋ to ask to speak.');
      return;
    }
    micRef.current = !micRef.current;
    track.enabled = micRef.current;
    setMic(micRef.current);
    sendState();
  }, [myUserId, say, sendState]);

  const toggleCam = useCallback(() => {
    const track = localRef.current?.getVideoTracks()[0];
    if (!track) return;
    camRef.current = !camRef.current;
    track.enabled = camRef.current;
    setCam(camRef.current);
    sendState();
  }, [sendState]);

  const stopShare = useCallback(() => {
    if (!screenRef.current) return;
    screenRef.current.getTracks().forEach((t) => t.stop());
    screenRef.current = null;
    setScreenStream(null);
    for (const { link } of linksRef.current.values()) void link.setScreenTrack(null);
    sendState();
    track('group.screen_share', { on: false });
  }, [sendState]);

  const shareScreen = useCallback(async () => {
    if (screenRef.current) return stopShare();
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 10, max: 15 } }, audio: false });
      const t = s.getVideoTracks()[0];
      if (!t) return;
      t.onended = () => stopShare();
      screenRef.current = s;
      setScreenStream(s);
      for (const { link } of linksRef.current.values()) void link.setScreenTrack(t);
      sendState();
      track('group.screen_share', { on: true });
    } catch {
      /* cancelled */
    }
  }, [sendState, stopShare]);

  // ---------------------------------------------------------------- room actions

  const control = useCallback((c: GroupControl) => {
    socketRef.current?.send({ type: 'control', control: c });
    if (c.kind !== 'hand') track('group.control', { kind: c.kind });
  }, []);
  const sendChat = useCallback((text: string) => socketRef.current?.send({ type: 'chat', text }) ?? false, []);
  const startQuiz = useCallback((spec: QuizSpec) => {
    socketRef.current?.send({ type: 'quiz_start', quiz: spec });
    track('group.quiz', { action: 'start', options: spec.options.length });
  }, []);
  const answerQuiz = useCallback((quizId: string, choice: number) => socketRef.current?.send({ type: 'quiz_answer', quiz_id: quizId, choice }), []);
  const revealQuiz = useCallback((quizId: string) => {
    socketRef.current?.send({ type: 'quiz_reveal', quiz_id: quizId });
    track('group.quiz', { action: 'reveal' });
  }, []);
  const closeQuiz = useCallback(() => socketRef.current?.send({ type: 'quiz_close' }), []);

  // ---------------------------------------------------------------- active speaker

  useEffect(() => {
    if (phase !== 'live') return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const meters = new Map<string, { stream: MediaStream; analyser: AnalyserNode; source: MediaStreamAudioSourceNode }>();
    const buf = new Float32Array(512);
    let state: SpeakerState = { id: null, since: 0 };
    const meter = (key: string, stream: MediaStream | null) => {
      const have = meters.get(key);
      if (have && have.stream === stream) return have.analyser;
      if (have) have.source.disconnect();
      meters.delete(key);
      if (!stream || stream.getAudioTracks().length === 0) return null;
      try {
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        meters.set(key, { stream, analyser, source });
        return analyser;
      } catch {
        return null;
      }
    };
    const level = (a: AnalyserNode | null) => {
      if (!a) return 0;
      a.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      return Math.sqrt(sum / buf.length);
    };
    const timer = setInterval(() => {
      const levels: Record<string, number> = {};
      if (micRef.current) levels[myUserId] = level(meter('me', localRef.current));
      for (const r of Object.values(remotesRef.current)) {
        levels[r.peer.user_id] = isAudible(r.peer, roomRef.current) ? level(meter(r.peer.client_id, r.stream)) : 0;
      }
      const next = nextSpeaker(levels, state, Date.now());
      if (next.id !== state.id) setSpeaker(next.id);
      state = next;
    }, 250);
    return () => {
      clearInterval(timer);
      for (const m of meters.values()) m.source.disconnect();
      void ctx.close().catch(() => {});
    };
  }, [phase, myUserId]);

  return {
    phase,
    error,
    status,
    self,
    tutorId,
    isTutor: tutorId === myUserId,
    remotes: Object.values(remotes),
    room,
    chat,
    quiz,
    localStream,
    screenStream,
    mic,
    cam,
    speaker,
    startedAt,
    notice,
    board: boardRef.current,
    join,
    leave,
    endForAll,
    toggleMic,
    toggleCam,
    shareScreen,
    control,
    sendChat,
    startQuiz,
    answerQuiz,
    revealQuiz,
    closeQuiz,
  };
}

export type GroupClassState = ReturnType<typeof useGroupClass>;
