import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getGradedReader, getReaderImageUrl, analyzeSentence, generateReaderPageImage } from '../api/client';
import { Loading } from '../components/Loading';
import { ReaderPage as ReaderPageType, SentenceBreakdown, DifficultyLevel } from '../types';
import './ReaderPage.css';

const DIFFICULTY_COLORS: Record<DifficultyLevel, { bg: string; text: string; label: string }> = {
  beginner: { bg: '#dcfce7', text: '#166534', label: 'Beginner' },
  elementary: { bg: '#dbeafe', text: '#1e40af', label: 'Elementary' },
  intermediate: { bg: '#fef3c7', text: '#92400e', label: 'Intermediate' },
  advanced: { bg: '#fce7f3', text: '#9d174d', label: 'Advanced' },
};

function SentenceAnalysisModal({
  breakdown,
  isLoading,
  onClose,
}: {
  breakdown: SentenceBreakdown | null;
  isLoading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Sentence Analysis</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div style={{ padding: '1rem' }}>
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <span className="spinner" style={{ width: '30px', height: '30px' }} />
              <p className="text-light mt-2">Analyzing...</p>
            </div>
          ) : breakdown ? (
            <div>
              {/* Full sentence */}
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>
                  {breakdown.hanzi}
                </div>
                <div style={{ color: '#3b82f6', marginBottom: '0.25rem' }}>
                  {breakdown.pinyin}
                </div>
                <div style={{ color: '#6b7280' }}>{breakdown.english}</div>
              </div>

              {/* Chunks */}
              <h4 style={{ marginBottom: '0.75rem' }}>Word by Word</h4>
              <div className="flex flex-col gap-2">
                {breakdown.chunks.map((chunk, index) => (
                  <div
                    key={index}
                    style={{
                      padding: '0.75rem',
                      background: '#f9fafb',
                      borderRadius: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1.25rem' }}>{chunk.hanzi}</span>
                      <span style={{ color: '#3b82f6', fontSize: '0.875rem' }}>
                        {chunk.pinyin}
                      </span>
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>
                      {chunk.english}
                    </div>
                    {chunk.note && (
                      <div style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                        {chunk.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Grammar notes */}
              {breakdown.grammarNotes && (
                <div
                  style={{
                    marginTop: '1rem',
                    padding: '0.75rem',
                    background: '#eff6ff',
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                  }}
                >
                  <strong>Grammar Notes:</strong> {breakdown.grammarNotes}
                </div>
              )}
            </div>
          ) : (
            <p className="text-light">Failed to analyze sentence.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function PageView({
  page,
  readerId,
  showTranslation,
  onToggleTranslation,
  onAnalyzeSentence,
}: {
  page: ReaderPageType;
  readerId: string;
  showTranslation: boolean;
  onToggleTranslation: () => void;
  onAnalyzeSentence: (sentence: string) => void;
}) {
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState(false);

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
  }, [page.id]);

  // Split sentences for individual analysis
  const sentences = page.content_chinese
    .split(/(?<=[。！？])/g)
    .filter((s) => s.trim());

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
        {/* Chinese text */}
        <div className="reader-chinese-text">
          {sentences.map((sentence, index) => (
            <span
              key={index}
              onClick={() => onAnalyzeSentence(sentence)}
              className="reader-sentence"
            >
              {sentence}
            </span>
          ))}
        </div>

        {/* Pinyin (always visible) */}
        <div className="reader-pinyin">
          {page.content_pinyin}
        </div>

        {/* Translation reveal button / translation */}
        <div
          onClick={onToggleTranslation}
          className={`reader-translation-box ${showTranslation ? 'visible' : 'hidden'}`}
        >
          {showTranslation ? page.content_english : 'Tap to reveal translation'}
        </div>

        <p className="reader-hint">
          Tap any sentence to analyze it word by word
        </p>
      </div>
    </div>
  );
}

export function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [currentPage, setCurrentPage] = useState(0);
  const [showTranslation, setShowTranslation] = useState(false);
  const [analysisModal, setAnalysisModal] = useState<{
    sentence: string;
    breakdown: SentenceBreakdown | null;
    isLoading: boolean;
  } | null>(null);

  const readerQuery = useQuery({
    queryKey: ['reader', id],
    queryFn: () => getGradedReader(id!),
    enabled: !!id,
  });

  const handleAnalyzeSentence = async (sentence: string) => {
    setAnalysisModal({ sentence, breakdown: null, isLoading: true });
    try {
      const breakdown = await analyzeSentence(sentence);
      setAnalysisModal({ sentence, breakdown, isLoading: false });
    } catch (error) {
      console.error('Failed to analyze sentence:', error);
      setAnalysisModal({ sentence, breakdown: null, isLoading: false });
    }
  };

  const goToNextPage = () => {
    if (readerQuery.data && currentPage < readerQuery.data.pages.length - 1) {
      setCurrentPage((p) => p + 1);
      setShowTranslation(false);
    }
  };

  const goToPrevPage = () => {
    if (currentPage > 0) {
      setCurrentPage((p) => p - 1);
      setShowTranslation(false);
    }
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
  const page = reader.pages[currentPage];
  const difficultyStyle = DIFFICULTY_COLORS[reader.difficulty_level];

  return (
    <div className="reader-page">
      {/* Header */}
      <header className="reader-header">
        <button
          onClick={() => navigate('/readers')}
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

        <span
          className="reader-difficulty-badge"
          style={{
            backgroundColor: difficultyStyle.bg,
            color: difficultyStyle.text,
          }}
        >
          {difficultyStyle.label}
        </span>
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
          showTranslation={showTranslation}
          onToggleTranslation={() => setShowTranslation(!showTranslation)}
          onAnalyzeSentence={handleAnalyzeSentence}
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
            onClick={() => navigate('/readers')}
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

      {/* Analysis Modal */}
      {analysisModal && (
        <SentenceAnalysisModal
          breakdown={analysisModal.breakdown}
          isLoading={analysisModal.isLoading}
          onClose={() => setAnalysisModal(null)}
        />
      )}
    </div>
  );
}
