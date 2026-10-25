import { useEffect, useState, type CSSProperties } from 'react';
import { API_BASE, getAuthHeaders } from '../api/client';

/**
 * A feature request's screenshot. The API serves it only to the request's owner or an admin
 * (bearer auth — an <img src> can't send it), so it is fetched with the session and shown
 * from a blob: URL. `link` opens the same blob in a new tab. In-app feedback screenshots
 * (`/api/audio/feedback/…`, docs/FEEDBACK.md) are private media: the same Bearer fetch works.
 */
export function useAuthedObjectUrl(path: string | null | undefined): { url: string | null; failed: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!path) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    setFailed(false);
    fetch(`${API_BASE}${path}`, { headers: getAuthHeaders(), credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [path]);
  return { url, failed };
}

export function AuthedScreenshot({ path, style, linkOnly = false, thumb = false }: { path: string; style?: CSSProperties; linkOnly?: boolean; thumb?: boolean }) {
  const { url, failed } = useAuthedObjectUrl(path);
  // A small preview inside a list row (the row itself opens the detail).
  if (thumb) {
    if (failed) return null;
    return url ? <img src={url} alt="Screenshot" className="feedback-thumb" /> : <span className="feedback-thumb feedback-thumb-loading" aria-hidden="true" />;
  }
  if (failed) return <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>screenshot unavailable</span>;
  if (!url) return linkOnly ? <span>screenshot…</span> : null;
  if (linkOnly) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        screenshot
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <img src={url} alt="Screenshot" style={style} />
    </a>
  );
}
