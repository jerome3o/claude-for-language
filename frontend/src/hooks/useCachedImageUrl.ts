import { useState, useEffect } from 'react';
import { getAudioWithCache, getCachedAudio } from '../services/audioCache';
import { getReaderImageUrl } from '../api/client';

/**
 * Resolve an R2 image key (served from /api/audio/<key>, same proxy as audio)
 * to a displayable URL. Cached blob → object URL (works offline). Not cached →
 * the direct API URL, so display never depends on a JS fetch succeeding
 * (flaky connections kill fetch() where a plain <img> would recover), while
 * the offline cache is filled in the background for next time.
 */
export function useCachedImageUrl(key: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    if (key) {
      getCachedAudio(key).then(blob => {
        if (cancelled) return;
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        } else if (navigator.onLine) {
          setUrl(getReaderImageUrl(key));
          getAudioWithCache(key).catch(() => {});
        }
      });
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key]);

  return url;
}
