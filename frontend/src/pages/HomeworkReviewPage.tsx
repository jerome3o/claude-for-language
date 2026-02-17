import { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useAudioRecorder } from '../hooks/useAudio';
import {
  getHomeworkAssignment,
  getGradedReader,
  getHomeworkRecordings,
  getHomeworkFeedback,
  submitHomeworkFeedback,
  completeHomeworkReview,
  getHomeworkRecordingUrl,
  getReaderImageUrl,
} from '../api/client';
import { Loading } from '../components/Loading';
import {
  HomeworkFeedback,
  HomeworkRecording,
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

function StarRating({
  value,
  onChange,
  readOnly,
}: {
  value: number | null;
  onChange?: (v: number) => void;
  readOnly?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: '0.25rem' }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readOnly}
          onClick={() => onChange?.(star === value ? 0 : star)}
          style={{
            background: 'none',
            border: 'none',
            cursor: readOnly ? 'default' : 'pointer',
            fontSize: '1.25rem',
            padding: '0.125rem',
            color: value !== null && star <= value ? '#f59e0b' : '#d1d5db',
          }}
        >
          {value !== null && star <= value ? '\u2605' : '\u2606'}
        </button>
      ))}
    </div>
  );
}

function AudioPlaybackButton({ audioUrl, label }: { audioUrl: string; label?: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toggle = useCallback(() => {
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(getHomeworkRecordingUrl(audioUrl));
    audioRef.current = audio;
    audio.onplay = () => setIsPlaying(true);
    audio.onended = () => setIsPlaying(false);
    audio.onerror = () => setIsPlaying(false);
    audio.play().catch(() => setIsPlaying(false));
  }, [audioUrl, isPlaying]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  return (
    <button
      className="btn btn-secondary btn-sm"
      onClick={toggle}
      style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
    >
      {isPlaying ? '\u23f9 Stop' : `\u25b6 ${label || 'Play'}`}
    </button>
  );
}

function FeedbackRecorder({
  homeworkId,
  pageId,
  type,
  existingFeedback,
  onSaved,
}: {
  homeworkId: string;
  pageId?: string;
  type: 'page_feedback' | 'overall';
  existingFeedback: HomeworkFeedback | null;
  onSaved: () => void;
}) {
  const { isRecording, audioBlob, error: recError, startRecording, stopRecording, clearRecording } = useAudioRecorder();
  const [textFeedback, setTextFeedback] = useState(existingFeedback?.text_feedback || '');
  const [rating, setRating] = useState<number | null>(existingFeedback?.rating ?? null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recordingStartRef = useRef<number>(0);

  // Sync with prop changes when navigating between pages
  useEffect(() => {
    setTextFeedback(existingFeedback?.text_feedback || '');
    setRating(existingFeedback?.rating ?? null);
    clearRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingFeedback?.id, pageId]);

  const handleStartRecording = useCallback(() => {
    recordingStartRef.current = Date.now();
    startRecording();
  }, [startRecording]);

  const handleSave = useCallback(async () => {
    if (!textFeedback.trim() && !audioBlob && !existingFeedback?.audio_feedback_url) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      await submitHomeworkFeedback(homeworkId, type, {
        textFeedback: textFeedback.trim() || undefined,
        audioBlob: audioBlob || undefined,
        pageId,
        rating: rating && rating > 0 ? rating : undefined,
      });
      clearRecording();
      onSaved();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to save feedback');
    } finally {
      setIsUploading(false);
    }
  }, [textFeedback, audioBlob, homeworkId, type, pageId, rating, existingFeedback, clearRecording, onSaved]);

  const playPreview = useCallback(() => {
    if (!audioBlob) return;
    if (audioRef.current) audioRef.current.pause();
    const url = URL.createObjectURL(audioBlob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onplay = () => setIsPlayingBack(true);
    audio.onended = () => { setIsPlayingBack(false); URL.revokeObjectURL(url); };
    audio.onerror = () => { setIsPlayingBack(false); URL.revokeObjectURL(url); };
    audio.play().catch(() => setIsPlayingBack(false));
  }, [audioBlob]);

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlayingBack(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const hasChanges = textFeedback.trim() !== (existingFeedback?.text_feedback || '')
    || audioBlob !== null
    || rating !== (existingFeedback?.rating ?? null);

  return (
    <div style={{
      padding: '0.75rem',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      backgroundColor: '#f9fafb',
    }}>
      {recError && <p style={{ color: '#dc2626', fontSize: '0.75rem', margin: '0 0 0.5rem 0' }}>{recError}</p>}
      {uploadError && <p style={{ color: '#dc2626', fontSize: '0.75rem', margin: '0 0 0.5rem 0' }}>{uploadError}</p>}

      <textarea
        value={textFeedback}
        onChange={(e) => setTextFeedback(e.target.value)}
        placeholder={type === 'overall' ? 'Overall feedback for the student...' : 'Feedback for this page...'}
        rows={2}
        style={{
          width: '100%',
          padding: '0.5rem',
          border: '1px solid #d1d5db',
          borderRadius: '6px',
          resize: 'vertical',
          fontSize: '0.875rem',
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />

      {type === 'overall' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Rating:</span>
          <StarRating value={rating} onChange={setRating} />
        </div>
      )}

      {/* Existing audio feedback */}
      {existingFeedback?.audio_feedback_url && !audioBlob && !isRecording && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
          <AudioPlaybackButton audioUrl={existingFeedback.audio_feedback_url} label="Voice Feedback" />
          <span style={{ color: '#16a34a', fontSize: '0.75rem' }}>Saved</span>
        </div>
      )}

      {/* Voice note recording controls */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
        {isRecording ? (
          <button
            className="btn btn-primary btn-sm"
            onClick={stopRecording}
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', backgroundColor: '#dc2626', borderColor: '#dc2626' }}
          >
            {'\u23f9'} Stop
          </button>
        ) : audioBlob ? (
          <>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => isPlayingBack ? stopPlayback() : playPreview()}
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
            >
              {isPlayingBack ? '\u23f9 Stop' : '\u25b6 Preview'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={clearRecording}
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
            >
              Discard
            </button>
          </>
        ) : (
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleStartRecording}
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
          >
            {existingFeedback?.audio_feedback_url ? '\ud83c\udf99 Re-record' : '\ud83c\udf99 Record Voice Note'}
          </button>
        )}
      </div>

      {/* Save button */}
      <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSave}
          disabled={isUploading || (!hasChanges && !audioBlob)}
          style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
        >
          {isUploading ? 'Saving...' : existingFeedback ? 'Update Feedback' : 'Save Feedback'}
        </button>
      </div>
    </div>
  );
}

function FeedbackDisplay({ feedback }: { feedback: HomeworkFeedback }) {
  return (
    <div style={{
      padding: '0.75rem',
      border: '1px solid #bbf7d0',
      borderRadius: '8px',
      backgroundColor: '#f0fdf4',
    }}>
      <p style={{ fontSize: '0.75rem', color: '#166534', margin: '0 0 0.25rem 0', fontWeight: 500 }}>
        Tutor Feedback
        {feedback.rating !== null && feedback.rating > 0 && (
          <span style={{ marginLeft: '0.5rem' }}>
            {'\u2605'.repeat(feedback.rating)}{'\u2606'.repeat(5 - feedback.rating)}
          </span>
        )}
      </p>
      {feedback.text_feedback && (
        <p style={{ fontSize: '0.875rem', margin: '0 0 0.25rem 0', color: '#374151' }}>
          {feedback.text_feedback}
        </p>
      )}
      {feedback.audio_feedback_url && (
        <AudioPlaybackButton audioUrl={feedback.audio_feedback_url} label="Voice Feedback" />
      )}
    </div>
  );
}

function ReviewPageView({
  page,
  pageRecording,
  pageFeedback,
  homeworkId,
  isTutor,
}: {
  page: ReaderPageType;
  pageRecording: HomeworkRecording | null;
  pageFeedback: HomeworkFeedback | null;
  homeworkId: string;
  isTutor: boolean;
}) {
  const queryClient = useQueryClient();
  const [showPinyin, setShowPinyin] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const imageUrl = page.image_url ? getReaderImageUrl(page.image_url) : null;
  const [imageError, setImageError] = useState(false);

  const sentences = page.content_chinese
    .split(/(?<=[。！？])/g)
    .filter((s) => s.trim());

  return (
    <div style={{ width: '100%' }}>
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
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{'\ud83d\udcd6'}</div>
              <div style={{ fontSize: '0.75rem' }}>No illustration</div>
            </div>
          </div>
        )}

        <div className="reader-text-content">
          {/* Chinese text */}
          <div className="reader-chinese-section">
            <div className="reader-chinese-text">
              {sentences.map((sentence, index) => (
                <span key={index}>{sentence}</span>
              ))}
            </div>
          </div>

          {/* Pinyin */}
          <div
            onClick={() => setShowPinyin(!showPinyin)}
            className={`reader-pinyin-box ${showPinyin ? 'visible' : 'hidden'}`}
          >
            {showPinyin ? page.content_pinyin : 'Tap to reveal pinyin'}
          </div>

          {/* Translation */}
          <div
            onClick={() => setShowTranslation(!showTranslation)}
            className={`reader-translation-box ${showTranslation ? 'visible' : 'hidden'}`}
          >
            {showTranslation ? page.content_english : 'Tap to reveal translation'}
          </div>

          {/* Student's recording */}
          {pageRecording ? (
            <div style={{
              padding: '0.5rem 0.75rem',
              border: '1px solid #93c5fd',
              borderRadius: '8px',
              backgroundColor: '#eff6ff',
              marginTop: '0.5rem',
            }}>
              <p style={{ fontSize: '0.75rem', color: '#1e40af', margin: '0 0 0.25rem 0', fontWeight: 500 }}>
                Student Recording
              </p>
              <AudioPlaybackButton audioUrl={pageRecording.audio_url} label="Play Recording" />
            </div>
          ) : (
            <p style={{ fontSize: '0.75rem', color: '#9ca3af', fontStyle: 'italic', marginTop: '0.5rem' }}>
              No recording for this page
            </p>
          )}

          {/* Feedback section */}
          <div style={{ marginTop: '0.75rem' }}>
            {isTutor ? (
              <FeedbackRecorder
                homeworkId={homeworkId}
                pageId={page.id}
                type="page_feedback"
                existingFeedback={pageFeedback}
                onSaved={() => {
                  queryClient.invalidateQueries({ queryKey: ['homework-feedback', homeworkId] });
                }}
              />
            ) : pageFeedback ? (
              <FeedbackDisplay feedback={pageFeedback} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HomeworkReviewPage() {
  const { id: homeworkId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isTutor = user?.role === 'tutor';

  const [currentPage, setCurrentPage] = useState(0);

  const hwQuery = useQuery({
    queryKey: ['homework', homeworkId],
    queryFn: () => getHomeworkAssignment(homeworkId!),
    enabled: !!homeworkId,
  });

  const readerQuery = useQuery({
    queryKey: ['reader', hwQuery.data?.reader_id],
    queryFn: () => getGradedReader(hwQuery.data!.reader_id),
    enabled: !!hwQuery.data?.reader_id,
  });

  const recordingsQuery = useQuery({
    queryKey: ['homework-recordings', homeworkId],
    queryFn: () => getHomeworkRecordings(homeworkId!),
    enabled: !!homeworkId,
  });

  const feedbackQuery = useQuery({
    queryKey: ['homework-feedback', homeworkId],
    queryFn: () => getHomeworkFeedback(homeworkId!),
    enabled: !!homeworkId,
  });

  const completeReviewMutation = useMutation({
    mutationFn: () => completeHomeworkReview(homeworkId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['homework'] });
      queryClient.invalidateQueries({ queryKey: ['homework', homeworkId] });
      navigate('/homework');
    },
  });

  const recordings = recordingsQuery.data || [];
  const feedback = feedbackQuery.data || [];

  const goToNextPage = () => {
    if (readerQuery.data && currentPage < readerQuery.data.pages.length - 1) {
      setCurrentPage((p) => p + 1);
    }
  };

  const goToPrevPage = () => {
    if (currentPage > 0) {
      setCurrentPage((p) => p - 1);
    }
  };

  if (hwQuery.isLoading || readerQuery.isLoading) {
    return <Loading />;
  }

  if (hwQuery.error || !hwQuery.data) {
    return (
      <div className="page">
        <div className="container">
          <div className="card" style={{ textAlign: 'center', color: '#dc2626' }}>
            Failed to load homework. Please try again.
          </div>
        </div>
      </div>
    );
  }

  if (!readerQuery.data) {
    return (
      <div className="page">
        <div className="container">
          <div className="card" style={{ textAlign: 'center', color: '#dc2626' }}>
            Reader not found.
          </div>
        </div>
      </div>
    );
  }

  const hw = hwQuery.data;
  const reader = readerQuery.data;
  const page = reader.pages[currentPage];
  const difficultyStyle = DIFFICULTY_COLORS[reader.difficulty_level];

  // Find recording and feedback for current page
  const pageRecording = recordings.find(
    (r) => r.page_id === page.id && r.type === 'page_reading'
  ) || null;

  const pageFeedback = feedback.find(
    (f) => f.page_id === page.id && f.type === 'page_feedback'
  ) || null;

  const overallFeedback = feedback.find((f) => f.type === 'overall') || null;

  // Recording progress
  const pagesWithRecordings = new Set(
    recordings.filter((r) => r.type === 'page_reading').map((r) => r.page_id)
  ).size;

  const pagesWithFeedback = new Set(
    feedback.filter((f) => f.type === 'page_feedback').map((f) => f.page_id)
  ).size;

  const isLastPage = currentPage === reader.pages.length - 1;

  return (
    <div className="reader-page">
      {/* Header */}
      <header className="reader-header">
        <button
          onClick={() => navigate('/homework')}
          className="reader-back-btn"
        >
          &larr;
        </button>

        <div className="reader-title-section">
          <div className="reader-title">{reader.title_chinese}</div>
          <div className="reader-page-indicator">
            {isLastPage && currentPage === reader.pages.length - 1 && isTutor
              ? 'Overall Review'
              : `Page ${currentPage + 1} of ${reader.pages.length}`}
            <span style={{ marginLeft: '0.5rem', color: '#6b7280' }}>
              ({pagesWithRecordings}/{reader.pages.length} recorded)
            </span>
            {isTutor && (
              <span style={{ marginLeft: '0.25rem', color: '#8b5cf6' }}>
                {pagesWithFeedback} reviewed
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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

      {/* Student info bar */}
      <div style={{
        padding: '0.5rem 1rem',
        backgroundColor: '#eff6ff',
        borderBottom: '1px solid #93c5fd',
        fontSize: '0.8rem',
        color: '#1e40af',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>Student: {hw.student_name || hw.student_email || 'Unknown'}</span>
        <span style={{
          padding: '0.125rem 0.5rem',
          borderRadius: '1rem',
          backgroundColor: hw.status === 'reviewed' ? '#f3e8ff' : '#dcfce7',
          color: hw.status === 'reviewed' ? '#7c3aed' : '#166534',
          fontSize: '0.7rem',
          fontWeight: 500,
        }}>
          {hw.status === 'reviewed' ? 'Reviewed' : 'Submitted'}
        </span>
      </div>

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
        <ReviewPageView
          page={page}
          pageRecording={pageRecording}
          pageFeedback={pageFeedback}
          homeworkId={homeworkId!}
          isTutor={isTutor!}
        />

        {/* Overall feedback section - show on last page */}
        {isLastPage && (
          <div style={{
            width: '100%',
            maxWidth: '500px',
            margin: '1.5rem auto 0',
            padding: '0 1rem 1rem',
          }}>
            <h3 style={{ fontSize: '1rem', margin: '0 0 0.5rem 0', color: '#374151' }}>
              Overall Feedback
            </h3>
            {isTutor ? (
              <FeedbackRecorder
                homeworkId={homeworkId!}
                type="overall"
                existingFeedback={overallFeedback}
                onSaved={() => {
                  queryClient.invalidateQueries({ queryKey: ['homework-feedback', homeworkId] });
                }}
              />
            ) : overallFeedback ? (
              <FeedbackDisplay feedback={overallFeedback} />
            ) : (
              <p style={{ fontSize: '0.875rem', color: '#9ca3af', fontStyle: 'italic' }}>
                No overall feedback yet
              </p>
            )}
          </div>
        )}
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

        {isLastPage ? (
          isTutor && hw.status === 'completed' ? (
            <button
              className="btn btn-primary reader-nav-btn"
              onClick={() => {
                if (window.confirm('Submit your review? The student will be able to see your feedback.')) {
                  completeReviewMutation.mutate();
                }
              }}
              disabled={completeReviewMutation.isPending}
            >
              {completeReviewMutation.isPending ? 'Submitting...' : 'Submit Review'}
            </button>
          ) : (
            <button
              className="btn btn-primary reader-nav-btn"
              onClick={() => navigate('/homework')}
            >
              Back to Homework
            </button>
          )
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
