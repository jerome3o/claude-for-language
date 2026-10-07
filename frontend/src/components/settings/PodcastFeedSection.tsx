/**
 * Settings → Audio lessons → "Podcast feed" (docs/AUDIO_LESSONS.md "Podcast feed"): a
 * private RSS link of every ready audio lesson for any podcast app (AntennaPod, Pocket
 * Casts, Apple Podcasts). Copy link · Open in podcast app (podcast:// and pcast://) ·
 * Reset link (the old one stops working at once) · Turn off. The link is the only
 * credential, so it is shown masked; Copy copies the whole thing.
 */
import { useCallback, useEffect, useState } from 'react';
import type { PodcastFeedInfo } from '@shared/audio-lesson';
import { deletePodcastFeed, getPodcastFeed, resetPodcastFeed } from '../../api/audioLessons';
import { useNetwork } from '../../contexts/NetworkContext';
import { track } from '../../services/analytics';

/** "…/api/podcast/Ab3d…x9Yz/feed.xml": enough to recognise it, not enough to use it. */
export function maskFeedUrl(url: string): string {
  return url.replace(/\/podcast\/([A-Za-z0-9_-]{4})[A-Za-z0-9_-]+([A-Za-z0-9_-]{4})\//, '/podcast/$1…$2/');
}

function whenLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function PodcastFeedSection() {
  const { isOnline } = useNetwork();
  const [feed, setFeed] = useState<PodcastFeedInfo | null>(null);
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { feed } = await getPodcastFeed();
      setFeed(feed);
      setOff(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your podcast link');
    }
  }, []);

  useEffect(() => {
    if (isOnline && !feed && !off) void load();
  }, [isOnline, feed, off, load]);

  // Linked from the Audio lessons page as /settings#podcast-feed.
  useEffect(() => {
    if (window.location.hash === '#podcast-feed') document.getElementById('podcast-feed')?.scrollIntoView({ block: 'start' });
  }, [feed]);

  const copy = async () => {
    if (!feed?.url) return;
    try {
      await navigator.clipboard.writeText(feed.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      track('audio_lesson.podcast_feed', { action: 'copy' });
    } catch {
      setError('Copying is blocked here — long-press the link field instead.');
    }
  };

  const reset = async () => {
    if (!confirm('Make a new podcast link? The old link stops working in every podcast app that uses it — you will need to subscribe again with the new one.')) return;
    setBusy(true);
    setError(null);
    try {
      const { feed } = await resetPodcastFeed();
      setFeed(feed);
      setOff(false);
      track('audio_lesson.podcast_feed', { action: 'reset' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (!confirm('Turn the podcast feed off? Podcast apps stop getting new lessons and the link stops working.')) return;
    setBusy(true);
    setError(null);
    try {
      await deletePodcastFeed();
      setFeed(null);
      setOff(true);
      track('audio_lesson.podcast_feed', { action: 'off' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn it off');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-section podcast-feed" id="podcast-feed" data-testid="podcast-feed">
      <h2>🎧 Audio lessons · Podcast feed</h2>
      <p className="settings-section-desc">
        Listen to your audio lessons in any podcast app — AntennaPod, Pocket Casts, Apple Podcasts. Every lesson that is
        ready arrives as an episode, with chapters, downloaded for the train. The link is private: anyone who has it can
        listen to your lessons, so don&apos;t share it.
      </p>

      {!isOnline && !feed && <p className="podcast-feed-note">Connect to the internet to see your podcast link.</p>}

      {off && (
        <div className="podcast-feed-actions">
          <p className="podcast-feed-note">The podcast feed is off.</p>
          <button className="btn btn-primary" onClick={() => { setOff(false); void load(); }} disabled={!isOnline || busy}>
            Turn it on with a new link
          </button>
        </div>
      )}

      {feed && !feed.url && (
        <div className="podcast-feed-actions">
          <p className="podcast-feed-note">This link can&apos;t be shown any more. Make a new one (the old one keeps working until you do).</p>
          <button className="btn btn-primary" onClick={reset} disabled={!isOnline || busy}>Make a new link</button>
        </div>
      )}

      {feed?.url && (
        <>
          <div className="podcast-feed-url" data-testid="podcast-feed-url" title="Your private feed link (Copy copies all of it)">
            {maskFeedUrl(feed.url)}
          </div>
          <div className="podcast-feed-actions">
            <button className="btn btn-primary" onClick={copy} data-testid="podcast-feed-copy">
              {copied ? '✓ Copied' : '📋 Copy link'}
            </button>
            {feed.podcast_url && (
              <a className="btn btn-secondary" href={feed.podcast_url} onClick={() => track('audio_lesson.podcast_feed', { action: 'open' })}>
                Open in podcast app
              </a>
            )}
            {feed.apple_url && (
              <a className="btn btn-secondary" href={feed.apple_url} onClick={() => track('audio_lesson.podcast_feed', { action: 'open_apple' })}>
                Apple Podcasts
              </a>
            )}
          </div>
          <p className="podcast-feed-note" data-testid="podcast-feed-status">
            {feed.last_fetched_at
              ? `Last checked by a podcast app: ${whenLabel(feed.last_fetched_at)}`
              : 'No podcast app has used this link yet. Copy it and choose "Add podcast by URL" (AntennaPod, Pocket Casts) or "Follow a show by URL" (Apple Podcasts).'}
          </p>
          <div className="podcast-feed-actions podcast-feed-quiet">
            <button className="settings-link-btn" onClick={reset} disabled={!isOnline || busy} data-testid="podcast-feed-reset">
              Reset link
            </button>
            <button className="settings-link-btn" onClick={turnOff} disabled={!isOnline || busy}>
              Turn off
            </button>
          </div>
        </>
      )}

      {error && <p className="podcast-feed-error" role="alert">{error}</p>}
    </div>
  );
}
