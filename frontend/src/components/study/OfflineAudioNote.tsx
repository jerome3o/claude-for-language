import { useEffect, useState } from 'react';
import { isAudioCached } from '../../services/audioCache';

/**
 * Whether a clip is in the IndexedDB audio cache. `null` while unknown.
 * Re-checked whenever the URL changes (a regenerated clip is a new key).
 */
export function useAudioCached(audioUrl: string | null | undefined): boolean | null {
  const [cached, setCached] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    setCached(null);
    if (!audioUrl) {
      setCached(false);
      return;
    }
    isAudioCached(audioUrl)
      .then((ok) => {
        if (!cancelled) setCached(ok);
      })
      .catch(() => {
        if (!cancelled) setCached(false);
      });
    return () => {
      cancelled = true;
    };
  }, [audioUrl]);
  return cached;
}

/**
 * One quiet line, no buttons: when study is offline and this word's clip was
 * never downloaded, say so (the device's own voice reads it instead). Online
 * the clip just streams as before, silently.
 */
export function OfflineAudioNote({
  audioUrl,
  effectiveOffline,
}: {
  audioUrl: string | null | undefined;
  effectiveOffline: boolean;
}) {
  const cached = useAudioCached(audioUrl);
  if (!effectiveOffline || cached !== false) return null;
  return (
    <p className="study-offline-audio-note" data-testid="offline-audio-note">
      Audio not downloaded for this word — using the device voice.
    </p>
  );
}
