import { useEffect, useState } from 'react';
import { useChatMedia } from '../../services/chatMedia';

/** Human file size: 840 KB, 3.2 MB. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return '📕';
  if (['doc', 'docx', 'odt', 'rtf', 'txt', 'md'].includes(ext)) return '📝';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['ppt', 'pptx'].includes(ext)) return '📽️';
  if (['zip', 'apkg', 'epub'].includes(ext)) return '🗜️';
  if (['mp3', 'm4a'].includes(ext)) return '🎵';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return '🖼️';
  return '📄';
}

/**
 * A document in the chat (round 2 PR 3): icon, name, size and type; a tap
 * downloads it (with the session's auth — the R2 key never reaches the client)
 * and opens a PDF in a new tab, or saves anything else under its name.
 */
export function FileBubble({ messageId, mediaUrl, name, bytes, mime, localBlob }: {
  messageId: string;
  mediaUrl: string | null | undefined;
  name: string;
  bytes: number;
  mime: string;
  localBlob?: Blob | null;
}) {
  const [want, setWant] = useState(false);
  const { url, error, retry } = useChatMedia(messageId, mediaUrl, localBlob, want);

  useEffect(() => {
    if (!want || !url) return;
    setWant(false);
    if (mime === 'application/pdf') {
      window.open(url, '_blank', 'noopener');
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }, [want, url, mime, name]);

  const ext = name.split('.').pop()?.toUpperCase() ?? '';
  return (
    <button
      type="button"
      className="chat-file"
      data-testid="chat-file"
      onClick={(e) => {
        e.stopPropagation();
        if (error) retry();
        setWant(true);
      }}
      aria-label={`Open ${name}`}
    >
      <span className="chat-file-icon" aria-hidden="true">
        {want && !url ? <span className="chat-spinner" /> : fileIcon(name)}
      </span>
      <span className="chat-file-text">
        <span className="chat-file-name">{name}</span>
        <span className="chat-file-meta">
          {formatBytes(bytes)}
          {ext ? ` · ${ext}` : ''}
          {error ? ' · couldn’t download, tap to retry' : ''}
        </span>
      </span>
    </button>
  );
}
