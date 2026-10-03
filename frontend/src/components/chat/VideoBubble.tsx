import { useChatMedia } from '../../services/chatMedia';
import { formatDuration } from '../../services/chatThread';

/** A short video clip (round 2 PR 3): sized from the clip's shape, the browser's own player. */
export function VideoBubble({ messageId, mediaUrl, width, height, durationMs, localBlob }: {
  messageId: string;
  mediaUrl: string | null | undefined;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  localBlob?: Blob | null;
}) {
  const { url, error, retry } = useChatMedia(messageId, mediaUrl, localBlob);
  const ratio = width && height ? width / height : 16 / 9;
  return (
    <div className="chat-video" data-testid="chat-video" style={{ aspectRatio: String(Math.max(0.5, Math.min(2, ratio))) }} onClick={(e) => e.stopPropagation()}>
      {url ? (
        <video src={url} controls playsInline preload="metadata" />
      ) : (
        <button type="button" className="chat-video-placeholder" onClick={retry} aria-label={error ? 'Retry loading the video' : 'Loading the video'}>
          {error ? '↻' : <span className="chat-spinner" aria-hidden="true" />}
          {durationMs ? <span className="chat-video-len">🎬 {formatDuration(durationMs)}</span> : null}
        </button>
      )}
    </div>
  );
}
