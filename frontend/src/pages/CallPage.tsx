/**
 * /calls/:id — the live video call (experimental). Pre-join preview → the
 * call (video, whiteboard, chat, screen share, recording) → "call ended"
 * with the upload status and a link to the transcript. Logic lives in
 * hooks/useCall.ts.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { getCall } from '../api/calls';
import { useCall, canShareScreen } from '../hooks/useCall';
import { CallRecorder } from '../services/calls/recorder';
import { Whiteboard } from '../components/calls/Whiteboard';
import { TextBoard } from '../components/calls/TextBoard';
import { AnnotationLayer } from '../components/calls/AnnotationLayer';
import { annotationPipSupported, openAnnotationPip, type AnnotationPip } from '../services/calls/annotationPip';
import { ANNOT_COLORS } from '@shared/calls';
import { formatOffset, initialLinkHealth, pipSize, tileStatus, type CallChatMessage, type VideoSize } from '@shared/calls';
import { CallVideo, useElementSize } from '../components/calls/CallVideo';
import { MediaProblemCard } from '../components/calls/MediaProblemCard';
import { DevicesSheet } from '../components/calls/DevicesSheet';
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

/** 'text' = the shared text board (the main board), 'board' = drawing. */
type Panel = 'none' | 'text' | 'board' | 'chat';

export function CallPage() {
  const { id } = useParams<{ id: string }>();
  const callId = id!;
  const { user } = useAuth();
  const navigate = useNavigate();
  const callQuery = useQuery({ queryKey: ['call', callId], queryFn: () => getCall(callId), staleTime: 30_000 });
  const call = useCall(callId, user!.id);
  const [record, setRecord] = useState(CallRecorder.supported());
  const [panel, setPanel] = useState<Panel>('none');
  const [moreOpen, setMoreOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  // A device problem in the call is shown until dismissed (a new problem shows again).
  const [dismissedProblem, setDismissedProblem] = useState('');
  const [seenChat, setSeenChat] = useState(0);
  const elapsed = useElapsed(call.startedAt, call.phase === 'live');
  // The camera's real shape (a phone's is portrait, a webcam's landscape) sizes the preview and the self-view.
  const [localSize, setLocalSize] = useState<VideoSize | null>(null);
  const [selfSize, setSelfSize] = useState<VideoSize | null>(null);
  const [stageSize, stageRef] = useElementSize<HTMLDivElement>();
  // Drawing on the other person's shared screen / seeing drawings on mine.
  const [remoteSize, setRemoteSize] = useState<VideoSize | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [annotColor, setAnnotColor] = useState<string>(ANNOT_COLORS[0]);
  const [annotPip, setAnnotPip] = useState<AnnotationPip | null>(null);
  const [theyDrawAt, setTheyDrawAt] = useState(0);
  const remoteSharing = !!call.remote?.peer.state.screen;
  useEffect(() => {
    if (!remoteSharing) setAnnotating(false);
  }, [remoteSharing]);
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

  useEffect(() => {
    if (panel === 'chat') setSeenChat(call.chat.length);
  }, [panel, call.chat.length]);

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
  const remoteVideoOn = !!remote?.stream && (remoteState?.cam || remoteState?.screen);
  const unread = Math.max(0, call.chat.length - seenChat);
  const status = remote ? tileStatus(remote.health ?? { ...initialLinkHealth(0), pc: remote.connection === 'new' ? 'new' : remote.connection }, remote.away) : 'live';
  const pip = stageSize && stageSize.width > 200 ? pipSize(selfSize ?? localSize, stageSize) : null;

  return (
    <div className={`call-page call-live panel-${panel}`} data-testid="call-live">
      <div className="call-topbar">
        <span className="call-title">{otherName}</span>
        <span className="call-time">{elapsed}</span>
        {someoneRecording && <span className="call-rec" data-testid="rec-badge">● REC</span>}
        {call.roomStatus === 'reconnecting' && <span className="call-chip warn">Reconnecting…</span>}
      </div>

      <div className="call-main">
        <div className="call-stage" ref={stageRef}>
          {remote ? (
            <>
              {remote.stream && (
                <CallVideo stream={remote.stream} screen={!!remoteState?.screen} className={`call-remote-video${remoteVideoOn ? '' : ' hidden'}`} testId="remote-video" onVideoSize={setRemoteSize} sinkId={call.devicePrefs.speakerId ?? null} />
              )}
              {remoteSharing && remote.stream && (
                <>
                  <AnnotationLayer
                    store={call.annotations}
                    video={remoteSize}
                    interactive={annotating}
                    color={annotColor}
                    onStroke={call.sendAnnotation}
                    onPing={call.sendPing}
                    className="annot-over-remote"
                    testId="annot-remote"
                  />
                  <div className="annot-tools" data-testid="annot-tools">
                    <button type="button" className={`annot-toggle${annotating ? ' on' : ''}`} onClick={() => setAnnotating((v) => !v)} data-testid="annot-toggle">
                      {annotating ? '✓ Done' : `✏️ Draw on ${otherName.split(' ')[0]}’s screen`}
                    </button>
                    {annotating && (
                      <>
                        {ANNOT_COLORS.map((c) => (
                          <button key={c} type="button" className={`annot-swatch${c === annotColor ? ' active' : ''}`} style={{ background: c }} onClick={() => setAnnotColor(c)} aria-label={`Colour ${c}`} />
                        ))}
                        <button type="button" className="annot-clear" onClick={call.clearAnnotations}>Clear</button>
                        <span className="annot-hint">Drag to circle · tap to point</span>
                      </>
                    )}
                  </div>
                </>
              )}
              {!remoteVideoOn && <Initials name={otherName} />}
              {status !== 'live' && (
                // The picture stays (frozen on its last frame) while the link recovers.
                <div className={`call-tile-status ${status}`} data-testid="remote-status" role="status">
                  <span className="call-spinner" aria-hidden="true" /> {status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
                </div>
              )}
              <div className="call-remote-label">
                {remoteState && !remoteState.mic && <span aria-label="muted">🔇 </span>}
                {otherName}
              </div>
            </>
          ) : (
            <div className="call-waiting" data-testid="call-waiting">
              <p>Waiting for {otherName} to join…</p>
              <p className="call-muted">They got a Join link in your chat.</p>
            </div>
          )}
          <div className="call-self" style={pip ? { width: pip.width, height: pip.height } : undefined} data-testid="self-view">
            {call.screenStream ? (
              <>
                <CallVideo stream={call.screenStream} muted screen className="call-self-video" onVideoSize={setSelfSize} />
                <AnnotationLayer store={call.annotations} video={selfSize} testId="annot-self" />
              </>
            ) : call.hasCamera && call.camOn ? (
              <CallVideo stream={call.localStream} muted mirrored={call.facing === 'user'} fit="cover" className="call-self-video" onVideoSize={setSelfSize} />
            ) : (
              <div className="call-self-off">{call.micOn ? 'You' : '🔇 You'}</div>
            )}
          </div>
        </div>

        {panel !== 'none' && (
          <div className="call-panel" data-testid={`call-panel-${panel}`}>
            <div className="call-panel-head">
              <div className="call-panel-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={panel === 'text'} className={panel === 'text' ? 'active' : ''} onClick={() => setPanel('text')} data-testid="board-tab-text">Board</button>
                <button type="button" role="tab" aria-selected={panel === 'board'} className={panel === 'board' ? 'active' : ''} onClick={() => setPanel('board')} data-testid="board-tab-draw">Draw</button>
                <button type="button" role="tab" aria-selected={panel === 'chat'} className={panel === 'chat' ? 'active' : ''} onClick={() => setPanel('chat')}>Chat{unread > 0 && panel !== 'chat' ? ` (${unread})` : ''}</button>
              </div>
              <button type="button" className="call-panel-close" onClick={() => setPanel('none')} aria-label="Close panel">✕</button>
            </div>
            {panel === 'text' ? (
              <TextBoard session={call.textBoard} gloss={{ callId, userId: call.myUserId }} />
            ) : panel === 'board' ? (
              <Whiteboard items={call.board} live={call.liveStrokes} myUserId={call.myUserId} onCommit={call.commitBoard} onLive={call.sendLiveStroke} />
            ) : (
              <ChatPanel messages={call.chat} myUserId={call.myUserId} onSend={call.sendChat} />
            )}
          </div>
        )}
      </div>

      {call.screenStream && (
        <div className={`call-share-bar${Date.now() - theyDrawAt < 6000 ? ' drawing' : ''}`} data-testid="share-bar">
          <span>
            {Date.now() - theyDrawAt < 6000
              ? `✏️ ${call.annotations.lastRemoteName || otherName} is drawing on your screen`
              : '🖥️ You’re sharing your screen.'}
            {!annotationPipSupported() && ' Their drawings show in your preview in the corner.'}
          </span>
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
      {devicesSheet}

      <div className="call-controls" role="toolbar" aria-label="Call controls">
        <button type="button" className={`call-btn${call.micOn && call.hasMic ? '' : ' off'}`} onClick={call.toggleMic} aria-label={!call.hasMic ? 'Turn microphone on' : call.micOn ? 'Mute' : 'Unmute'} title={!call.hasMic ? 'Turn microphone on' : call.micOn ? 'Mute' : 'Unmute'} data-testid="call-mic">{call.micOn && call.hasMic ? '🎙️' : '🔇'}</button>
        <button type="button" className={`call-btn${call.camOn && call.hasCamera ? '' : ' off'}`} onClick={call.toggleCam} aria-label={!call.hasCamera ? 'Turn camera on' : call.camOn ? 'Camera off' : 'Camera on'} title="Camera" data-testid="call-cam">{call.camOn && call.hasCamera ? '📷' : '🚫'}</button>
        <button type="button" className={`call-btn${panel === 'text' || panel === 'board' ? ' active' : ''}`} onClick={() => setPanel(panel === 'text' || panel === 'board' ? 'none' : 'text')} aria-label="Board" title="Board — type together, or draw" data-testid="open-board">📝</button>
        <button type="button" className={`call-btn${panel === 'chat' ? ' active' : ''}`} onClick={() => setPanel(panel === 'chat' ? 'none' : 'chat')} aria-label="Chat" title="Chat">
          💬{unread > 0 && panel !== 'chat' && <span className="call-badge">{unread}</span>}
        </button>
        {canShareScreen() && (
          <button type="button" className={`call-btn${call.screenStream ? ' active' : ''}`} onClick={() => void (call.screenStream ? call.stopScreenShare() : call.startScreenShare())} aria-label={call.screenStream ? 'Stop sharing' : 'Share screen'} title="Share screen">🖥️</button>
        )}
        <div className="call-more">
          <button type="button" className="call-btn" onClick={() => setMoreOpen((v) => !v)} aria-label="More" aria-expanded={moreOpen}>⋯</button>
          {moreOpen && (
            <div className="call-more-menu" role="menu" onClick={() => setMoreOpen(false)}>
              <button type="button" role="menuitem" onClick={() => setDevicesOpen(true)} data-testid="menu-devices">🎛️ Camera, mic &amp; speaker</button>
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
          className="call-btn end"
          onClick={() => {
            if (confirm('End the call for everyone?')) void call.endForEveryone();
          }}
          aria-label="End call"
          title="End call"
          data-testid="end-call"
        >
          📞
        </button>
      </div>
    </div>
  );
}

export default CallPage;
