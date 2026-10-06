import { useState, useEffect } from 'react';
import { track } from '../services/analytics';
import { LocalReader, LocalReaderPage } from '../db/database';
import { Rating, IntervalPreview, QueueCounts } from '../types';
import { QueueCountsHeader } from './QueueCountsHeader';
import { RatingButtons } from './RatingButtons';
import { updateLocalReaderPageImage } from '../services/readerSync';
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
function StudyReaderPage({ readerId, page }: { readerId: string; page: LocalReaderPage }) {
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
        <ReaderAudioScrubber page={page} />

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
 * then rate it on the last page: the rating sets when it comes back
 * ("revisit later", shared/study/revisit.ts), or Done for good.
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
  /** The session's queue counts; omitted in the homework pass (a "Homework" label instead). */
  counts?: QueueCounts;
  isRating: boolean;
  /** `retire` = "Done for good": read, and never scheduled again. */
  onRate: (rating: Rating, timeSpentMs: number, retire?: boolean) => void;
  onEnd: () => void;
}) {
  const [currentPage, setCurrentPage] = useState(0);
  const [startTime] = useState(Date.now());
  const [scrolled, setScrolled] = useState(false);

  const page = reader.pages[currentPage];
  const isLastPage = currentPage === reader.pages.length - 1;

  useEffect(() => {
    track('reader.open', { source: counts ? 'session' : 'homework', pages: reader.pages.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader.id]);

  const handleRate = (rating: Rating) => {
    track('reader.finish', { rating: (['again', 'hard', 'good', 'easy'] as const)[rating], pages: reader.pages.length });
    onRate(rating, Date.now() - startTime);
  };

  const handleDoneForGood = () => {
    track('reader.finish', { rating: 'good', pages: reader.pages.length });
    // Read (counts as Good for the record) and retired.
    onRate(2, Date.now() - startTime, true);
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
          <div className="text-light" style={{ fontSize: '0.8125rem' }}>
            {reader.title_english} · Page {currentPage + 1} of {reader.pages.length}
          </div>
        </div>

        <StudyReaderPage key={page.id} readerId={reader.id} page={page} />
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
            onDoneForGood={handleDoneForGood}
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
