import { useState, useEffect, useRef, useCallback } from 'react';
import { LocalReader, LocalReaderPage } from '../db/database';
import { Rating, IntervalPreview, QueueCounts } from '../types';
import { QueueCountsHeader } from './QueueCountsHeader';
import { RatingButtons } from './RatingButtons';
import { getAudioWithCache } from '../services/audioCache';
import { getReaderPageTTS, updateLocalReaderPageImage } from '../services/readerSync';
import { generateReaderPageImage } from '../api/client';
import '../pages/ReaderPage.css';
import './StudyReader.css';

/**
 * Resolve a media key (R2 object served from /api/audio/<key>) to an object
 * URL, cache-first so reader images work offline.
 */
function useCachedImageUrl(key: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    if (key) {
      getAudioWithCache(key).then(blob => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      });
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key]);

  return url;
}

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

function StudyReaderPage({ readerId, page }: { readerId: string; page: LocalReaderPage }) {
  const [showPinyin, setShowPinyin] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playIdRef = useRef(0);

  const { imageUrl, generating } = usePageImage(readerId, page);

  // Reset reveals when the page changes
  useEffect(() => {
    setShowPinyin(false);
    setShowTranslation(false);
  }, [page.id]);

  const stopAudio = useCallback(() => {
    playIdRef.current++;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const playAudio = useCallback(async () => {
    if (isPlaying) return;
    const playId = ++playIdRef.current;
    setIsPlaying(true);

    // Cache-first TTS; offline with nothing cached → fail gracefully
    const blob = await getReaderPageTTS(page);
    if (playIdRef.current !== playId) return;
    if (!blob) {
      setIsPlaying(false);
      return;
    }

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    const finish = () => {
      URL.revokeObjectURL(url);
      if (playIdRef.current === playId) setIsPlaying(false);
    };
    audio.onended = finish;
    audio.onerror = finish;
    void audio.play().catch(finish);
  }, [page, isPlaying]);

  // Stop audio when the page changes or on unmount
  useEffect(() => stopAudio, [page.id, stopAudio]);

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
          <div className="reader-chinese-text">{page.content_chinese}</div>
          <button
            className="reader-audio-btn"
            onClick={isPlaying ? stopAudio : playAudio}
            aria-label={isPlaying ? 'Stop audio' : 'Play audio'}
          >
            {isPlaying ? '⏹' : '🔊'}
          </button>
        </div>

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
 * A graded reader shown inside a study session: click through every page,
 * then rate it on the last page — same FSRS cadence as cards.
 */
export function StudyReader({
  reader,
  intervalPreviews,
  counts,
  isRating,
  onRate,
  onEnd,
}: {
  reader: LocalReader;
  intervalPreviews: Record<Rating, IntervalPreview>;
  counts: QueueCounts;
  isRating: boolean;
  onRate: (rating: Rating, timeSpentMs: number) => void;
  onEnd: () => void;
}) {
  const [currentPage, setCurrentPage] = useState(0);
  const [startTime] = useState(Date.now());

  const page = reader.pages[currentPage];
  const isLastPage = currentPage === reader.pages.length - 1;

  const handleRate = (rating: Rating) => {
    onRate(rating, Date.now() - startTime);
  };

  return (
    <div className="study-fullscreen">
      <div className="study-topbar">
        <QueueCountsHeader counts={counts} activeQueue={reader.queue} />
        <div className="study-topbar-controls">
          <button className="study-close-btn" onClick={onEnd} aria-label="End session">
            ✕
          </button>
        </div>
      </div>

      <div className="study-card-content study-reader-content">
        <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#8b5cf6', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            📖 Graded Reader
          </div>
          <div className="hanzi" style={{ fontSize: '1.25rem', fontWeight: 600 }}>{reader.title_chinese}</div>
          <div className="text-light" style={{ fontSize: '0.8125rem' }}>
            {reader.title_english} · Page {currentPage + 1} of {reader.pages.length}
          </div>
        </div>

        <div className="reader-progress-bar" style={{ marginBottom: '0.75rem' }}>
          <div
            className="reader-progress-fill"
            style={{ width: `${((currentPage + 1) / reader.pages.length) * 100}%` }}
          />
        </div>

        <StudyReaderPage readerId={reader.id} page={page} />
      </div>

      {/* Fixed footer: page navigation, or rating once the last page is reached */}
      {isLastPage ? (
        <div className="study-rating-sticky">
          <div className="study-reader-rating-header">
            {reader.pages.length > 1 && (
              <button
                className="btn btn-secondary study-reader-back-btn"
                onClick={() => setCurrentPage(p => p - 1)}
              >
                ‹ Back
              </button>
            )}
            <div className="study-reader-rating-prompt">
              How well did you understand this story?
            </div>
          </div>
          <RatingButtons
            intervalPreviews={intervalPreviews}
            onRate={handleRate}
            disabled={isRating}
          />
        </div>
      ) : (
        <div className="study-reader-nav">
          <button
            className="btn btn-secondary"
            onClick={() => setCurrentPage(p => p - 1)}
            disabled={currentPage === 0}
          >
            Previous
          </button>
          <button className="btn btn-primary" onClick={() => setCurrentPage(p => p + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
