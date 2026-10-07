import { useState, useEffect, useRef, useCallback } from 'react';
import { track } from '../services/analytics';
import { LocalReader, LocalReaderPage } from '../db/database';
import { QueueCounts } from '../types';
import { QueueCountsHeader } from './QueueCountsHeader';
import { cacheReaderNarration, updateLocalReaderPageImage } from '../services/readerSync';
import type { ReaderFinishHow } from '../services/reader-study';
import { storyNextPage, storyPageGapMs } from '@shared/study/daily-reader';
import { useReaderSpeed } from '../services/readerSpeed';
import { generateReaderPageImage } from '../api/client';
import { useCachedImageUrl } from '../hooks/useCachedImageUrl';
import { ReaderAudioScrubber } from './ReaderAudioScrubber';
import { ReaderWordsText } from './reader/ReaderWords';
import '../pages/ReaderPage.css';
import './StudyReader.css';

/**
 * Illustrations are generated lazily: a page with image_url null but an
 * image_prompt hasn't been illustrated yet. Ask the server to generate it
 * (a cheap no-op returning the key if it already exists in R2), persist the
 * key locally, and render it. Offline → no request, no image.
 */
function usePageImage(readerId: string, page: LocalReaderPage): { imageUrl: string | null; generating: boolean } {
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setGeneratedKey(null);
    setGenerating(false);

    if (page.image_url || !page.image_prompt || !navigator.onLine) return;

    let cancelled = false;
    setGenerating(true);
    generateReaderPageImage(readerId, page.id)
      .then(async result => {
        if (cancelled || !result.image_url) return;
        await updateLocalReaderPageImage(readerId, page.id, result.image_url);
        setGeneratedKey(result.image_url);
      })
      .catch(err => console.error('[StudyReader] Image generation failed:', err))
      .finally(() => {
        if (!cancelled) setGenerating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [readerId, page.id, page.image_url, page.image_prompt]);

  return { imageUrl: useCachedImageUrl(page.image_url || generatedKey), generating };
}

// Rendered with key={page.id} so all reveal/audio state resets atomically on
// every page turn — no effect-based resets, no stale-state flash.
/** "▶ Play whole story" hooks for the page's audio (see ReaderAudioScrubber). */
interface StoryPlaybackHooks {
  autoPlay: boolean;
  onPlaybackEnded: () => void;
  onStopped: () => void;
  onUnavailable: (why: 'missing' | 'failed') => void;
}

function StudyReaderPage({ readerId, page, story }: { readerId: string; page: LocalReaderPage; story: StoryPlaybackHooks }) {
  // Listen-first flow, same as the standalone reader: Chinese starts hidden
  // so you can try the audio before reading, and can be hidden again to
  // re-test yourself without turning the page.
  const [showChinese, setShowChinese] = useState(false);
  const [showPinyin, setShowPinyin] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const { imageUrl, generating } = usePageImage(readerId, page);

  return (
    <div className="reader-page-view">
      {imageUrl ? (
        <div className="reader-image-container">
          <img src={imageUrl} alt="Story illustration" className="reader-image" />
        </div>
      ) : generating ? (
        <div
          className="reader-image-container"
          style={{
            backgroundColor: '#f3f4f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '160px',
            aspectRatio: '4 / 3',
          }}
        >
          <div style={{ textAlign: 'center', color: '#9ca3af' }}>
            <span className="spinner" style={{ width: '28px', height: '28px', marginBottom: '0.5rem' }} />
            <div style={{ fontSize: '0.75rem' }}>Generating illustration...</div>
          </div>
        </div>
      ) : null}

      <div className="reader-text-content">
        <div className="reader-chinese-section">
          {showChinese ? (
            // Whole block is the hit target, same as the pinyin/translation
            // boxes below — tap anywhere on (or around) the hanzi to hide it
            // again. The word chips inside keep their own taps (→ word sheet).
            <div
              className="reader-chinese-revealed tappable"
              onClick={() => setShowChinese(false)}
              role="button"
              tabIndex={0}
              aria-label="Hide Chinese"
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setShowChinese(false);
                }
              }}
            >
              {/* Word chips: tap a word → its sheet (the tap never hides the Chinese). Plain text until they arrive. */}
              <ReaderWordsText readerId={readerId} page={page} />
            </div>
          ) : (
            <div className="reader-chinese-reveal-box" onClick={() => setShowChinese(true)}>
              Tap to reveal Chinese
            </div>
          )}
        </div>

        {/* Scrubbable audio: drag the circle to a spot on the waveform, and
            play/stop always restarts from there — for replaying one stretch
            when listening comprehension needs another pass. */}
        <ReaderAudioScrubber
          page={page}
          autoPlay={story.autoPlay}
          onPlaybackEnded={story.onPlaybackEnded}
          onStopped={story.onStopped}
          onUnavailable={story.onUnavailable}
        />

        <div
          onClick={() => setShowPinyin(!showPinyin)}
          className={`reader-pinyin-box ${showPinyin ? 'visible' : 'hidden'}`}
        >
          {showPinyin ? page.content_pinyin : 'Tap to reveal pinyin'}
        </div>

        <div
          onClick={() => setShowTranslation(!showTranslation)}
          className={`reader-translation-box ${showTranslation ? 'visible' : 'hidden'}`}
        >
          {showTranslation ? page.content_english : 'Tap to reveal translation'}
        </div>
      </div>
    </div>
  );
}

/**
 * A graded reader shown inside a study session (or a homework pass): click
 * through every page, then Finish on the last page — a story is read ONCE and
 * never comes back (shared/study/daily-reader.ts). Listen-first: "▶ Play whole
 * story" plays every page's narration one after another, turning the pages,
 * at the speed chip's speed; listening to the end counts as finishing.
 */
export function StudyReader({
  reader,
  counts,
  isFinishing,
  onFinish,
  onEnd,
}: {
  reader: LocalReader;
  /** The session's queue counts; omitted in the homework pass (a "Homework" label instead). */
  counts?: QueueCounts;
  isFinishing: boolean;
  /** Read: Finish was pressed, or the whole story was listened to the end. */
  onFinish: (timeSpentMs: number, how: ReaderFinishHow) => void;
  onEnd: () => void;
}) {
  const [currentPage, setCurrentPage] = useState(0);
  const [startTime] = useState(Date.now());
  const [scrolled, setScrolled] = useState(false);
  const [storyPlaying, setStoryPlaying] = useState(false);
  const [storyNote, setStoryNote] = useState<string | null>(null);
  const speed = useReaderSpeed();
  const gapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishedRef = useRef(false);

  const page = reader.pages[currentPage];
  const isLastPage = currentPage === reader.pages.length - 1;
  const source = counts ? 'session' : 'homework';

  useEffect(() => {
    track('reader.open', { source, pages: reader.pages.length });
    // Listen-first: every page's narration onto the device in the background,
    // so "Play whole story" never waits (and keeps working when the train goes offline).
    if (navigator.onLine) void cacheReaderNarration(reader).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader.id]);

  useEffect(() => () => {
    if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
  }, []);

  const finish = useCallback((how: ReaderFinishHow) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    track('reader.finish', { how, pages: reader.pages.length });
    onFinish(Date.now() - startTime, how);
  }, [onFinish, reader.pages.length, startTime]);

  const stopStory = useCallback(() => {
    if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
    gapTimerRef.current = null;
    setStoryPlaying(false);
  }, []);

  const startStory = () => {
    setStoryNote(null);
    track('reader.story_play', { from_page: currentPage + 1, pages: reader.pages.length, speed, offline: !navigator.onLine });
    setStoryPlaying(true);
  };

  const story: StoryPlaybackHooks = {
    autoPlay: storyPlaying,
    onPlaybackEnded: () => {
      if (!storyPlaying) return;
      const next = storyNextPage(currentPage, reader.pages.length);
      if (next === null) {
        // Listened to the end: that is reading it.
        setStoryPlaying(false);
        finish('listened');
        return;
      }
      gapTimerRef.current = setTimeout(() => {
        gapTimerRef.current = null;
        setCurrentPage(next);
      }, storyPageGapMs(speed));
    },
    onStopped: () => {
      if (!storyPlaying) return;
      track('reader.story_stop', { page: currentPage + 1, pages: reader.pages.length });
      stopStory();
    },
    onUnavailable: why => {
      if (!storyPlaying) return;
      stopStory();
      setStoryNote(why === 'missing'
        ? "This page's audio isn't on the device yet — it downloads when you're online."
        : "This page's audio wouldn't play — tap 🔊 to try again.");
    },
  };

  const turnTo = (index: number) => {
    // A manual turn while the story plays: it carries on from the new page.
    if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
    gapTimerRef.current = null;
    setCurrentPage(index);
  };

  const toggleStory = () => {
    if (!storyPlaying) {
      startStory();
      return;
    }
    track('reader.story_stop', { page: currentPage + 1, pages: reader.pages.length });
    stopStory();
  };

  return (
    <div className="study-fullscreen">
      <div className="study-topbar">
        {counts ? <QueueCountsHeader counts={counts} activeQueue={reader.queue} /> : <span className="study-topbar-label">Homework</span>}
        <div className="study-topbar-controls">
          <button className="study-close-btn" onClick={onEnd} aria-label="End session">
            ✕
          </button>
        </div>
      </div>

      {/* The blue progress bar is held at the top, under the top bar: the page
          (illustration, Chinese, audio, pinyin, translation) scrolls beneath it. */}
      <div
        className={`study-reader-progress${scrolled ? ' study-reader-progress--scrolled' : ''}`}
        data-testid="study-reader-progress"
      >
        <div className="reader-progress-bar">
          <div
            className="reader-progress-fill"
            style={{ width: `${((currentPage + 1) / reader.pages.length) * 100}%` }}
          />
        </div>
      </div>

      <div
        className="study-card-content study-reader-content"
        onScroll={e => setScrolled(e.currentTarget.scrollTop > 0)}
      >
        <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#8b5cf6', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            📖 Graded Reader
          </div>
          <div className="hanzi" style={{ fontSize: '1.25rem', fontWeight: 600 }}>{reader.title_chinese}</div>
          <div className="text-light" style={{ fontSize: '0.8125rem' }} data-testid="study-reader-page-label">
            {reader.title_english} · Page {currentPage + 1} of {reader.pages.length}
          </div>
          <button
            type="button"
            className={`study-reader-story-btn${storyPlaying ? ' playing' : ''}`}
            onClick={toggleStory}
            data-testid="reader-play-story"
            aria-pressed={storyPlaying}
          >
            {storyPlaying ? '■ Stop the story' : currentPage === 0 ? '▶ Play whole story' : '▶ Play the rest'}
          </button>
          {storyNote && <div className="study-reader-story-note" role="status">{storyNote}</div>}
        </div>

        <StudyReaderPage key={page.id} readerId={reader.id} page={page} story={story} />
      </div>

      {/* Fixed footer: page navigation, or Finish once the last page is reached */}
      {isLastPage ? (
        <div className="study-reader-nav study-reader-finish-row">
          {reader.pages.length > 1 && (
            <button className="btn btn-secondary" onClick={() => turnTo(currentPage - 1)}>
              ‹ Back
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => { stopStory(); finish('finish'); }}
            disabled={isFinishing}
            data-testid="reader-finish"
          >
            Finish ✓
          </button>
        </div>
      ) : (
        <div className="study-reader-nav">
          <button
            className="btn btn-secondary"
            onClick={() => turnTo(currentPage - 1)}
            disabled={currentPage === 0}
          >
            Previous
          </button>
          <button className="btn btn-primary" onClick={() => turnTo(currentPage + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
