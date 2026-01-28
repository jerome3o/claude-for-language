import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getGradedReader, getReaderImageUrl, analyzeSentence } from '../api/client';
import { Loading } from '../components/Loading';
import { ReaderPage as ReaderPageType, SentenceBreakdown, DifficultyLevel } from '../types';

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
  showTranslation,
  onToggleTranslation,
  onAnalyzeSentence,
}: {
  page: ReaderPageType;
  showTranslation: boolean;
  onToggleTranslation: () => void;
  onAnalyzeSentence: (sentence: string) => void;
}) {
  const imageUrl = page.image_url ? getReaderImageUrl(page.image_url) : null;

  // Split sentences for individual analysis
  const sentences = page.content_chinese
    .split(/(?<=[。！？])/g)
    .filter((s) => s.trim());

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '1rem',
        minHeight: '100%',
      }}
    >
      {/* Image */}
      {imageUrl && (
        <div
          style={{
            width: '100%',
            maxWidth: '400px',
            marginBottom: '1.5rem',
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
          }}
        >
          <img
            src={imageUrl}
            alt="Story illustration"
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
            }}
            onError={(e) => {
              // Hide broken images
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>
      )}

      {/* Chinese text */}
      <div
        style={{
          fontSize: '1.5rem',
          lineHeight: 1.8,
          textAlign: 'center',
          marginBottom: '1rem',
          maxWidth: '500px',
        }}
      >
        {sentences.map((sentence, index) => (
          <span
            key={index}
            onClick={() => onAnalyzeSentence(sentence)}
            style={{
              cursor: 'pointer',
              borderBottom: '2px dashed transparent',
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderBottomColor = '#3b82f6';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderBottomColor = 'transparent';
            }}
          >
            {sentence}
          </span>
        ))}
      </div>

      {/* Pinyin (always visible) */}
      <div
        style={{
          color: '#3b82f6',
          fontSize: '1rem',
          textAlign: 'center',
          marginBottom: '1rem',
          maxWidth: '500px',
        }}
      >
        {page.content_pinyin}
      </div>

      {/* Translation reveal button / translation */}
      <div
        onClick={onToggleTranslation}
        style={{
          padding: '1rem',
          borderRadius: '8px',
          backgroundColor: showTranslation ? '#f0fdf4' : '#f9fafb',
          border: '1px solid',
          borderColor: showTranslation ? '#86efac' : '#e5e7eb',
          cursor: 'pointer',
          textAlign: 'center',
          maxWidth: '500px',
          width: '100%',
          transition: 'all 0.2s',
        }}
      >
        {showTranslation ? (
          <div style={{ color: '#166534' }}>{page.content_english}</div>
        ) : (
          <div style={{ color: '#9ca3af' }}>Tap to reveal translation</div>
        )}
      </div>

      <p
        style={{
          fontSize: '0.75rem',
          color: '#9ca3af',
          marginTop: '1rem',
          textAlign: 'center',
        }}
      >
        Tap any sentence to analyze it word by word
      </p>
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
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#fafafa',
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: '0.75rem 1rem',
          backgroundColor: 'white',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <button
          onClick={() => navigate('/readers')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0.5rem',
            fontSize: '1.25rem',
          }}
        >
          &larr;
        </button>

        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>{reader.title_chinese}</div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
            Page {currentPage + 1} of {reader.pages.length}
          </div>
        </div>

        <span
          style={{
            padding: '0.125rem 0.5rem',
            borderRadius: '1rem',
            fontSize: '0.6875rem',
            backgroundColor: difficultyStyle.bg,
            color: difficultyStyle.text,
            fontWeight: 500,
          }}
        >
          {difficultyStyle.label}
        </span>
      </header>

      {/* Progress bar */}
      <div style={{ height: '3px', backgroundColor: '#e5e7eb' }}>
        <div
          style={{
            height: '100%',
            width: `${((currentPage + 1) / reader.pages.length) * 100}%`,
            backgroundColor: '#3b82f6',
            transition: 'width 0.3s',
          }}
        />
      </div>

      {/* Page content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <PageView
          page={page}
          showTranslation={showTranslation}
          onToggleTranslation={() => setShowTranslation(!showTranslation)}
          onAnalyzeSentence={handleAnalyzeSentence}
        />
      </div>

      {/* Navigation footer */}
      <footer
        style={{
          padding: '1rem',
          backgroundColor: 'white',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
        }}
      >
        <button
          className="btn btn-secondary"
          onClick={goToPrevPage}
          disabled={currentPage === 0}
          style={{
            flex: 1,
            opacity: currentPage === 0 ? 0.5 : 1,
          }}
        >
          Previous
        </button>

        {currentPage === reader.pages.length - 1 ? (
          <button
            className="btn btn-primary"
            onClick={() => navigate('/readers')}
            style={{ flex: 1 }}
          >
            Finish
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={goToNextPage}
            style={{ flex: 1 }}
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
