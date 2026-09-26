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
import { formatOffset, type CallChatMessage } from '@shared/calls';
import './CallPage.css';

function VideoEl({ stream, muted, mirrored, fit, className, testId }: { stream: MediaStream | null; muted?: boolean; mirrored?: boolean; fit: 'cover' | 'contain'; className?: string; testId?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) void el.play().catch(() => {});
  }, [stream]);
  return (
    <video
      ref={ref}
      className={className}
      data-testid={testId}
      autoPlay
      playsInline
      muted={muted}
      style={{ objectFit: fit, transform: mirrored ? 'scaleX(-1)' : undefined }}
    />
  );
}

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

type Panel = 'none' | 'board' | 'chat';

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
  const [seenChat, setSeenChat] = useState(0);
  const elapsed = useElapsed(call.startedAt, call.phase === 'live');

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
        <div className="call-prejoin-preview">
          {call.localStream && call.hasCamera && call.camOn ? (
            <VideoEl stream={call.localStream} muted mirrored fit="cover" className="call-prejoin-video" testId="local-preview" />
          ) : (
            <Initials name={user!.name || user!.email || 'You'} />
          )}
          <div className="call-prejoin-toggles">
            <button type="button" className={`call-btn${call.micOn ? '' : ' off'}`} onClick={call.toggleMic} aria-label={call.micOn ? 'Mute microphone' : 'Unmute microphone'}>{call.micOn ? '🎙️' : '🔇'}</button>
            {call.hasCamera && (
              <button type="button" className={`call-btn${call.camOn ? '' : ' off'}`} onClick={call.toggleCam} aria-label={call.camOn ? 'Turn camera off' : 'Turn camera on'}>{call.camOn ? '📷' : '🚫'}</button>
            )}
          </div>
        </div>
        <div className="call-prejoin-body">
          <h1>{detail.call.title || `Lesson with ${otherName}`}</h1>
          {call.mediaError && <p className="call-warning">{call.mediaError}</p>}
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
            disabled={call.phase === 'joining' || !call.localStream}
            data-testid="join-call"
          >
            {call.phase === 'joining' ? 'Joining…' : 'Join call'}
          </button>
          {!call.localStream && !call.mediaError && <p className="call-muted">Allow the camera and microphone to join.</p>}
        </div>
      </div>
    );
  }

  // ------------------------------------------------ live
  const remote = call.remote;
  const remoteState = remote?.peer.state;
  const someoneRecording = call.recording || !!remoteState?.recording;
  const remoteVideoOn = !!remote?.stream && (remoteState?.cam || remoteState?.screen);
  const unread = Math.max(0, call.chat.length - seenChat);
  const connecting = remote && remote.connection !== 'connected';

  return (
    <div className={`call-page call-live panel-${panel}`} data-testid="call-live">
      <div className="call-topbar">
        <span className="call-title">{otherName}</span>
        <span className="call-time">{elapsed}</span>
        {someoneRecording && <span className="call-rec" data-testid="rec-badge">● REC</span>}
        {call.roomStatus === 'reconnecting' && <span className="call-chip warn">Reconnecting…</span>}
      </div>

      <div className="call-main">
        <div className="call-stage">
          {remote ? (
            <>
              {remote.stream && (
                <VideoEl stream={remote.stream} fit={remoteState?.screen ? 'contain' : 'cover'} className={`call-remote-video${remoteVideoOn ? '' : ' hidden'}`} testId="remote-video" />
              )}
              {!remoteVideoOn && <Initials name={otherName} />}
              <div className="call-remote-label">
                {remoteState && !remoteState.mic && <span aria-label="muted">🔇 </span>}
                {otherName}{connecting ? ' · connecting…' : ''}
              </div>
            </>
          ) : (
            <div className="call-waiting" data-testid="call-waiting">
              <p>Waiting for {otherName} to join…</p>
              <p className="call-muted">They got a Join link in your chat.</p>
            </div>
          )}
          <div className="call-self">
            {call.screenStream ? (
              <VideoEl stream={call.screenStream} muted fit="contain" className="call-self-video" />
            ) : call.hasCamera && call.camOn ? (
              <VideoEl stream={call.localStream} muted mirrored={call.facing === 'user'} fit="cover" className="call-self-video" />
            ) : (
              <div className="call-self-off">{call.micOn ? 'You' : '🔇 You'}</div>
            )}
          </div>
        </div>

        {panel !== 'none' && (
          <div className="call-panel" data-testid={`call-panel-${panel}`}>
            <div className="call-panel-head">
              <div className="call-panel-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={panel === 'board'} className={panel === 'board' ? 'active' : ''} onClick={() => setPanel('board')}>Whiteboard</button>
                <button type="button" role="tab" aria-selected={panel === 'chat'} className={panel === 'chat' ? 'active' : ''} onClick={() => setPanel('chat')}>Chat{unread > 0 && panel !== 'chat' ? ` (${unread})` : ''}</button>
              </div>
              <button type="button" className="call-panel-close" onClick={() => setPanel('none')} aria-label="Close panel">✕</button>
            </div>
            {panel === 'board' ? (
              <Whiteboard items={call.board} live={call.liveStrokes} myUserId={call.myUserId} onCommit={call.commitBoard} onLive={call.sendLiveStroke} />
            ) : (
              <ChatPanel messages={call.chat} myUserId={call.myUserId} onSend={call.sendChat} />
            )}
          </div>
        )}
      </div>

      <div className="call-controls" role="toolbar" aria-label="Call controls">
        <button type="button" className={`call-btn${call.micOn ? '' : ' off'}`} onClick={call.toggleMic} aria-label={call.micOn ? 'Mute' : 'Unmute'} title={call.micOn ? 'Mute' : 'Unmute'}>{call.micOn ? '🎙️' : '🔇'}</button>
        {call.hasCamera && (
          <button type="button" className={`call-btn${call.camOn ? '' : ' off'}`} onClick={call.toggleCam} aria-label={call.camOn ? 'Camera off' : 'Camera on'} title="Camera">{call.camOn ? '📷' : '🚫'}</button>
        )}
        <button type="button" className={`call-btn${panel === 'board' ? ' active' : ''}`} onClick={() => setPanel(panel === 'board' ? 'none' : 'board')} aria-label="Whiteboard" title="Whiteboard" data-testid="open-board">🖍️</button>
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
