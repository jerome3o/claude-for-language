import { useState, useEffect, useRef, useCallback } from 'react';
import { LocalReader, LocalReaderPage } from '../db/database';
import { Rating, IntervalPreview, QueueCounts } from '../types';
import { QueueCountsHeader } from './QueueCountsHeader';
import { RatingButtons } from './RatingButtons';
import { getAudioWithCache } from '../services/audioCache';
import { getReaderPageTTS } from '../services/readerSync';
import '../pages/ReaderPage.css';

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

function StudyReaderPage({ page }: { page: LocalReaderPage }) {
  const [showPinyin, setShowPinyin] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playIdRef = useRef(0);

  const imageUrl = useCachedImageUrl(page.image_url);

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
      {imageUrl && (
        <div className="reader-image-container">
          <img src={imageUrl} alt="Story illustration" className="reader-image" />
        </div>
      )}

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

      <div className="study-card-content" style={{ overflowY: 'auto' }}>
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

        <StudyReaderPage page={page} />

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between', marginTop: '1rem', paddingBottom: '1rem' }}>
          <button
            className="btn btn-secondary"
            onClick={() => setCurrentPage(p => p - 1)}
            disabled={currentPage === 0}
            style={{ minWidth: '44px', minHeight: '44px' }}
          >
            Previous
          </button>
          {!isLastPage && (
            <button
              className="btn btn-primary"
              onClick={() => setCurrentPage(p => p + 1)}
              style={{ minWidth: '44px', minHeight: '44px' }}
            >
              Next
            </button>
          )}
        </div>
      </div>

      {/* Rating appears once the reader has been read to the last page */}
      {isLastPage && (
        <div className="study-rating-sticky">
          <div style={{ textAlign: 'center', fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>
            How well did you understand this story?
          </div>
          <RatingButtons
            intervalPreviews={intervalPreviews}
            onRate={handleRate}
            disabled={isRating}
          />
        </div>
      )}
    </div>
  );
}
