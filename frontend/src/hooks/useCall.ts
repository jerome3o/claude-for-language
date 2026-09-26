/**
 * Everything the call page needs: camera / mic, the room socket, the WebRTC
 * link to the other participant, the whiteboard and chat state, and the
 * recorder + upload queue for the transcript. The page is only layout.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { applyBoardOp, type BoardItem, type BoardOp, type CallChatMessage, type CallPeer, type LiveStroke, type PeerMediaState, type ServerMessage } from '@shared/calls';
import { CallRoomSocket, type RoomStatus } from '../services/calls/room';
import { PeerLink, type SignalData } from '../services/calls/peer';
import { CallRecorder } from '../services/calls/recorder';
import { closeOrphanPieces, drainCallUploads, pendingCallUploads } from '../services/calls/uploads';
import { endCall as endCallApi } from '../api/calls';

export type CallPhase = 'prejoin' | 'joining' | 'live' | 'ended' | 'error';

export interface RemoteParticipant {
  peer: CallPeer;
  stream: MediaStream | null;
  connection: RTCPeerConnectionState | 'new';
}

const AUDIO_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

function videoConstraints(facing: 'user' | 'environment'): MediaTrackConstraints {
  return { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } };
}

export function canShareScreen(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function';
}

export function useCall(callId: string, myUserId: string) {
  const [phase, setPhase] = useState<CallPhase>('prejoin');
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<RemoteParticipant | null>(null);
  const [roomStatus, setRoomStatus] = useState<RoomStatus>('connecting');
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [liveStrokes, setLiveStrokes] = useState<Record<string, LiveStroke>>({});
  const [chat, setChat] = useState<CallChatMessage[]>([]);
  const [recording, setRecording] = useState(false);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [turn, setTurn] = useState(false);

  const roomRef = useRef<CallRoomSocket | null>(null);
  const linkRef = useRef<PeerLink | null>(null);
  const remoteIdRef = useRef<string | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const iceRef = useRef<RTCIceServer[]>([]);
  const recorderRef = useRef<CallRecorder | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const stateRef = useRef<PeerMediaState>({ mic: true, cam: true, screen: false, recording: false });
  const wantRecordRef = useRef(true);
  const finishedRef = useRef(false);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  // ---------------------------------------------------------------- media

  const startPreview = useCallback(async () => {
    if (localRef.current) return localRef.current;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: videoConstraints('user') });
    } catch (err) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
        setCamOn(false);
        setMediaError('No camera — joining with audio only.');
      } catch {
        setMediaError(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Camera and microphone are blocked. Allow them in the browser’s site settings, then reload.'
            : 'Could not open the microphone.',
        );
        return null;
      }
    }
    localRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  const audioTrack = () => localRef.current?.getAudioTracks()[0] ?? null;
  const cameraTrack = () => localRef.current?.getVideoTracks()[0] ?? null;

  const broadcastState = useCallback((patch: Partial<PeerMediaState>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    roomRef.current?.send({ type: 'state', state: stateRef.current });
  }, []);

  // ---------------------------------------------------------------- peer link

  const closeLink = useCallback(() => {
    linkRef.current?.close();
    linkRef.current = null;
    remoteIdRef.current = null;
  }, []);

  const openLink = useCallback((peer: CallPeer) => {
    closeLink();
    remoteIdRef.current = peer.client_id;
    setRemote({ peer, stream: null, connection: 'new' });
    const room = roomRef.current;
    linkRef.current = new PeerLink({
      iceServers: iceRef.current,
      polite: (selfIdRef.current ?? '') < peer.client_id,
      audioTrack: audioTrack(),
      videoTrack: screenRef.current?.getVideoTracks()[0] ?? cameraTrack(),
      sendSignal: (data: SignalData) => room?.send({ type: 'signal', to: peer.client_id, data }),
      onRemoteStream: (stream) => setRemote((r) => (r && r.peer.client_id === peer.client_id ? { ...r, stream } : r)),
      onConnectionState: (connection) => setRemote((r) => (r && r.peer.client_id === peer.client_id ? { ...r, connection } : r)),
    });
  }, [closeLink]);

  // ---------------------------------------------------------------- recording

  const startRecording = useCallback(async () => {
    const track = audioTrack();
    if (!track || !CallRecorder.supported() || recorderRef.current?.recording) return;
    const recorder = recorderRef.current ?? new CallRecorder(callId, () => roomRef.current?.clockOffset ?? 0, () => {
      void pendingCallUploads(callId).then(setPendingUploads);
    });
    recorderRef.current = recorder;
    await recorder.start(track);
    setRecording(true);
    broadcastState({ recording: true });
  }, [callId, broadcastState]);

  const stopRecording = useCallback(async () => {
    await recorderRef.current?.stop();
    setRecording(false);
    broadcastState({ recording: false });
    void drainCallUploads();
  }, [broadcastState]);

  // ---------------------------------------------------------------- teardown

  const releaseMedia = useCallback(() => {
    localRef.current?.getTracks().forEach((t) => t.stop());
    screenRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    screenRef.current = null;
    setLocalStream(null);
    setScreenStream(null);
    void wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const finish = useCallback(async (next: 'ended' | 'error', message?: string) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (message) setError(message);
    setPhase(next);
    await recorderRef.current?.stop().catch(() => {});
    setRecording(false);
    closeLink();
    roomRef.current?.close();
    roomRef.current = null;
    releaseMedia();
    setRemote(null);
    await drainCallUploads().catch(() => {});
    setPendingUploads(await pendingCallUploads(callId));
  }, [callId, closeLink, releaseMedia]);

  // ---------------------------------------------------------------- room messages

  const onMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'welcome':
        selfIdRef.current = msg.client_id;
        setStartedAt(msg.started_at);
        setBoard(msg.board);
        setChat(msg.chat);
        setLiveStrokes({});
        roomRef.current?.send({ type: 'state', state: stateRef.current });
        if (msg.peers.length > 0) openLink(msg.peers[0]);
        else {
          closeLink();
          setRemote(null);
        }
        if (wantRecordRef.current && !recorderRef.current?.recording) void startRecording();
        setPhase('live');
        return;
      case 'peer_joined':
        openLink(msg.peer);
        return;
      case 'peer_left':
        if (remoteIdRef.current === msg.client_id) {
          closeLink();
          setRemote(null);
        }
        return;
      case 'peer_state':
        setRemote((r) => (r && r.peer.client_id === msg.client_id ? { ...r, peer: { ...r.peer, state: msg.state } } : r));
        return;
      case 'signal':
        if (remoteIdRef.current === msg.from) void linkRef.current?.handleSignal(msg.data as SignalData);
        return;
      case 'board':
        setBoard((items) => applyBoardOp(items, msg.op));
        if (msg.op.type === 'stroke') setLiveStrokes(({ [msg.op.by]: _drop, ...rest }) => rest);
        return;
      case 'board_live':
        setLiveStrokes((cur) => {
          if (!msg.stroke) {
            const { [msg.from]: _gone, ...rest } = cur;
            return rest;
          }
          return { ...cur, [msg.from]: msg.stroke };
        });
        return;
      case 'chat':
        setChat((c) => (c.some((m) => m.id === msg.message.id) ? c : [...c, msg.message]));
        return;
      case 'ended':
        void finish('ended');
        return;
      case 'replaced':
        void finish('error', 'You joined this call from another tab or device.');
        return;
      default:
        return;
    }
  }, [openLink, closeLink, startRecording, finish]);

  // ---------------------------------------------------------------- join / leave

  const join = useCallback(async (opts: { record: boolean }) => {
    wantRecordRef.current = opts.record;
    finishedRef.current = false;
    setPhase('joining');
    const stream = localRef.current ?? (await startPreview());
    if (!stream) {
      setPhase('prejoin');
      return;
    }
    stateRef.current = { mic: micOn, cam: camOn && !!cameraTrack(), screen: false, recording: false };
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
      wakeLockRef.current = (await nav.wakeLock?.request('screen')) ?? null;
    } catch {
      /* no wake lock — the screen may dim */
    }
    const room = new CallRoomSocket(callId, {
      onMessage,
      onStatus: setRoomStatus,
      onJoinInfo: (info) => {
        iceRef.current = info.ice_servers;
        setTurn(info.turn);
      },
      onFatal: (message) => void finish('error', message),
    });
    roomRef.current = room;
    await room.connect();
  }, [callId, micOn, camOn, onMessage, startPreview, finish]);

  const endForEveryone = useCallback(async () => {
    const sent = roomRef.current?.send({ type: 'end' });
    if (!sent) await endCallApi(callId).catch(() => {});
    await finish('ended');
  }, [callId, finish]);

  // ---------------------------------------------------------------- controls

  const toggleMic = useCallback(() => {
    const track = audioTrack();
    const next = !micOn;
    if (track) track.enabled = next;
    setMicOn(next);
    broadcastState({ mic: next });
  }, [micOn, broadcastState]);

  const toggleCam = useCallback(() => {
    const track = cameraTrack();
    if (!track) return;
    const next = !camOn;
    track.enabled = next;
    setCamOn(next);
    broadcastState({ cam: next });
  }, [camOn, broadcastState]);

  const flipCamera = useCallback(async () => {
    const stream = localRef.current;
    const old = cameraTrack();
    if (!stream || !old) return;
    const nextFacing = facing === 'user' ? 'environment' : 'user';
    try {
      old.stop();
      const fresh = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(nextFacing) });
      const track = fresh.getVideoTracks()[0];
      track.enabled = camOn;
      stream.removeTrack(old);
      stream.addTrack(track);
      setLocalStream(new MediaStream(stream.getTracks()));
      if (!screenRef.current) await linkRef.current?.setVideoTrack(track);
      setFacing(nextFacing);
    } catch (err) {
      console.error('[calls] flip camera failed:', err);
    }
  }, [facing, camOn]);

  const stopScreenShare = useCallback(async () => {
    screenRef.current?.getTracks().forEach((t) => t.stop());
    screenRef.current = null;
    setScreenStream(null);
    await linkRef.current?.setVideoTrack(cameraTrack());
    broadcastState({ screen: false });
  }, [broadcastState]);

  const startScreenShare = useCallback(async () => {
    if (!canShareScreen() || screenRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
      const track = stream.getVideoTracks()[0];
      track.contentHint = 'detail';
      track.onended = () => void stopScreenShare();
      screenRef.current = stream;
      setScreenStream(stream);
      await linkRef.current?.setVideoTrack(track);
      broadcastState({ screen: true });
    } catch {
      /* the picker was cancelled */
    }
  }, [broadcastState, stopScreenShare]);

  const commitBoard = useCallback((op: BoardOp) => {
    setBoard((items) => applyBoardOp(items, op));
    roomRef.current?.send({ type: 'board', op });
  }, []);

  const sendLiveStroke = useCallback((stroke: LiveStroke | null) => {
    roomRef.current?.send({ type: 'board_live', stroke });
  }, []);

  const sendChat = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return false;
    return roomRef.current?.send({ type: 'chat', text: t }) ?? false;
  }, []);

  // ---------------------------------------------------------------- lifecycle

  // Keep the upload queue moving while the page is open.
  useEffect(() => {
    let alive = true;
    void closeOrphanPieces(callId).then(() => drainCallUploads());
    const timer = setInterval(async () => {
      await drainCallUploads().catch(() => {});
      const n = await pendingCallUploads(callId);
      if (alive) setPendingUploads(n);
    }, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [callId]);

  // Leaving the page: stop everything (the recording's last piece is closed
  // by the recorder, or by closeOrphanPieces on the next sync if the tab dies first).
  useEffect(() => () => {
    finishedRef.current = true;
    void recorderRef.current?.stop();
    linkRef.current?.close();
    roomRef.current?.close();
    localRef.current?.getTracks().forEach((t) => t.stop());
    screenRef.current?.getTracks().forEach((t) => t.stop());
    void wakeLockRef.current?.release().catch(() => {});
  }, []);

  return {
    phase, error, mediaError, localStream, screenStream, remote, roomStatus, turn,
    micOn, camOn, facing, recording, pendingUploads, startedAt,
    board, liveStrokes: Object.values(liveStrokes), chat,
    startPreview, join, endForEveryone, toggleMic, toggleCam, flipCamera,
    startScreenShare, stopScreenShare, startRecording, stopRecording,
    commitBoard, sendLiveStroke, sendChat,
    hasCamera: !!localStream?.getVideoTracks().length,
    myUserId,
  };
}
