/**
 * /calls/:id — the live video call (experimental). Pre-join preview → the
 * call (video, whiteboard, chat, screen share, recording) → "call ended"
 * with the upload status and a link to the transcript. Logic lives in
 * hooks/useCall.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { getCall } from '../api/calls';
import { useCall, canShareScreen } from '../hooks/useCall';
import { CallRecorder } from '../services/calls/recorder';
import { Whiteboard } from '../components/calls/Whiteboard';
import { TextBoard } from '../components/calls/TextBoard';
import { AnnotationLayer, type AnnotTool } from '../components/calls/AnnotationLayer';
import { annotationPipSupported, openAnnotationPip, type AnnotationPip } from '../services/calls/annotationPip';
import { ANNOT_COLORS, defaultAnnotColor } from '@shared/calls';
import {
  arrangeTiles,
  boardButton,
  boardOnStage as isBoardOnStage,
  formatOffset,
  initialLinkHealth,
  isAvailable,
  followStep,
  autoShowBoard,
  isShowing,
  showingBanner,
  shareStoppedNote,
  tileForShow,
  SHOW_BUTTON_LABEL,
  SHOWN_BUTTON_LABEL,
  STOP_THEIR_SHARE_LABEL,
  type AppliedShow,
  type ShowView,
  layoutReducer,
  layoutShortcut,
  PRESETS,
  sanitizeLayout,
  tileStatus,
  type CallChatMessage,
  type CallLayout,
  type LayoutAction,
  type TileId,
  type VideoSize,
} from '@shared/calls';
import { CallTiles, type TileSpec } from '../components/calls/CallTiles';
import { CallVideo } from '../components/calls/CallVideo';
import { MediaProblemCard } from '../components/calls/MediaProblemCard';
import { DevicesSheet } from '../components/calls/DevicesSheet';
import { MaterialTile } from '../components/calls/MaterialTile';
import { PresentMaterialSheet } from '../components/calls/PresentMaterialSheet';
import { ActivityTile } from '../components/calls/activities/ActivityTile';
import { ActivityPickerSheet } from '../components/calls/activities/ActivityPickerSheet';
import './CallPage.css';

function Initials({ name }: { name: string }) {
  const letters = name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  return <div className="call-initials" aria-hidden="true">{letters}</div>;
}

function useElapsed(startedAt: number | null, live: boolean): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  return startedAt ? formatOffset(now - startedAt) : '0:00';
}

function ChatPanel({ messages, myUserId, onSend }: { messages: CallChatMessage[]; myUserId: string; onSend: (text: string) => boolean }) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSend(text)) setText('');
  };
  return (
    <div className="call-chat">
      <div className="call-chat-list" ref={listRef}>
        {messages.length === 0 && <p className="call-chat-empty">Type a word or sentence here — it’s saved with the call and goes into the lesson notes.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`call-chat-msg${m.user_id === myUserId ? ' mine' : ''}`}>
            {m.user_id !== myUserId && <span className="call-chat-name">{m.name}</span>}
            <span className="call-chat-text" lang="zh">{m.text}</span>
          </div>
        ))}
      </div>
      <form className="call-chat-form" onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message…" lang="zh" aria-label="Chat message" data-testid="call-chat-input" />
        <button type="submit" className="btn btn-primary" disabled={!text.trim()}>Send</button>
      </form>
    </div>
  );
}

/** The last layout, per user on this device. */
function layoutKey(userId: string): string {
  return `call-layout-v1:${userId}`;
}

function loadLayout(userId: string): CallLayout {
  try {
    return sanitizeLayout(JSON.parse(localStorage.getItem(layoutKey(userId)) || 'null'));
  } catch {
    return sanitizeLayout(null);
  }
}

function isTyping(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable);
}

export function CallPage() {
  const { id } = useParams<{ id: string }>();
  const callId = id!;
  const { user } = useAuth();
  const navigate = useNavigate();
  const callQuery = useQuery({ queryKey: ['call', callId], queryFn: () => getCall(callId), staleTime: 30_000 });
  const call = useCall(callId, user!.id);
  const [record, setRecord] = useState(CallRecorder.supported());
  const [layout, setLayout] = useState<CallLayout>(() => loadLayout(user!.id));
  const dispatch = useCallback((a: LayoutAction) => setLayout((l) => layoutReducer(l, a)), []);
  useEffect(() => {
    try {
      localStorage.setItem(layoutKey(user!.id), JSON.stringify(layout));
    } catch {
      /* private mode */
    }
  }, [layout, user]);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [endConfirm, setEndConfirm] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [presentOpen, setPresentOpen] = useState(false);
  const [activitiesOpen, setActivitiesOpen] = useState(false);
  // A device problem in the call is shown until dismissed (a new problem shows again).
  const [dismissedProblem, setDismissedProblem] = useState('');
  const [seenChat, setSeenChat] = useState(0);
  const elapsed = useElapsed(call.startedAt, call.phase === 'live');
  // The camera's real shape (a phone's is portrait, a webcam's landscape) sizes the preview and the self-view.
  const [localSize, setLocalSize] = useState<VideoSize | null>(null);
  const [selfSize, setSelfSize] = useState<VideoSize | null>(null);
  const [remoteCamSize, setRemoteCamSize] = useState<VideoSize | null>(null);
  // Drawing on the other person's shared screen / seeing drawings on mine.
  const [remoteSize, setRemoteSize] = useState<VideoSize | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [annotColor, setAnnotColor] = useState<string | null>(null); // null = my default for this role
  /** Pen or Text (round 4: type on the shared screen too). */
  const [annotTool, setAnnotTool] = useState<AnnotTool>('pen');
  const [myScreenSize, setMyScreenSize] = useState<VideoSize | null>(null);
  const [annotPip, setAnnotPip] = useState<AnnotationPip | null>(null);
  const [theyDrawAt, setTheyDrawAt] = useState(0);
  const remoteSharing = !!call.remote?.peer.state.screen;
  const iShare = !!call.screenStream && !remoteSharing;
  const pen = annotColor ?? defaultAnnotColor(iShare);
  const sharing = remoteSharing || !!call.screenStream;
  useEffect(() => {
    if (!sharing) setAnnotating(false);
  }, [sharing]);
  useEffect(() => {
    // Their screen share starts: put it on the stage, both faces over it (or the cameras separately, if chosen).
    if (remoteSharing) dispatch({ type: 'shareStarted' });
  }, [remoteSharing, dispatch]);
  // A sideways swipe moves between tiles: it must never be the browser's "back" gesture.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.overscrollBehaviorX;
    root.style.overscrollBehaviorX = 'none';
    document.body.style.overscrollBehaviorX = 'none';
    return () => {
      root.style.overscrollBehaviorX = prev;
      document.body.style.overscrollBehaviorX = '';
    };
  }, []);
  // Desktop shortcuts: 1–5 presets, B board, D draw, C chat, V video, S screen (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const action = layoutShortcut(e.key);
      if (action) {
        e.preventDefault();
        dispatch(action);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);
  // "… is drawing on your screen" while I share.
  useEffect(() => call.annotations.subscribe(() => setTheyDrawAt(call.annotations.lastRemoteAt)), [call.annotations]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!theyDrawAt) return;
    const t = setTimeout(() => setTick((n) => n + 1), 6100); // the "is drawing" note goes away
    return () => clearTimeout(t);
  }, [theyDrawAt]);
  useEffect(() => {
    if (!call.screenStream && annotPip) {
      annotPip.close();
      setAnnotPip(null);
    }
  }, [call.screenStream, annotPip]);
  useEffect(() => () => annotPip?.close(), [annotPip]);

  const detail = callQuery.data;
  const other = detail?.participants.find((p) => p.id !== user!.id);
  const otherName = call.remote?.peer.name || other?.name || other?.email?.split('@')[0] || 'your partner';

  // Show the camera as soon as the page opens (the browser asks once).
  useEffect(() => {
    if (detail?.call.status === 'live') void call.startPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.call.status]);

  const available = { screen: remoteSharing || !!call.screenStream, material: !!call.presenting, activity: !!call.activity };
  // A material someone starts presenting comes onto the stage (like a shared screen).
  const presentingId = call.presenting?.material_id ?? null;
  useEffect(() => {
    if (presentingId) dispatch({ type: 'materialStarted' });
  }, [presentingId]);
  // An activity either person starts comes onto the stage for both.
  const activityId = call.activity?.session_id ?? null;
  useEffect(() => {
    if (activityId) dispatch({ type: 'activityStarted' });
  }, [activityId]);
  const stageTiles = arrangeTiles(layout, available, typeof window !== 'undefined' ? window.innerWidth : 1024).stage;
  const chatVisible = stageTiles.includes('chat') || (layout.open.includes('chat') && layout.mode === 'grid');
  const stageKey = stageTiles.join(',');

  // ---- round 5 (shared/calls/follow.ts): the tutor leads the student's stage.
  const iLead = !!call.tutorId && call.tutorId === user!.id;
  // The board page I'm on (the text board's session changes it).
  const [boardPage, setBoardPage] = useState(call.textBoard.page);
  useEffect(() => call.textBoard.subscribe(() => setBoardPage(call.textBoard.page)), [call.textBoard]);
  // Tutor: opening the board shows it to the student too; turning its page while it is shown follows.
  const prevStageRef = useRef<string[]>(stageTiles);
  useEffect(() => {
    const prev = prevStageRef.current;
    prevStageRef.current = stageTiles;
    if (!iLead || call.phase !== 'live') return;
    const kind = autoShowBoard(prev as TileId[], stageTiles);
    if (kind) call.show(kind === 'text' ? { kind, page: call.textBoard.page || undefined } : { kind });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageKey, iLead, call.phase]);
  useEffect(() => {
    const sh = call.shown;
    if (!iLead || !boardPage || !sh || sh.by !== user!.id || sh.view.kind !== 'text' || sh.view.page === boardPage) return;
    if (stageTiles.includes('text')) call.show({ kind: 'text', page: boardPage }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardPage, iLead]);
  // Student: each new show goes on my stage once (then my own layout wins); page turns follow while I'm on the board.
  const appliedShowRef = useRef<AppliedShow | null>(null);
  const [bannerShow, setBannerShow] = useState<string | null>(null);
  useEffect(() => {
    const sh = call.shown;
    if (!sh) return;
    const tile = tileForShow(sh.view);
    const step = followStep(appliedShowRef.current, sh, user!.id, isAvailable(tile, available), stageTiles.includes(tile));
    if (step.kind === 'none') return;
    appliedShowRef.current = { id: sh.id, v: sh.v };
    if (step.kind === 'stage') {
      dispatch({ type: 'shown', tile: step.tile });
      setBannerShow(sh.id);
    }
    const page = step.kind === 'stage' ? step.page : step.page;
    if (page && page !== call.textBoard.page) call.textBoard.openPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.shown, available.screen, available.material, available.activity]);
  const bannerOn = !!call.shown && bannerShow === call.shown.id && call.shown.by !== user!.id && stageTiles.includes(tileForShow(call.shown.view));
  // "Minghui stopped your screen share": a few seconds.
  useEffect(() => {
    if (!call.shareStoppedBy) return;
    const t = setTimeout(call.dismissShareStopped, 6000);
    return () => clearTimeout(t);
  }, [call.shareStoppedBy, call.dismissShareStopped]);
  useEffect(() => {
    if (chatVisible) setSeenChat(call.chat.length);
  }, [chatVisible, call.chat.length]);

  const problemKey = `${call.mediaProblems.audio ?? ''}|${call.mediaProblems.video ?? ''}`;
  const retryMedia = () => void call.requestMedia({ audio: !call.hasMic, video: !call.hasCamera });
  const currentDevices = {
    audio: call.localStream?.getAudioTracks()[0]?.getSettings().deviceId ?? null,
    video: call.localStream?.getVideoTracks()[0]?.getSettings().deviceId ?? null,
  };
  const devicesSheet = devicesOpen && (
    <DevicesSheet prefs={call.devicePrefs} current={currentDevices} onChoose={(kind, id) => void call.chooseDevice(kind, id)} onClose={() => setDevicesOpen(false)} />
  );

  if (callQuery.isLoading) return <div className="call-page call-center"><p>Loading the call…</p></div>;
  if (callQuery.error || !detail) {
    return (
      <div className="call-page call-center">
        <p>Call not found.</p>
        <Link to="/calls" className="btn btn-secondary">Back to calls</Link>
      </div>
    );
  }
  if (detail.call.status === 'ended' && call.phase === 'prejoin') return <Navigate to={`/calls/${callId}/review`} replace />;

  // ------------------------------------------------ ended
  if (call.phase === 'left') {
    return (
      <div className="call-page call-center" data-testid="call-left">
        <div className="call-ended-card">
          <div className="call-ended-emoji" aria-hidden="true">🚪</div>
          <h1>You left the call</h1>
          <p className="call-muted">
            It goes on for {detail.participants.find((p) => p.id !== call.myUserId)?.name?.split(' ')[0] ?? 'the other person'} — rejoin from here or from another device. A call nobody is in ends by itself after 10 minutes.
          </p>
          <div className="call-ended-actions">
            <button type="button" className="btn btn-primary" onClick={() => void call.rejoin()} data-testid="rejoin-call">Rejoin</button>
            <Link to="/calls" className="btn btn-secondary">All calls</Link>
          </div>
        </div>
      </div>
    );
  }
  if (call.phase === 'ended' || call.phase === 'error') {
    return (
      <div className="call-page call-center" data-testid="call-ended">
        <div className="call-ended-card">
          <div className="call-ended-emoji" aria-hidden="true">{call.phase === 'ended' ? '👋' : '⚠️'}</div>
          <h1>{call.phase === 'ended' ? 'Call ended' : 'Left the call'}</h1>
          {call.error && <p className="call-muted">{call.error}</p>}
          {call.pendingUploads > 0 ? (
            <p className="call-muted">Uploading your recording… {call.pendingUploads} part{call.pendingUploads === 1 ? '' : 's'} left. You can close this page — it finishes on the next sync.</p>
          ) : (
            <p className="call-muted">The transcript and lesson notes appear on the call page in a few minutes.</p>
          )}
          <div className="call-ended-actions">
            <button type="button" className="btn btn-primary" onClick={() => navigate(`/calls/${callId}/review`)}>Transcript &amp; notes</button>
            <Link to="/calls" className="btn btn-secondary">All calls</Link>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------ pre-join
  if (call.phase === 'prejoin' || call.phase === 'joining') {
    return (
      <div className="call-page call-prejoin">
        <div className="call-prejoin-top">
          <Link to={detail.call.relationship_id ? `/connections/${detail.call.relationship_id}` : '/calls'} className="call-back">‹ Back</Link>
          <span className="call-beta">Beta</span>
        </div>
        <div className="call-prejoin-preview" style={localSize ? { aspectRatio: `${localSize.width} / ${localSize.height}` } : undefined}>
          {call.localStream && call.hasCamera && call.camOn ? (
            <CallVideo stream={call.localStream} muted mirrored className="call-prejoin-video" testId="local-preview" onVideoSize={setLocalSize} />
          ) : (
            <Initials name={user!.name || user!.email || 'You'} />
          )}
          <div className="call-prejoin-toggles">
            <button type="button" className={`call-btn${call.micOn && call.hasMic ? '' : ' off'}`} onClick={call.toggleMic} aria-label={!call.hasMic ? 'Turn microphone on' : call.micOn ? 'Mute microphone' : 'Unmute microphone'} data-testid="prejoin-mic">{call.micOn && call.hasMic ? '🎙️' : '🔇'}</button>
            <button type="button" className={`call-btn${call.camOn && call.hasCamera ? '' : ' off'}`} onClick={call.toggleCam} aria-label={!call.hasCamera ? 'Turn camera on' : call.camOn ? 'Turn camera off' : 'Turn camera on'} data-testid="prejoin-cam">{call.camOn && call.hasCamera ? '📷' : '🚫'}</button>
            <button type="button" className="call-btn" onClick={() => setDevicesOpen(true)} aria-label="Devices" title="Camera, microphone and speaker" data-testid="open-devices">⚙️</button>
          </div>
        </div>
        <div className="call-prejoin-body">
          <h1>{detail.call.title || `Lesson with ${otherName}`}</h1>
          <MediaProblemCard problems={call.mediaProblems} pending={call.mediaPending} onRetry={retryMedia} />
          <label className={`call-record-toggle${CallRecorder.supported() ? '' : ' disabled'}`}>
            <input type="checkbox" checked={record} disabled={!CallRecorder.supported()} onChange={(e) => setRecord(e.target.checked)} data-testid="record-toggle" />
            <span>
              <strong>Record my microphone for the transcript</strong>
              <span className="call-muted"> Chinese + English, transcribed after the call, with lesson notes and flashcards. Both of you see a ● REC badge.</span>
            </span>
          </label>
          <button
            type="button"
            className="btn btn-primary call-join-btn"
            onClick={() => void call.join({ record })}
            disabled={call.phase === 'joining'}
            data-testid="join-call"
          >
            {call.phase === 'joining'
              ? 'Joining…'
              : call.mediaPending || !call.mediaAsked || (call.hasMic && call.hasCamera)
                ? 'Join call'
                : call.hasMic
                  ? 'Join with audio only'
                  : call.hasCamera
                    ? 'Join without microphone'
                    : 'Join without camera & mic'}
          </button>
          {call.mediaPending && !call.mediaProblems.audio && !call.mediaProblems.video && (
            <p className="call-muted">Your browser will ask to use the camera and microphone — choose Allow.</p>
          )}
        </div>
        {devicesSheet}
      </div>
    );
  }

  // ------------------------------------------------ live
  const remote = call.remote;
  const remoteState = remote?.peer.state;
  const someoneRecording = call.recording || !!remoteState?.recording;
  // An older app sends its screen on the camera stream (no screen channel).
  const legacyShare = remoteSharing && !!remote && !remote.screenChannel;
  const remoteCamOn = !!remote?.stream && !!remoteState?.cam && !legacyShare;
  const remoteScreenStream = remoteSharing ? (legacyShare ? remote?.stream ?? null : remote?.screenStream ?? null) : null;
  const unread = Math.max(0, call.chat.length - seenChat);
  const status = remote ? tileStatus(remote.health ?? { ...initialLinkHealth(0), pc: remote.connection === 'new' ? 'new' : remote.connection }, remote.away) : 'live';
  const boardOnStage = isBoardOnStage(layout);
  const chatOnStage = chatVisible;
  const first = otherName.split(' ')[0];

  /** The tutor's corner button on a tile on her stage: "Show for student" / "Showing ✓". */
  const showButton = (tile: TileId, view: ShowView) => {
    if (!iLead || !stageTiles.includes(tile)) return null;
    const on = isShowing(call.shown, call.myUserId, view);
    return (
      <button type="button" className={`call-show-btn${on ? ' on' : ''}`} onClick={() => call.show(view)} data-testid={`show-${tile}`} title="Put this on the student's screen">
        {on ? SHOWN_BUTTON_LABEL : `👁 ${SHOW_BUTTON_LABEL}`}
      </button>
    );
  };

  const boardSwitch = (current: 'text' | 'draw') => (
    <div className="call-board-switch" role="tablist">
      <button type="button" role="tab" aria-selected={current === 'text'} className={current === 'text' ? 'active' : ''} onClick={() => dispatch({ type: 'swap', from: 'draw', to: 'text' })} data-testid={current === 'draw' ? 'board-tab-text' : undefined}>Board</button>
      <button type="button" role="tab" aria-selected={current === 'draw'} className={current === 'draw' ? 'active' : ''} onClick={() => dispatch({ type: 'swap', from: 'text', to: 'draw' })} data-testid={current === 'text' ? 'board-tab-draw' : undefined}>Draw</button>
    </div>
  );

  const tiles: Partial<Record<TileId, TileSpec>> = {
    remote: {
      label: otherName,
      content: remote ? (
        <div className="call-tile-body call-tile-video" data-testid="remote-tile">
          {remote.stream && (
            // Always mounted while they're here: a dropout freezes the last frame instead of going blank.
            <CallVideo stream={remote.stream} className={`call-remote-video${remoteCamOn ? '' : ' hidden'}`} testId="remote-video" onVideoSize={setRemoteCamSize} sinkId={call.devicePrefs.speakerId ?? null} />
          )}
          {!remoteCamOn && <Initials name={otherName} />}
          {status !== 'live' && (
            <div className={`call-tile-status ${status}`} data-testid="remote-status" role="status">
              <span className="call-spinner" aria-hidden="true" /> {status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
            </div>
          )}
          <div className="call-remote-label">
            {remoteState && !remoteState.mic && <span aria-label="muted">🔇 </span>}
            {otherName}
          </div>
        </div>
      ) : (
        <div className="call-tile-body call-waiting" data-testid="call-waiting">
          <p>Waiting for {otherName} to join…</p>
          <p className="call-muted">They got a Join link in your chat.</p>
        </div>
      ),
    },
    self: {
      label: 'You',
      content: (
        <div className="call-tile-body call-tile-video" data-testid="self-view">
          {call.hasCamera && call.camOn ? (
            <CallVideo stream={call.localStream} muted mirrored={call.facing === 'user'} fit="cover" className="call-self-video" onVideoSize={setSelfSize} />
          ) : (
            <div className="call-self-off">{call.micOn && call.hasMic ? 'You' : '🔇 You'}</div>
          )}
        </div>
      ),
    },
    screen: {
      label: remoteSharing ? `${first}’s screen` : 'Your screen',
      content: sharing ? (
        <div className="call-tile-body call-tile-video" data-testid="screen-tile">
          {remoteSharing ? (
            remoteScreenStream && <CallVideo stream={remoteScreenStream} screen className="call-remote-screen" testId="remote-screen" onVideoSize={setRemoteSize} />
          ) : (
            // My own shared screen, as big as any tile: I can draw on it too.
            <CallVideo stream={call.screenStream} muted screen className="call-self-screen" testId="my-screen" onVideoSize={setMyScreenSize} />
          )}
          {iShare && showButton('screen', { kind: 'screen' })}
          {remoteSharing && iLead && (
            <button type="button" className="call-stop-their-share" onClick={() => call.stopTheirShare()} data-testid="stop-their-share">
              ⏹ {STOP_THEIR_SHARE_LABEL}
            </button>
          )}
          <AnnotationLayer
            store={call.annotations}
            video={remoteSharing ? remoteSize : myScreenSize}
            interactive={annotating}
            color={pen}
            onStroke={call.sendAnnotation}
            onPing={call.sendPing}
            tool={annotTool}
            onText={call.sendAnnotText}
            onTextDelete={call.deleteAnnotText}
            className={remoteSharing ? 'annot-over-remote' : 'annot-over-mine'}
            testId={remoteSharing ? 'annot-remote' : 'annot-self'}
          />
          <div className="annot-tools" data-testid="annot-tools">
            <button type="button" className={`annot-toggle${annotating ? ' on' : ''}`} onClick={() => setAnnotating((v) => !v)} data-testid="annot-toggle">
              {annotating ? '✓ Done' : remoteSharing ? `✏️ Draw or type on ${first}’s screen` : '✏️ Draw or type on your screen'}
            </button>
            {annotating && (
              <>
                <span className="annot-toolset" role="radiogroup" aria-label="Tool">
                  <button type="button" role="radio" aria-checked={annotTool === 'pen'} className={`annot-tool${annotTool === 'pen' ? ' on' : ''}`} onClick={() => setAnnotTool('pen')} data-testid="annot-tool-pen" title="Pen: drag to circle, tap to point">✏️ Pen</button>
                  <button type="button" role="radio" aria-checked={annotTool === 'text'} className={`annot-tool${annotTool === 'text' ? ' on' : ''}`} onClick={() => setAnnotTool('text')} data-testid="annot-tool-text" title="Text: tap to type; tap a text to select, drag to move">T Text</button>
                </span>
                {ANNOT_COLORS.map((c) => (
                  <button key={c} type="button" className={`annot-swatch${c === pen ? ' active' : ''}`} style={{ background: c }} onClick={() => setAnnotColor(c)} aria-label={`Colour ${c}`} />
                ))}
                <button type="button" className="annot-clear" onClick={call.clearAnnotations} data-testid="annot-clear">Clear</button>
                <label className="annot-keep" title="Keep drawings and text until cleared (for both of you) — off: they fade after a few seconds">
                  <input type="checkbox" checked={call.annotPersist} onChange={(e) => call.setAnnotationsKept(e.target.checked)} data-testid="annot-keep" /> Keep
                </label>
                <span className="annot-hint">{annotTool === 'text' ? 'Tap to type · drag a text to move · tap it again to edit' : 'Drag to circle · tap to point'}</span>
              </>
            )}
          </div>
        </div>
      ) : null,
    },
    material: {
      label: call.presenting ? `📑 ${call.presenting.title}` : 'Material',
      content: call.presenting ? (
        <div className="call-tile-body call-show-host">
        {showButton('material', { kind: 'material' })}
        <MaterialTile
          presenting={call.presenting}
          store={call.materialAnnotations}
          persist={call.annotPersist}
          onPersist={call.setAnnotationsKept}
          myColor={pen}
          onTurn={call.turnMaterialPage}
          onStop={() => void call.stopPresenting()}
          annot={call.materialAnnot}
          active={stageTiles.includes('material')}
        />
        </div>
      ) : null,
    },
    activity: {
      label: call.activity ? `🎲 ${call.activity.spec.title}` : 'Activity',
      content: call.activity ? (
        <div className="call-tile-body call-show-host">
          {showButton('activity', { kind: 'activity' })}
          <ActivityTile session={call.activity} myUserId={call.myUserId} act={call.actInActivity} close={call.closeActivity} />
        </div>
      ) : null,
    },
    text: {
      label: 'Board',
      closable: true,
      content: (
        <div className="call-tile-body call-paper" data-testid="call-panel-text">
          {boardSwitch('text')}
          {showButton('text', { kind: 'text', page: boardPage || undefined })}
          <TextBoard session={call.textBoard} gloss={{ callId, userId: call.myUserId }} />
        </div>
      ),
    },
    draw: {
      label: 'Draw',
      closable: true,
      content: (
        <div className="call-tile-body call-paper" data-testid="call-panel-board">
          {boardSwitch('draw')}
          {showButton('draw', { kind: 'draw' })}
          <Whiteboard items={call.board} live={call.liveStrokes} myUserId={call.myUserId} onCommit={call.commitBoard} onLive={call.sendLiveStroke} />
        </div>
      ),
    },
    chat: {
      label: 'Chat',
      closable: true,
      content: (
        <div className="call-tile-body call-paper" data-testid="call-panel-chat">
          <ChatPanel messages={call.chat} myUserId={call.myUserId} onSend={call.sendChat} />
        </div>
      ),
    },
  };

  return (
    <div className="call-page call-live" data-testid="call-live">
      <div className="call-topbar">
        <span className="call-title">{otherName}</span>
        <span className="call-time">{elapsed}</span>
        {someoneRecording && <span className="call-rec" data-testid="rec-badge">● REC</span>}
        {call.roomStatus === 'reconnecting' && <span className="call-chip warn">Reconnecting…</span>}
      </div>

      <div className="call-main">
        {bannerOn && call.shown && (
          <div className="call-showing-banner" role="status" data-testid="showing-banner">
            <span>👁 {showingBanner(call.shown.name.split(' ')[0])}</span>
            <button type="button" onClick={() => setBannerShow(null)} aria-label="Hide">✕</button>
          </div>
        )}
        {call.shareStoppedBy && (
          <div className="call-showing-banner note" role="status" data-testid="share-stopped-note">
            <span>⏹ {shareStoppedNote(call.shareStoppedBy.name.split(' ')[0])}</span>
            <button type="button" onClick={call.dismissShareStopped} aria-label="Dismiss">✕</button>
          </div>
        )}
        <CallTiles
          layout={layout}
          dispatch={dispatch}
          replace={setLayout}
          available={available}
          tiles={tiles}
          aspects={{ remote: remoteCamSize, self: selfSize ?? localSize }}
        />
      </div>

      {call.screenStream && (
        <div className={`call-share-bar${Date.now() - theyDrawAt < 6000 ? ' drawing' : ''}`} data-testid="share-bar">
          <span>
            {Date.now() - theyDrawAt < 6000
              ? `✏️ ${call.annotations.lastRemoteName || otherName} is drawing on your screen`
              : '🖥️ You’re sharing your screen.'}
          </span>
          <button
            type="button"
            className="call-share-btn"
            data-testid="draw-on-my-screen"
            onClick={() => {
              dispatch({ type: 'preset', preset: 'screen' });
              setAnnotating(true);
            }}
          >
            ✏️ Draw on it
          </button>
          {annotationPipSupported() && (
            annotPip ? (
              <button type="button" className="call-share-btn" onClick={() => { annotPip.close(); setAnnotPip(null); }}>Close mini window</button>
            ) : (
              <button
                type="button"
                className="call-share-btn"
                data-testid="annot-pip"
                onClick={async () => {
                  const p = await openAnnotationPip(call.screenStream!, call.annotations, () => setAnnotPip(null));
                  if (p) setAnnotPip(p);
                }}
              >
                See drawings over your other windows
              </button>
            )
          )}
        </div>
      )}

      {(call.mediaProblems.audio || call.mediaProblems.video) && dismissedProblem !== problemKey && (
        <div className="call-media-toast">
          <MediaProblemCard problems={call.mediaProblems} pending={call.mediaPending} onRetry={retryMedia} compact />
          <button type="button" className="call-panel-close" aria-label="Dismiss" onClick={() => setDismissedProblem(problemKey)}>✕</button>
        </div>
      )}
      {activitiesOpen && (
        <ActivityPickerSheet
          running={call.activity && call.activity.phase !== 'done' ? call.activity.spec.title : null}
          onPick={(id) => {
            call.startActivity(id);
            setActivitiesOpen(false);
          }}
          onClose={() => setActivitiesOpen(false)}
        />
      )}
      {presentOpen && (
        <PresentMaterialSheet
          onPick={(id) => {
            call.presentMaterial(id);
            setPresentOpen(false);
          }}
          onClose={() => setPresentOpen(false)}
        />
      )}
      {devicesSheet}

      <div className="call-controls" role="toolbar" aria-label="Call controls">
        <button type="button" className={`call-btn${call.micOn && call.hasMic ? '' : ' off'}`} onClick={call.toggleMic} aria-label={!call.hasMic ? 'Turn microphone on' : call.micOn ? 'Mute' : 'Unmute'} title={!call.hasMic ? 'Turn microphone on' : call.micOn ? 'Mute' : 'Unmute'} data-testid="call-mic">{call.micOn && call.hasMic ? '🎙️' : '🔇'}</button>
        <button type="button" className={`call-btn${call.camOn && call.hasCamera ? '' : ' off'}`} onClick={call.toggleCam} aria-label={!call.hasCamera ? 'Turn camera on' : call.camOn ? 'Camera off' : 'Camera on'} title="Camera" data-testid="call-cam">{call.camOn && call.hasCamera ? '📷' : '🚫'}</button>
        <button
          type="button"
          className={`call-btn${boardOnStage ? ' active' : ''}`}
          onClick={() => dispatch(boardButton(layout, typeof window !== 'undefined' && window.innerWidth < 640))}
          aria-label="Board"
          title="Board — type together, or draw (B)"
          data-testid="open-board"
        >
          📝
        </button>
        <button type="button" className={`call-btn${chatOnStage ? ' active' : ''}`} onClick={() => dispatch({ type: 'focus', tile: chatOnStage ? 'remote' : 'chat' })} aria-label="Chat" title="Chat (C)" data-testid="open-chat">
          💬{unread > 0 && !chatOnStage && <span className="call-badge">{unread}</span>}
        </button>
        {canShareScreen() && (
          <button type="button" className={`call-btn${call.screenStream ? ' active' : ''}`} onClick={() => void (call.screenStream ? call.stopScreenShare() : call.startScreenShare())} aria-label={call.screenStream ? 'Stop sharing' : 'Share screen'} title="Share screen">🖥️</button>
        )}
        <div className="call-more call-layout-wrap">
          <button type="button" className={`call-btn${layoutOpen ? ' active' : ''}`} onClick={() => setLayoutOpen((v) => !v)} aria-label="Layout" aria-expanded={layoutOpen} title="Layout" data-testid="open-layout">▦</button>
          {layoutOpen && (
            <div className="call-more-menu call-layout-menu" role="menu" data-testid="layout-menu">
              <div className="call-layout-presets">
                {PRESETS.filter((p) => p.id !== 'screen' || available.screen).map((p) => (
                  <button key={p.id} type="button" role="menuitem" onClick={() => { dispatch({ type: 'preset', preset: p.id }); setLayoutOpen(false); }} data-testid={`preset-${p.id}`}>
                    <span className={`call-preset-icon preset-${p.id}`} aria-hidden="true" />
                    <span>{p.label}</span>
                    <kbd>{p.key}</kbd>
                  </button>
                ))}
              </div>
              <div className="call-layout-open">
                {(['text', 'draw', 'chat'] as TileId[]).map((t) => (
                  <button key={t} type="button" role="menuitem" onClick={() => { dispatch({ type: 'focus', tile: t }); setLayoutOpen(false); }}>
                    {t === 'text' ? '📝 Board' : t === 'draw' ? '✏️ Draw' : '💬 Chat'}
                  </button>
                ))}
              </div>
              <div className="call-layout-cams" role="group" aria-label="Cameras over the board / screen">
                <span>Cameras</span>
                <button type="button" role="menuitemradio" aria-checked={layout.pip === 'pair'} className={layout.pip === 'pair' ? 'active' : ''} onClick={() => dispatch({ type: 'pip', pip: 'pair' })} data-testid="pip-pair">Together</button>
                <button type="button" role="menuitemradio" aria-checked={layout.pip === 'separate'} className={layout.pip === 'separate' ? 'active' : ''} onClick={() => dispatch({ type: 'pip', pip: 'separate' })} data-testid="pip-separate">Separate</button>
              </div>
              <label className="call-layout-toggle">
                <input type="checkbox" checked={layout.remoteFloat} onChange={(e) => dispatch({ type: 'remoteFloat', on: e.target.checked })} />
                Float {first}’s camera over the board / screen
              </label>
              <label className="call-layout-toggle">
                <input type="checkbox" checked={layout.dir === 'column'} onChange={(e) => dispatch({ type: 'dir', dir: e.target.checked ? 'column' : 'row' })} />
                Stack split panes
              </label>
            </div>
          )}
        </div>
        <div className="call-more">
          <button type="button" className="call-btn" onClick={() => setMoreOpen((v) => !v)} aria-label="More" aria-expanded={moreOpen}>⋯</button>
          {moreOpen && (
            <div className="call-more-menu" role="menu" onClick={() => setMoreOpen(false)}>
              <button type="button" role="menuitem" onClick={() => setPresentOpen(true)} data-testid="menu-present-material">📑 Present material</button>
              <button type="button" role="menuitem" onClick={() => setActivitiesOpen(true)} data-testid="menu-activities">🎲 Activities</button>
              <button type="button" role="menuitem" onClick={() => setDevicesOpen(true)} data-testid="menu-devices">🎛️ Camera, mic &amp; speaker</button>
              <button type="button" role="menuitem" onClick={() => void call.leave()} data-testid="menu-leave">🚪 Leave — the call goes on</button>
              {call.hasCamera && <button type="button" role="menuitem" onClick={() => void call.flipCamera()}>🔄 Flip camera</button>}
              {CallRecorder.supported() && (
                <button type="button" role="menuitem" onClick={() => void (call.recording ? call.stopRecording() : call.startRecording())}>
                  {call.recording ? '⏹ Stop recording my mic' : '⏺ Record my mic'}
                </button>
              )}
              {!call.turn && <div className="call-more-note">No TURN relay configured — calls on strict networks may not connect.</div>}
            </div>
          )}
        </div>
        <button
          type="button"
          className="call-btn leave"
          onClick={() => void call.leave()}
          aria-label="Leave — the call continues"
          title="Leave — the call continues (rejoin any time, e.g. from another device)"
          data-testid="leave-call"
        >
          <span aria-hidden="true">🚪</span>
          <span className="call-btn-label">Leave</span>
        </button>
        <button
          type="button"
          className="call-btn end"
          onClick={() => setEndConfirm(true)}
          aria-label="End the call for everyone"
          title="End the call for everyone"
          data-testid="end-call"
        >
          📞
        </button>
        {endConfirm && (
          <div className="call-end-confirm" role="alertdialog" aria-label="End the call?" data-testid="end-confirm">
            <p>
              <strong>End the call for everyone?</strong>
              <br />
              To switch device or step away, <em>Leave</em> instead — the call goes on.
            </p>
            <div className="call-end-confirm-actions">
              <button type="button" className="btn btn-secondary" onClick={() => { setEndConfirm(false); void call.leave(); }} data-testid="end-confirm-leave">Just leave</button>
              <button type="button" className="btn btn-danger" onClick={() => { setEndConfirm(false); void call.endForEveryone(); }} data-testid="end-confirm-end">End for everyone</button>
              <button type="button" className="btn btn-link" onClick={() => setEndConfirm(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CallPage;
