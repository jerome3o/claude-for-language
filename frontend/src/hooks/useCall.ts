/**
 * Everything the call page needs: camera / mic, the room socket, the WebRTC
 * link to the other participant, the whiteboard and chat state, and the
 * recorder + upload queue for the transcript. The page is only layout.
 *
 * Joining never depends on the devices: without a camera you join with audio,
 * without a microphone you join to listen and watch, and either can be turned
 * on later (services/calls/mediaAccess.ts says what blocked them).
 *
 * Staying connected (shared/calls/connection.ts): the room socket and the media
 * link are independent. A socket that drops and returns from the same page load
 * keeps the RTCPeerConnection (`instance` + `shouldAdoptPeer`); the other
 * person's socket going away keeps their picture frozen for PEER_AWAY_GRACE_MS;
 * the link restarts ICE by itself (peer.ts). Every transition goes to the call's
 * connection log (`diag` messages → calls.diagnostics_json → the review page).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyBoardOp,
  newInstanceId,
  PEER_AWAY_GRACE_MS,
  shouldAdoptPeer,
  linkSignalAction,
  type BoardItem,
  type BoardOp,
  type CallChatMessage,
  type CallDiagEvent,
  type CallDiagKind,
  type CallPeer,
  type LinkHealth,
  type LiveStroke,
  type PcState,
  type PeerMediaState,
  type ServerMessage,
} from '@shared/calls';
import { CallRoomSocket, type RoomStatus } from '../services/calls/room';
import { PeerLink, type SignalData } from '../services/calls/peer';
import { CallRecorder } from '../services/calls/recorder';
import { closeOrphanPieces, drainCallUploads, pendingCallUploads } from '../services/calls/uploads';
import { endCall as endCallApi } from '../api/calls';
import { TextBoardSession } from '../services/calls/textBoard';
import { refreshBoardPages } from '../services/boardPages';
import { AnnotationStore } from '../services/calls/annotations';
import { DEFAULT_ANNOT_PERSIST, type AnnotStroke, type AnnotText } from '@shared/calls';
import { materialTarget, type PresentedMaterial } from '@shared/materials';
import {
  acquireMedia,
  loadDevicePrefs,
  saveDevicePrefs,
  type DevicePrefs,
  audioConstraints,
  videoConstraints,
  type MediaProblem,
} from '../services/calls/mediaAccess';

/** 'left' = I left; the call goes on for the other person (Rejoin brings me back). */
export type CallPhase = 'prejoin' | 'joining' | 'live' | 'left' | 'ended' | 'error';

export interface RemoteParticipant {
  peer: CallPeer;
  stream: MediaStream | null;
  connection: RTCPeerConnectionState | 'new';
  /** Their socket left the room; the link (and the frozen picture) is kept for a while. */
  away: boolean;
  health: LinkHealth | null;
  /** Their shared screen (its own stream; frames only while they share). */
  screenStream: MediaStream | null;
  /** False with an older app: their screen arrives on the camera stream instead. */
  screenChannel: boolean;
}

/** What stopped the microphone / camera (null = fine or not asked yet). */
export interface MediaProblems {
  audio: MediaProblem | null;
  video: MediaProblem | null;
}

/** After this long with no answer to the permission request, explain where the prompt is. */
const PROMPT_WAIT_MS = 6000;
/** Join waits this long at most for a camera / mic request still in flight. */
const JOIN_MEDIA_WAIT_MS = 4000;

export function canShareScreen(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function';
}

export function useCall(callId: string, myUserId: string) {
  const [phase, setPhase] = useState<CallPhase>('prejoin');
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaProblems, setMediaProblems] = useState<MediaProblems>({ audio: null, video: null });
  const [mediaAsked, setMediaAsked] = useState(false);
  const [mediaPending, setMediaPending] = useState(false);
  const [devicePrefs, setDevicePrefs] = useState<DevicePrefs>(() => loadDevicePrefs());
  // On / off as I last left them (a muted mic stays muted; a camera that was on comes back on).
  const [micOn, setMicOn] = useState(() => !devicePrefs.micOff);
  const [camOn, setCamOn] = useState(() => !devicePrefs.camOff);
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
  /** Drawings on a shared screen stay (true) or fade (false) — one setting for both people. */
  const [annotPersist, setAnnotPersist] = useState(DEFAULT_ANNOT_PERSIST);

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
  // This page load (the room keeps our link through a socket reconnect when it matches).
  const instanceRef = useRef<string>(newInstanceId());
  const remotePeerRef = useRef<CallPeer | null>(null);
  const awayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diagQueueRef = useRef<CallDiagEvent[]>([]);
  /** Their link ids already replaced (late signals from them are ignored). */
  const retiredLinksRef = useRef<string[]>([]);
  const prefsRef = useRef<DevicePrefs>(devicePrefs);
  prefsRef.current = devicePrefs;
  /** Remember a mic / camera switched on or off (restored on the next join). */
  const rememberOnOff = useCallback((kind: 'mic' | 'cam', on: boolean) => {
    const next = { ...prefsRef.current, [kind === 'mic' ? 'micOff' : 'camOff']: !on };
    prefsRef.current = next;
    setDevicePrefs(next);
    saveDevicePrefs(next);
  }, []);
  const facingRef = useRef<'user' | 'environment'>('user');
  const phaseRef = useRef<CallPhase>('prejoin');
  phaseRef.current = phase;
  const mediaPendingRef = useRef(false);
  /** The preview's camera / mic request in flight (join waits for it). */
  const previewRef = useRef<Promise<MediaStream | null> | null>(null);
  const turnRef = useRef<boolean | null>(null);
  // The shared text board: this page's replica, alive for the whole page (reconnects replay into it).
  const textRef = useRef<TextBoardSession | null>(null);
  if (!textRef.current) textRef.current = new TextBoardSession(myUserId, (m) => roomRef.current?.send(m) ?? false);
  // Drawings on a shared screen (mine and theirs), outside React so the mini window can redraw from it.
  const annotRef = useRef<AnnotationStore | null>(null);
  if (!annotRef.current) annotRef.current = new AnnotationStore();
  // A presented lesson material (round 4): what is shown, and the drawings / text on its current page.
  const [presenting, setPresenting] = useState<PresentedMaterial | null>(null);
  const presentingRef = useRef<PresentedMaterial | null>(null);
  const materialAnnotRef = useRef<AnnotationStore | null>(null);
  if (!materialAnnotRef.current) materialAnnotRef.current = new AnnotationStore();
  const materialTargetNow = () => (presentingRef.current ? materialTarget(presentingRef.current.material_id, presentingRef.current.page) : null);
  /** The store an incoming annotation message goes to: the screen's (no target), the current material page's, or none. */
  const annotStoreFor = (target?: string): AnnotationStore | null => (!target ? annotRef.current : target === materialTargetNow() ? materialAnnotRef.current : null);

  // ---------------------------------------------------------------- media

  // ---------------------------------------------------------------- diagnostics

  const flushDiag = useCallback(() => {
    const room = roomRef.current;
    while (diagQueueRef.current.length && room?.isOpen) {
      const batch = diagQueueRef.current.slice(0, 50);
      if (!room.send({ type: 'diag', events: batch })) break;
      diagQueueRef.current = diagQueueRef.current.slice(batch.length);
    }
  }, []);

  const diag = useCallback((kind: CallDiagKind, detail: string) => {
    diagQueueRef.current.push({ t: Date.now(), kind, detail });
    if (diagQueueRef.current.length > 300) diagQueueRef.current = diagQueueRef.current.slice(-300);
    if (import.meta.env.DEV) console.debug(`[calls] ${kind}: ${detail}`);
    flushDiag();
  }, [flushDiag]);

  // ---------------------------------------------------------------- media

  /** Put a track into the local stream (replacing one of its kind) and onto the link. */
  const installTrack = useCallback(async (track: MediaStreamTrack) => {
    const current = localRef.current;
    const old = track.kind === 'audio' ? current?.getAudioTracks()[0] : current?.getVideoTracks()[0];
    if (old && old !== track) old.stop();
    const tracks = [...(current?.getTracks() ?? []).filter((t) => t.kind !== track.kind), track];
    const next = new MediaStream(tracks);
    localRef.current = next;
    setLocalStream(next);
    if (track.kind === 'audio') await linkRef.current?.setAudioTrack(track);
    else await linkRef.current?.setVideoTrack(track, 'camera');
  }, []);

  /**
   * Ask for the camera and / or microphone. Called on page load for the preview
   * and again from a tap (Try again / turning a device on), which is also what
   * brings back a prompt the browser suppressed.
   */
  const requestMedia = useCallback(async (want: { audio: boolean; video: boolean } = { audio: true, video: true }, opts: { restore?: boolean } = {}) => {
    setMediaAsked(true);
    setMediaPending(true);
    const waiting = setTimeout(() => {
      setMediaProblems((p) => ({ audio: want.audio && !p.audio ? 'waiting' : p.audio, video: want.video && !p.video ? 'waiting' : p.video }));
    }, PROMPT_WAIT_MS);
    const prefs = prefsRef.current;
    const result = await acquireMedia(want, { audioId: prefs.audioId, videoId: prefs.videoId, facing: facingRef.current });
    clearTimeout(waiting);
    setMediaPending(false);
    if (finishedRef.current && phaseRef.current !== 'prejoin') {
      result.stream?.getTracks().forEach((t) => t.stop());
      return localRef.current;
    }
    for (const track of result.stream?.getTracks() ?? []) {
      await installTrack(track);
      // The preview / a rejoin restores what I had (a tap to turn a device on always turns it on).
      const on = opts.restore ? !(track.kind === 'audio' ? prefsRef.current.micOff : prefsRef.current.camOff) : true;
      if (!opts.restore) rememberOnOff(track.kind === 'audio' ? 'mic' : 'cam', true);
      if (track.kind === 'audio') {
        track.enabled = on;
        setMicOn(on);
        if (phaseRef.current === 'live') {
          broadcastStateRef.current({ mic: on });
          if (wantRecordRef.current && !recorderRef.current?.recording) void startRecordingRef.current();
        }
      } else {
        track.enabled = on;
        setCamOn(on);
        if (phaseRef.current === 'live') broadcastStateRef.current({ cam: on });
      }
    }
    setMediaProblems((p) => ({
      audio: want.audio ? result.audioProblem : p.audio,
      video: want.video ? result.videoProblem : p.video,
    }));
    if (result.audioProblem) diag('media', `microphone: ${result.audioProblem}`);
    if (result.videoProblem) diag('media', `camera: ${result.videoProblem}`);
    return localRef.current;
  }, [installTrack, diag]);

  const startPreview = useCallback(async () => {
    if (localRef.current) return localRef.current;
    if (previewRef.current) return previewRef.current;
    mediaPendingRef.current = true;
    previewRef.current = requestMedia({ audio: true, video: true }, { restore: true }).finally(() => {
      mediaPendingRef.current = false;
      previewRef.current = null;
    });
    return previewRef.current;
  }, [requestMedia]);

  const audioTrack = () => localRef.current?.getAudioTracks()[0] ?? null;
  const cameraTrack = () => localRef.current?.getVideoTracks()[0] ?? null;

  const broadcastState = useCallback((patch: Partial<PeerMediaState>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    roomRef.current?.send({ type: 'state', state: stateRef.current });
  }, []);
  const broadcastStateRef = useRef(broadcastState);
  broadcastStateRef.current = broadcastState;

  // ---------------------------------------------------------------- peer link

  const clearAwayTimer = () => {
    if (awayTimerRef.current) clearTimeout(awayTimerRef.current);
    awayTimerRef.current = null;
  };

  const closeLink = useCallback(() => {
    clearAwayTimer();
    linkRef.current?.close();
    linkRef.current = null;
    remoteIdRef.current = null;
    remotePeerRef.current = null;
  }, []);

  const openLink = useCallback((peer: CallPeer, opts: { fresh?: string } = {}) => {
    // The same page load coming back (their socket or mine reconnected): keep the link and the picture —
    // unless the link failed / never got going: then a brand-new one (both sides start over).
    const pcState = linkRef.current?.pc.connectionState as PcState | undefined;
    if (!opts.fresh && linkRef.current && shouldAdoptPeer(remotePeerRef.current, peer, pcState)) {
      clearAwayTimer();
      const wasAway = remoteIdRef.current !== peer.client_id;
      remoteIdRef.current = peer.client_id;
      remotePeerRef.current = peer;
      setRemote((r) => (r ? { ...r, peer, away: false } : r));
      if (wasAway) diag('peer', `${peer.name} back (same session, link kept, ${linkRef.current.pc.connectionState})`);
      linkRef.current.signallingChanged();
      linkRef.current.resume();
      return;
    }
    const old = linkRef.current;
    const prevPeer = remotePeerRef.current;
    if (old?.remoteLink) retiredLinksRef.current = [...retiredLinksRef.current.slice(-20), old.remoteLink];
    closeLink();
    remoteIdRef.current = peer.client_id;
    remotePeerRef.current = peer;
    if (opts.fresh) diag('peer', `${peer.name} started a new link — renegotiating`);
    else if (old && prevPeer?.instance && prevPeer.instance === peer.instance) diag('peer', `${peer.name} back — link was ${pcState}, renegotiating`);
    else diag('peer', `${peer.name} joined — new link`);
    setRemote({ peer, stream: null, connection: 'new', away: false, health: null, screenStream: null, screenChannel: true });
    // Updates from this link only (a newer link may have replaced it).
    let link: PeerLink | null = null;
    const mine = (r: RemoteParticipant | null): r is RemoteParticipant => !!r && !!link && linkRef.current === link;
    link = new PeerLink({
      iceServers: iceRef.current,
      polite: (selfIdRef.current ?? '') < peer.client_id,
      audioTrack: audioTrack(),
      videoTrack: cameraTrack(),
      screenTrack: screenRef.current?.getVideoTracks()[0] ?? null,
      // Signals go to wherever the other person's socket is now (it may have reconnected).
      sendSignal: (data: SignalData) => (remoteIdRef.current ? roomRef.current?.send({ type: 'signal', to: remoteIdRef.current, data }) ?? false : false),
      signallingOpen: () => !!roomRef.current?.isOpen && !!remoteIdRef.current,
      onRemoteStream: (stream) => setRemote((r) => (mine(r) ? { ...r, stream, screenChannel: link!.screenChannel } : r)),
      onRemoteScreen: (screenStream) => setRemote((r) => (mine(r) ? { ...r, screenStream, screenChannel: true } : r)),
      onConnectionState: (connection) => setRemote((r) => (mine(r) ? { ...r, connection } : r)),
      onHealth: (health) => setRemote((r) => (mine(r) ? { ...r, health } : r)),
      onDiag: diag,
    });
    if (opts.fresh) link.remoteLink = opts.fresh;
    linkRef.current = link;
  }, [closeLink, diag]);

  /** Their socket left: keep the link and the frozen picture for a while — they are probably reconnecting. */
  const markAway = useCallback(() => {
    if (!linkRef.current) return;
    remoteIdRef.current = null;
    setRemote((r) => (r ? { ...r, away: true } : r));
    diag('peer', `${remotePeerRef.current?.name ?? 'They'} left the room — keeping the link ${PEER_AWAY_GRACE_MS / 1000}s`);
    clearAwayTimer();
    awayTimerRef.current = setTimeout(() => {
      awayTimerRef.current = null;
      diag('peer', 'gave up waiting — link closed');
      closeLink();
      setRemote(null);
    }, PEER_AWAY_GRACE_MS);
  }, [closeLink, diag]);

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

  const startRecordingRef = useRef(startRecording);
  startRecordingRef.current = startRecording;

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

  const finish = useCallback(async (next: 'ended' | 'error' | 'left', message?: string) => {
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
    // The board's pages changed in this call: the device's copy (Lesson board, offline) catches up.
    void refreshBoardPages().catch(() => {});
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
        textRef.current?.resetPeers(msg.peers);
        textRef.current?.welcome(msg);
        // Keep is the default (round 4); an older room that never says counts as kept too.
        annotRef.current?.setPersist(msg.annot_persist ?? DEFAULT_ANNOT_PERSIST);
        materialAnnotRef.current?.setPersist(msg.annot_persist ?? DEFAULT_ANNOT_PERSIST);
        setAnnotPersist(msg.annot_persist ?? DEFAULT_ANNOT_PERSIST);
        annotRef.current?.loadKept(msg.annots);
        presentingRef.current = msg.material ?? null;
        setPresenting(msg.material ?? null);
        materialAnnotRef.current?.clear();
        if (msg.material_annots) materialAnnotRef.current?.loadKept(msg.material_annots.annots);
        roomRef.current?.send({ type: 'state', state: stateRef.current });
        flushDiag();
        if (msg.peers.length > 0) openLink(msg.peers[0]);
        else if (linkRef.current) markAway();
        else setRemote(null);
        if (wantRecordRef.current && !recorderRef.current?.recording) void startRecording();
        setPhase('live');
        return;
      case 'peer_joined':
        textRef.current?.setPeer(msg.peer.client_id, msg.peer.name, msg.peer.user_id);
        openLink(msg.peer);
        return;
      case 'peer_left':
        textRef.current?.dropPeer(msg.client_id);
        if (remoteIdRef.current === msg.client_id) markAway();
        return;
      case 'peer_state':
        setRemote((r) => (r && r.peer.client_id === msg.client_id ? { ...r, peer: { ...r.peer, state: msg.state } } : r));
        return;
      case 'signal': {
        if (remoteIdRef.current !== msg.from) return;
        const data = msg.data as SignalData;
        const action = linkSignalAction(linkRef.current?.remoteLink ?? null, retiredLinksRef.current, data.link);
        if (action === 'ignore') return;
        // Their side started a fresh link (their old one failed): mine starts over too.
        if (action === 'replace' && remotePeerRef.current && data.link) openLink(remotePeerRef.current, { fresh: data.link });
        void linkRef.current?.handleSignal(data);
        return;
      }
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
      case 'text':
        textRef.current?.applyRemote(msg.ops, msg.page);
        return;
      case 'pages':
        textRef.current?.setPages(msg.pages);
        return;
      case 'page_doc':
        textRef.current?.pageDoc(msg.page, msg.text, msg.text_cursors);
        return;
      case 'page_view':
        textRef.current?.pageView(msg.client_id, msg.page);
        return;
      case 'page_preview':
        textRef.current?.pagePreview(msg.page, msg.preview, msg.chars, msg.updated_at);
        return;
      case 'page_deleted':
        textRef.current?.pageDeleted(msg.page, msg.fallback, msg.by);
        return;
      case 'page_summon':
        textRef.current?.summoned(msg.name, msg.page);
        return;
      case 'error':
        textRef.current?.notify(msg.message);
        return;
      case 'annot':
        annotStoreFor(msg.target)?.upsert(msg.stroke, msg.from, Date.now(), msg.name);
        return;
      case 'material': {
        const prev = presentingRef.current;
        presentingRef.current = msg.presenting;
        setPresenting(msg.presenting);
        // Another page (or material): its own drawings follow in material_annots.
        if (!msg.presenting || !prev || prev.material_id !== msg.presenting.material_id || prev.page !== msg.presenting.page) materialAnnotRef.current?.clear();
        return;
      }
      case 'material_annots':
        if (msg.target === materialTargetNow()) {
          materialAnnotRef.current?.clear();
          materialAnnotRef.current?.loadKept(msg.annots);
        }
        return;
      case 'annot_mode':
        annotRef.current?.setPersist(msg.persist);
        materialAnnotRef.current?.setPersist(msg.persist);
        setAnnotPersist(msg.persist);
        return;
      case 'annot_clear':
        annotStoreFor(msg.target)?.clear();
        return;
      case 'annot_text':
        annotStoreFor(msg.target)?.upsertText(msg.text, msg.from, Date.now(), msg.name);
        return;
      case 'annot_text_delete':
        annotStoreFor(msg.target)?.deleteText(msg.id);
        return;
      case 'annot_ping':
        annotStoreFor(msg.target)?.ping(msg.from, msg.x, msg.y, Date.now(), msg.name);
        return;
      case 'text_cursor':
        textRef.current?.setCursor({ client_id: msg.client_id, user_id: msg.user_id, name: msg.name, sel: msg.sel, compose: msg.compose ?? null, page: msg.page });
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
  }, [openLink, markAway, flushDiag, startRecording, finish]);

  // ---------------------------------------------------------------- join / leave

  const join = useCallback(async (opts: { record: boolean }) => {
    wantRecordRef.current = opts.record;
    finishedRef.current = false;
    setPhase('joining');
    // Joined before the camera / mic answered (or the preview never started): wait a little for them,
    // so a rejoin doesn't come in with everything off.
    if (!localRef.current?.getTracks().length) {
      const preview = previewRef.current ?? startPreview();
      await Promise.race([preview, new Promise((r) => setTimeout(r, JOIN_MEDIA_WAIT_MS))]);
    }
    // No camera / no microphone is fine: join with what there is, turn the rest on later.
    // (The tracks' `enabled` is the on / off — the state captured by this closure may predate the preview.)
    stateRef.current = { mic: !!audioTrack()?.enabled, cam: !!cameraTrack()?.enabled, screen: false, recording: false };
    diag('join', `joining with ${[audioTrack() ? (audioTrack()!.enabled ? 'mic' : 'mic muted') : 'no mic', cameraTrack() ? (cameraTrack()!.enabled ? 'camera' : 'camera off') : 'no camera'].join(', ')}; ${navigator.userAgent.slice(0, 120)}`);
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
      wakeLockRef.current = (await nav.wakeLock?.request('screen')) ?? null;
    } catch {
      /* no wake lock — the screen may dim */
    }
    const room = new CallRoomSocket(callId, {
      onMessage,
      onStatus: (status) => {
        setRoomStatus(status);
        diag('room', status);
        if (status === 'open') flushDiag();
        linkRef.current?.signallingChanged();
      },
      onJoinInfo: (info) => {
        iceRef.current = info.ice_servers;
        if (info.turn !== turnRef.current) {
          diag('join', info.turn ? `TURN relay offered (${info.ice_servers.flatMap((x) => (Array.isArray(x.urls) ? x.urls : [x.urls])).filter((u) => u.startsWith('turn')).length} URLs incl. TLS 443)` : 'no TURN relay configured — STUN only');
        }
        turnRef.current = info.turn;
        setTurn(info.turn);
      },
      onFatal: (message) => void finish('error', message),
    }, instanceRef.current);
    roomRef.current = room;
    await room.connect();
  }, [callId, onMessage, finish, diag, flushDiag, startPreview]);

  /** Leave (the call goes on for the other person): the room hears `leave`, the page offers Rejoin. */
  const leave = useCallback(async () => {
    await finish('left');
  }, [finish]);

  /** Back into a call I left (same page: a fresh room socket and link; devices restored as I left them). */
  const rejoin = useCallback(async () => {
    finishedRef.current = false;
    setPhase('prejoin');
    await startPreview();
    await join({ record: wantRecordRef.current });
  }, [startPreview, join]);

  const endForEveryone = useCallback(async () => {
    const sent = roomRef.current?.send({ type: 'end' });
    if (!sent) await endCallApi(callId).catch(() => {});
    await finish('ended');
  }, [callId, finish]);

  // ---------------------------------------------------------------- controls

  const toggleMic = useCallback(() => {
    const track = audioTrack();
    if (!track) {
      void requestMedia({ audio: true, video: false }); // turn the microphone on (asks for it)
      return;
    }
    const next = !micOn;
    if (track) track.enabled = next;
    setMicOn(next);
    rememberOnOff('mic', next);
    broadcastState({ mic: next });
  }, [micOn, broadcastState, requestMedia, rememberOnOff]);

  const toggleCam = useCallback(() => {
    const track = cameraTrack();
    if (!track) {
      void requestMedia({ audio: false, video: true });
      return;
    }
    const next = !camOn;
    track.enabled = next;
    setCamOn(next);
    rememberOnOff('cam', next);
    broadcastState({ cam: next });
  }, [camOn, broadcastState, requestMedia, rememberOnOff]);

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
      facingRef.current = nextFacing;
      await installTrack(track);
      setFacing(nextFacing);
    } catch (err) {
      console.error('[calls] flip camera failed:', err);
    }
  }, [facing, camOn, installTrack]);

  /** Switch microphone / camera / speaker (remembered on this device). */
  const chooseDevice = useCallback(async (kind: 'audio' | 'video' | 'speaker', deviceId: string | null) => {
    const next = { ...prefsRef.current, [kind === 'audio' ? 'audioId' : kind === 'video' ? 'videoId' : 'speakerId']: deviceId };
    prefsRef.current = next;
    setDevicePrefs(next);
    saveDevicePrefs(next);
    if (kind === 'speaker') return;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia(
        kind === 'audio' ? { audio: audioConstraints(deviceId) } : { video: videoConstraints(facingRef.current, deviceId) },
      );
      const track = (kind === 'audio' ? fresh.getAudioTracks() : fresh.getVideoTracks())[0];
      if (!track) return;
      track.enabled = kind === 'audio' ? micOn : camOn;
      const wasRecording = kind === 'audio' && !!recorderRef.current?.recording;
      if (wasRecording) await recorderRef.current?.stop();
      await installTrack(track);
      if (wasRecording) await recorderRef.current?.start(track);
      setMediaProblems((p) => (kind === 'audio' ? { ...p, audio: null } : { ...p, video: null }));
      diag('media', `switched ${kind === 'audio' ? 'microphone' : 'camera'}`);
    } catch (err) {
      console.error('[calls] device switch failed:', err);
    }
  }, [micOn, camOn, installTrack, diag]);

  const stopScreenShare = useCallback(async () => {
    screenRef.current?.getTracks().forEach((t) => t.stop());
    screenRef.current = null;
    setScreenStream(null);
    await linkRef.current?.setScreenTrack(null);
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
      await linkRef.current?.setScreenTrack(track);
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

  const sendAnnotation = useCallback((stroke: AnnotStroke) => {
    annotRef.current?.upsert(stroke, 'me');
    roomRef.current?.send({ type: 'annot', stroke });
  }, []);

  const sendPing = useCallback((x: number, y: number) => {
    annotRef.current?.ping('me', x, y);
    roomRef.current?.send({ type: 'annot_ping', x, y });
  }, []);

  // ---- lesson materials (round 4): present, turn pages, draw / type on the current page
  const presentMaterial = useCallback((materialId: string, page = 0) => roomRef.current?.send({ type: 'material_open', material_id: materialId, page }) ?? false, []);
  const turnMaterialPage = useCallback((page: number) => {
    const cur = presentingRef.current;
    if (!cur) return;
    roomRef.current?.send({ type: 'material_page', page });
  }, []);
  const stopPresenting = useCallback(() => roomRef.current?.send({ type: 'material_close' }), []);
  const materialAnnot = useMemo(() => ({
    stroke: (stroke: AnnotStroke) => {
      const target = materialTargetNow();
      if (!target) return;
      materialAnnotRef.current?.upsert(stroke, 'me');
      roomRef.current?.send({ type: 'annot', stroke, target });
    },
    ping: (x: number, y: number) => {
      const target = materialTargetNow();
      if (!target) return;
      materialAnnotRef.current?.ping('me', x, y);
      roomRef.current?.send({ type: 'annot_ping', x, y, target });
    },
    text: (text: AnnotText) => {
      const target = materialTargetNow();
      if (!target) return;
      materialAnnotRef.current?.upsertText(text, 'me');
      roomRef.current?.send({ type: 'annot_text', text, target });
    },
    deleteText: (id: string) => {
      const target = materialTargetNow();
      if (!target) return;
      materialAnnotRef.current?.deleteText(id);
      roomRef.current?.send({ type: 'annot_text_delete', id, target });
    },
    clear: () => {
      const target = materialTargetNow();
      if (!target) return;
      materialAnnotRef.current?.clear();
      roomRef.current?.send({ type: 'annot_clear', target });
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  /** A text box on the shared screen: placed, typed into, moved (round 4). */
  const sendAnnotText = useCallback((text: AnnotText) => {
    annotRef.current?.upsertText(text, 'me');
    roomRef.current?.send({ type: 'annot_text', text });
  }, []);

  const deleteAnnotText = useCallback((id: string) => {
    annotRef.current?.deleteText(id);
    roomRef.current?.send({ type: 'annot_text_delete', id });
  }, []);

  const clearAnnotations = useCallback(() => {
    annotRef.current?.clear();
    roomRef.current?.send({ type: 'annot_clear' });
  }, []);

  const setAnnotationsKept = useCallback((persist: boolean) => {
    annotRef.current?.setPersist(persist);
    materialAnnotRef.current?.setPersist(persist);
    setAnnotPersist(persist);
    roomRef.current?.send({ type: 'annot_mode', persist });
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

  // Before joining: when the person allows the camera / mic in the site settings, pick it up without a reload.
  useEffect(() => {
    const perms = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
    if (!perms?.query) return;
    const statuses: PermissionStatus[] = [];
    let alive = true;
    for (const [name, kind] of [['camera', 'video'], ['microphone', 'audio']] as const) {
      perms
        .query({ name: name as PermissionName })
        .then((status) => {
          if (!alive) return;
          statuses.push(status);
          status.onchange = () => {
            if (status.state !== 'granted' || phaseRef.current !== 'prejoin') return;
            const has = kind === 'audio' ? !!localRef.current?.getAudioTracks().length : !!localRef.current?.getVideoTracks().length;
            if (!has) void requestMedia({ audio: kind === 'audio', video: kind === 'video' });
          };
        })
        .catch(() => {}); // Firefox has no 'camera' permission name
    }
    return () => {
      alive = false;
      statuses.forEach((st) => (st.onchange = null));
    };
  }, [requestMedia]);

  // Closing the tab / app (pagehide): tell the room I've left — over the socket and a beacon —
  // so the other person's "is calling" banner goes at once. (Switching to another app is NOT
  // leaving: the page stays in the call; if it gets frozen, the room's heartbeat notices.)
  // A page restored from the back/forward cache reloads, which rejoins cleanly.
  useEffect(() => {
    let leftOnHide = false;
    const onHide = () => {
      if (!roomRef.current || finishedRef.current) return;
      leftOnHide = true;
      roomRef.current.close({ beacon: true });
    };
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted && leftOnHide) window.location.reload();
    };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
    };
  }, []);

  // Leaving the page: stop everything (the recording's last piece is closed
  // by the recorder, or by closeOrphanPieces on the next sync if the tab dies first).
  useEffect(() => () => {
    finishedRef.current = true;
    clearAwayTimer();
    void recorderRef.current?.stop();
    linkRef.current?.close();
    roomRef.current?.close();
    localRef.current?.getTracks().forEach((t) => t.stop());
    screenRef.current?.getTracks().forEach((t) => t.stop());
    void wakeLockRef.current?.release().catch(() => {});
  }, []);

  return {
    phase, error, mediaProblems, mediaAsked, mediaPending, localStream, screenStream, remote, roomStatus, turn,
    devicePrefs, chooseDevice, requestMedia,
    micOn, camOn, facing, recording, pendingUploads, startedAt,
    board, liveStrokes: Object.values(liveStrokes), chat,
    startPreview, join, leave, rejoin, endForEveryone, toggleMic, toggleCam, flipCamera,
    startScreenShare, stopScreenShare, startRecording, stopRecording,
    commitBoard, sendLiveStroke, sendChat,
    textBoard: textRef.current,
    annotations: annotRef.current,
    sendAnnotation, sendPing, clearAnnotations, annotPersist, setAnnotationsKept, sendAnnotText, deleteAnnotText,
    presenting, presentMaterial, turnMaterialPage, stopPresenting, materialAnnotations: materialAnnotRef.current, materialAnnot,
    hasCamera: !!localStream?.getVideoTracks().length,
    hasMic: !!localStream?.getAudioTracks().length,
    myUserId,
  };
}
