import { useState, useEffect, useCallback, useRef } from 'react';
import { track } from '../services/analytics';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useNativeOutputHold } from '../hooks/useNativeOutputHold';
import { useQuery } from '@tanstack/react-query';
import {
  getGradedReader,
  getReaderImageUrl,
  generateReaderPageImage,
  generatePracticeTTS,
} from '../api/client';
import { READER_TTS_SPEED } from '../services/readerSync';
import { base64ToBlob } from '../services/ttsCache';
import { createAudioPlayer } from '../utils/audioPlayback';
import { Loading } from '../components/Loading';
import { AnkiExportButton } from '../components/export/AnkiExportModal';
import { ReaderWordsText } from '../components/reader/ReaderWords';
import { ReaderSpeedChip } from '../components/reader/ReaderSpeedChip';
import { useReaderSpeed } from '../services/readerSpeed';
import { markDailyActivity } from '../api/client';
import {
  ReaderPage as ReaderPageType,
  DifficultyLevel,
} from '../types';
import './ReaderPage.css';

const DIFFICULTY_COLORS: Record<DifficultyLevel, { bg: string; text: string; label: string }> = {
  beginner: { bg: '#dcfce7', text: '#166534', label: 'Beginner' },
  elementary: { bg: '#dbeafe', text: '#1e40af', label: 'Elementary' },
  intermediate: { bg: '#fef3c7', text: '#92400e', label: 'Intermediate' },
  advanced: { bg: '#fce7f3', text: '#9d174d', label: 'Advanced' },
};

function PageView({
  page,
  readerId,
  showPinyin,
  showTranslation,
  onTogglePinyin,
  onToggleTranslation,
}: {
  page: ReaderPageType;
  readerId: string;
  showPinyin: boolean;
  showTranslation: boolean;
  onTogglePinyin: () => void;
  onToggleTranslation: () => void;
}) {
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showChinese, setShowChinese] = useState(false);
  const pagePlayerRef = useRef(createAudioPlayer());
  const ttsCache = useRef<Map<string, Blob>>(new Map());
  // The speed chip: playback rate with the pitch kept, live on the clip playing
  const speed = useReaderSpeed();
  useEffect(() => {
    pagePlayerRef.current.setRate(speed);
  }, [speed]);

  // Use the page's image_url or the generated one
  const imageKey = page.image_url || generatedImageUrl;
  const imageUrl = imageKey ? getReaderImageUrl(imageKey) : null;

  // Trigger on-demand image generation if no image exists
  useEffect(() => {
    if (!page.image_url && !generatedImageUrl && !imageLoading && page.image_prompt) {
      setImageLoading(true);
      generateReaderPageImage(readerId, page.id)
        .then((result) => {
          setGeneratedImageUrl(result.image_url);
          setImageLoading(false);
        })
        .catch((err) => {
          console.error('Failed to generate image:', err);
          setImageLoading(false);
          setImageError(true);
        });
    }
  }, [page.id, page.image_url, page.image_prompt, readerId, generatedImageUrl, imageLoading]);

  // Reset state when page changes
  useEffect(() => {
    setGeneratedImageUrl(null);
    setImageLoading(false);
    setImageError(false);
    setShowChinese(false);
  }, [page.id]);

  // Play Chinese audio via MiniMax TTS API, with in-memory caching to avoid regenerating
  const playAudio = useCallback(() => {
    if (isPlaying) return;

    const playId = pagePlayerRef.current.claim();
    setIsPlaying(true);

    const playBlob = (blob: Blob) => {
      if (!pagePlayerRef.current.isCurrent(playId)) return;
      pagePlayerRef.current.play(blob, {
        onEnded: () => setIsPlaying(false),
        onError: () => setIsPlaying(false),
      });
    };

    const cached = ttsCache.current.get(page.content_chinese);
    if (cached) {
      playBlob(cached);
      return;
    }

    generatePracticeTTS(page.content_chinese, READER_TTS_SPEED)
      .then((r) => {
        if (!pagePlayerRef.current.isCurrent(playId)) return;
        const blob = base64ToBlob(r.audio_base64, r.content_type);
        ttsCache.current.set(page.content_chinese, blob);
        playBlob(blob);
      })
      .catch(() => pagePlayerRef.current.isCurrent(playId) && setIsPlaying(false));
  }, [page.content_chinese, isPlaying]);

  const stopAudio = useCallback(() => {
    pagePlayerRef.current.stop();
    setIsPlaying(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    const player = pagePlayerRef.current;
    return () => player.dispose();
  }, []);

  return (
    <div className="reader-page-view">
      {/* Image */}
      {imageUrl && !imageError ? (
        <div className="reader-image-container">
          <img
            src={imageUrl}
            alt="Story illustration"
            className="reader-image"
            onError={() => setImageError(true)}
          />
        </div>
      ) : (
        // Placeholder when no image, loading, or failed
        <div
          className="reader-image-container"
          style={{
            backgroundColor: '#f3f4f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '200px',
            aspectRatio: '4 / 3',
          }}
        >
          <div style={{ textAlign: 'center', color: '#9ca3af' }}>
            {imageLoading ? (
              <>
                <span className="spinner" style={{ width: '32px', height: '32px', marginBottom: '0.5rem' }} />
                <div style={{ fontSize: '0.75rem' }}>Generating illustration...</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📖</div>
                <div style={{ fontSize: '0.75rem' }}>
                  {page.image_prompt ? 'Image not available' : 'No illustration'}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Text content wrapper for desktop grid layout */}
      <div className="reader-text-content">
        {/* Chinese text with play button */}
        <div className="reader-chinese-section">
          {!showChinese ? (
            <div
              className="reader-chinese-reveal-box"
              onClick={() => setShowChinese(true)}
            >
              Tap to reveal Chinese
            </div>
          ) : (
            // Tapping anywhere in the block that isn't a word/sentence hides
            // the Chinese again, matching the pinyin/translation boxes. The
            // hanzi themselves keep their own tap actions (add card / analyze),
            // so those stop the click from bubbling up to the hide handler.
            <div
              className="reader-chinese-revealed tappable"
              onClick={() => setShowChinese(false)}
            >
              {/* Word chips (made with Haiku, cached on the page); plain text until they arrive. */}
              <ReaderWordsText readerId={readerId} page={page} />
              <button
                type="button"
                className="reader-chinese-hide-btn"
                onClick={() => setShowChinese(false)}
              >
                Hide Chinese
              </button>
            </div>
          )}
          <div className="reader-audio-controls">
            <button
              className="reader-audio-btn"
              onClick={isPlaying ? stopAudio : playAudio}
              aria-label={isPlaying ? 'Stop audio' : 'Play audio'}
            >
              {isPlaying ? '⏹' : '🔊'}
            </button>
            <ReaderSpeedChip />
          </div>
        </div>

        {/* Pinyin (tap to reveal) */}
        <div
          onClick={onTogglePinyin}
          className={`reader-pinyin-box ${showPinyin ? 'visible' : 'hidden'}`}
        >
          {showPinyin ? page.content_pinyin : 'Tap to reveal pinyin'}
        </div>

        {/* Translation reveal button / translation */}
        <div
          onClick={onToggleTranslation}
          className={`reader-translation-box ${showTranslation ? 'visible' : 'hidden'}`}
        >
          {showTranslation ? page.content_english : 'Tap to reveal translation'}
        </div>

      </div>
    </div>
  );
}

export function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  useNativeOutputHold();

  const [currentPage, setCurrentPage] = useState(0);
  const [showPinyin, setShowPinyin] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const readerQuery = useQuery({
    queryKey: ['reader', id],
    queryFn: () => getGradedReader(id!),
    enabled: !!id,
    refetchInterval: (q) =>
      q.state.data?.status === 'generating' || (q.state.data && q.state.data.pages.length === 0)
        ? 3000
        : false,
  });

  // Analytics: reader.open once the reader has its pages.
  const readerPages = readerQuery.data?.status !== 'generating' ? readerQuery.data?.pages.length ?? 0 : 0;
  const openTracked = useRef<string | null>(null);
  useEffect(() => {
    if (!id || readerPages === 0 || openTracked.current === id) return;
    openTracked.current = id;
    track('reader.open', { source: 'library', pages: readerPages });
  }, [id, readerPages]);

  const goToNextPage = () => {
    if (readerQuery.data && currentPage < readerQuery.data.pages.length - 1) {
      setCurrentPage((p) => p + 1);
      setShowPinyin(false);
      setShowTranslation(false);
    }
  };

  const goToPrevPage = () => {
    if (currentPage > 0) {
      setCurrentPage((p) => p - 1);
      setShowPinyin(false);
      setShowTranslation(false);
    }
  };

  const handleBack = () => {
    navigate('/readers');
  };

  const handleFinish = () => {
    if (id) void markDailyActivity('reader', id).catch(() => {});
    track('reader.finish', { pages: readerQuery.data?.pages.length ?? null });
    handleBack();
  };

  if (readerQuery.isLoading) {
    return <Loading />;
  }

  if (readerQuery.error || !readerQuery.data) {
    return (
      <div className="page">
        <div className="container">
          <div className="card" style={{ textAlign: 'center' }}>
            <p style={{ color: '#dc2626', marginBottom: '1rem' }}>
              Failed to load reader.
            </p>
            <Link to="/readers" className="btn btn-primary">
              Back to Readers
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const reader = readerQuery.data;

  if (reader.status === 'generating' || reader.pages.length === 0) {
    return (
      <div className="page">
        <div className="container" style={{ textAlign: 'center', paddingTop: '3rem' }}>
          <span className="spinner" />
          <p className="text-light mt-2">Generating your reader…</p>
          <p className="text-light">{reader.title_english}</p>
        </div>
      </div>
    );
  }

  const page = reader.pages[currentPage];
  const difficultyStyle = DIFFICULTY_COLORS[reader.difficulty_level];

  return (
    <div className="reader-page">
      {/* Header */}
      <header className="reader-header">
        <button
          onClick={handleBack}
          className="reader-back-btn"
        >
          &larr;
        </button>

        <div className="reader-title-section">
          <div className="reader-title">{reader.title_chinese}</div>
          <div className="reader-page-indicator">
            Page {currentPage + 1} of {reader.pages.length}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => navigate(`/readers/${id}/edit`)}
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
          >
            Edit
          </button>
          <AnkiExportButton
            target={{ kind: 'reader', readerId: reader.id, title: reader.title_chinese }}
            className="btn btn-secondary btn-sm"
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
          >
            ⬇ Anki
          </AnkiExportButton>
          <span
            className="reader-difficulty-badge"
            style={{
              backgroundColor: difficultyStyle.bg,
              color: difficultyStyle.text,
            }}
          >
            {difficultyStyle.label}
          </span>
        </div>
      </header>

      {/* Progress bar */}
      <div className="reader-progress-bar">
        <div
          className="reader-progress-fill"
          style={{
            width: `${((currentPage + 1) / reader.pages.length) * 100}%`,
          }}
        />
      </div>

      {/* Page content */}
      <div className="reader-content">
        <PageView
          page={page}
          readerId={reader.id}
          showPinyin={showPinyin}
          showTranslation={showTranslation}
          onTogglePinyin={() => setShowPinyin(!showPinyin)}
          onToggleTranslation={() => setShowTranslation(!showTranslation)}
        />
      </div>

      {/* Navigation footer */}
      <footer className="reader-footer">
        <button
          className="btn btn-secondary reader-nav-btn"
          onClick={goToPrevPage}
          disabled={currentPage === 0}
        >
          Previous
        </button>

        {currentPage === reader.pages.length - 1 ? (
          <button
            className="btn btn-primary reader-nav-btn"
            onClick={handleFinish}
          >
            Finish
          </button>
        ) : (
          <button
            className="btn btn-primary reader-nav-btn"
            onClick={goToNextPage}
          >
            Next
          </button>
        )}
      </footer>

    </div>
  );
}
