import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { DEFAULT_TTS_SPEED, SentenceChunk } from '../types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getGradedReader,
  getReaderImageUrl,
  analyzeSentence,
  generateReaderPageImage,
  getHomeworkRecordings,
  uploadHomeworkRecording,
  getHomeworkRecordingUrl,
} from '../api/client';
import { useAudioRecorder } from '../hooks/useAudio';
import { Loading } from '../components/Loading';
import { SentenceBreakdown } from '../components/SentenceBreakdown';
import { AddChunkModal, type Chunk } from '../components/AddChunkModal';
import { markDailyActivity } from '../api/client';
import {
  ReaderPage as ReaderPageType,
  SentenceBreakdown as SentenceBreakdownType,
  DifficultyLevel,
  HomeworkRecording,
} from '../types';
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
  onAddChunk,
}: {
  breakdown: SentenceBreakdownType | null;
  isLoading: boolean;
  onClose: () => void;
  onAddChunk: (c: Chunk) => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <span className="spinner" style={{ width: '30px', height: '30px' }} />
            <p className="text-light mt-2">Analyzing...</p>
          </div>
        ) : breakdown ? (
          <>
            <SentenceBreakdown breakdown={breakdown} onClose={onClose} />
            <div style={{ padding: '0 1rem 1rem', borderTop: '1px solid #eee' }}>
              <div style={{ fontSize: '0.8rem', color: '#666', margin: '0.75rem 0 0.5rem' }}>
                Tap a word to add as a flashcard
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {breakdown.chunks.map((c, i) => (
                  <button
                    key={i}
                    className="btn btn-secondary btn-sm"
                    onClick={() => onAddChunk({ hanzi: c.hanzi, pinyin: c.pinyin, english: c.english })}
                  >
                    {c.hanzi}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div style={{ padding: '1rem' }}>
            <div className="modal-header">
              <h2 className="modal-title">Analysis Failed</h2>
              <button className="modal-close" onClick={onClose}>
                &times;
              </button>
            </div>
            <p className="text-light">Failed to analyze sentence. Please try again.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function RecordingControls({
  homeworkId,
  pageId,
  existingRecording,
  isCompleted,
}: {
  homeworkId: string;
  pageId: string;
  existingRecording: HomeworkRecording | null;
  isCompleted: boolean;
}) {
  const queryClient = useQueryClient();
  const { isRecording, audioBlob, error: recError, startRecording, stopRecording, clearRecording } = useAudioRecorder();
  const [isUploading, setIsUploading] = useState(false);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recordingStartRef = useRef<number>(0);

  // Upload the recorded blob
  const handleUpload = useCallback(async () => {
    if (!audioBlob) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const durationMs = Date.now() - recordingStartRef.current;
      await uploadHomeworkRecording(homeworkId, audioBlob, 'page_reading', pageId, durationMs);
      clearRecording();
      queryClient.invalidateQueries({ queryKey: ['homework-recordings', homeworkId] });
      queryClient.invalidateQueries({ queryKey: ['homework'] });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  }, [audioBlob, homeworkId, pageId, clearRecording, queryClient]);

  const handleStartRecording = useCallback(() => {
    recordingStartRef.current = Date.now();
    startRecording();
  }, [startRecording]);

  // Play existing recording
  const playRecording = useCallback((audioUrl: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(getHomeworkRecordingUrl(audioUrl));
    audioRef.current = audio;
    audio.onplay = () => setIsPlayingBack(true);
    audio.onended = () => setIsPlayingBack(false);
    audio.onerror = () => setIsPlayingBack(false);
    audio.play().catch(() => setIsPlayingBack(false));
  }, []);

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlayingBack(false);
    }
  }, []);

  // Play back just-recorded audio
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

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  if (isCompleted) {
    // Read-only: show existing recording playback if available
    if (!existingRecording) return null;
    return (
      <div className="reader-recording-controls">
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => isPlayingBack ? stopPlayback() : playRecording(existingRecording.audio_url)}
          style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
        >
          {isPlayingBack ? '⏹ Stop' : '▶ Play Recording'}
        </button>
      </div>
    );
  }

  return (
    <div className="reader-recording-controls">
      {recError && <p style={{ color: '#dc2626', fontSize: '0.75rem', margin: '0 0 0.5rem 0' }}>{recError}</p>}
      {uploadError && <p style={{ color: '#dc2626', fontSize: '0.75rem', margin: '0 0 0.5rem 0' }}>{uploadError}</p>}

      {/* Show existing recording */}
      {existingRecording && !audioBlob && !isRecording && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => isPlayingBack ? stopPlayback() : playRecording(existingRecording.audio_url)}
            style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
          >
            {isPlayingBack ? '⏹ Stop' : '▶ Play Recording'}
          </button>
          <span style={{ color: '#16a34a', fontSize: '0.75rem' }}>Recorded</span>
        </div>
      )}

      {/* Recording / re-recording controls */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        {isRecording ? (
          <button
            className="btn btn-primary btn-sm reader-record-btn recording"
            onClick={stopRecording}
            style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
          >
            ⏹ Stop Recording
          </button>
        ) : audioBlob ? (
          <>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => isPlayingBack ? stopPlayback() : playPreview()}
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
            >
              {isPlayingBack ? '⏹ Stop' : '▶ Preview'}
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleUpload}
              disabled={isUploading}
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
            >
              {isUploading ? 'Saving...' : 'Save'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={clearRecording}
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
            >
              Discard
            </button>
          </>
        ) : (
          <button
            className="btn btn-primary btn-sm reader-record-btn"
            onClick={handleStartRecording}
            style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
          >
            {existingRecording ? '🎙 Re-record' : '🎙 Record Reading'}
          </button>
        )}
      </div>
    </div>
  );
}

function PageView({
  page,
  readerId,
  showPinyin,
  showTranslation,
  onTogglePinyin,
  onToggleTranslation,
  onAnalyzeSentence,
  onAddChunk,
  homeworkId,
  pageRecording,
  isCompleted,
}: {
  page: ReaderPageType;
  readerId: string;
  showPinyin: boolean;
  showTranslation: boolean;
  onTogglePinyin: () => void;
  onToggleTranslation: () => void;
  onAnalyzeSentence: (sentence: string) => void;
  onAddChunk: (chunk: { hanzi: string; pinyin: string; english: string }) => void;
  homeworkId?: string;
  pageRecording?: HomeworkRecording | null;
  isCompleted?: boolean;
}) {
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showChinese, setShowChinese] = useState(false);
  const [segments, setSegments] = useState<SentenceChunk[] | null>(null);
  const [isSegmenting, setIsSegmenting] = useState(false);
  const segmentingRef = useRef(false);

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
    setSegments(null);
    setIsSegmenting(false);
    segmentingRef.current = false;
  }, [page.id]);

  // Load word segmentation when Chinese is revealed
  useEffect(() => {
    if (!showChinese || segments !== null || segmentingRef.current) return;
    segmentingRef.current = true;
    setIsSegmenting(true);
    const sents = page.content_chinese.split(/(?<=[。！？])/g).filter((s) => s.trim());
    Promise.all(sents.map((s) => analyzeSentence(s)))
      .then((breakdowns) => setSegments(breakdowns.flatMap((b) => b.chunks)))
      .catch(() => {})
      .finally(() => {
        setIsSegmenting(false);
        segmentingRef.current = false;
      });
  }, [showChinese, page.content_chinese, segments]);

  // Play Chinese audio using browser TTS
  const playAudio = useCallback(() => {
    if (!('speechSynthesis' in window) || isPlaying) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(page.content_chinese);
    utterance.lang = 'zh-CN';
    utterance.rate = DEFAULT_TTS_SPEED;

    // Try to find a Chinese voice
    const voices = window.speechSynthesis.getVoices();
    const chineseVoice = voices.find(
      (v) => v.lang.startsWith('zh') || v.lang.includes('Chinese')
    );
    if (chineseVoice) {
      utterance.voice = chineseVoice;
    }

    utterance.onstart = () => setIsPlaying(true);
    utterance.onend = () => setIsPlaying(false);
    utterance.onerror = () => setIsPlaying(false);

    window.speechSynthesis.speak(utterance);
  }, [page.content_chinese, isPlaying]);

  const stopAudio = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsPlaying(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

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
            <div className="reader-chinese-text">
              {segments ? (
                segments.map((chunk, i) => (
                  <span
                    key={i}
                    className="reader-word-segment"
                    onClick={() => onAddChunk({ hanzi: chunk.hanzi, pinyin: chunk.pinyin, english: chunk.english })}
                  >
                    {chunk.hanzi}
                  </span>
                ))
              ) : (
                sentences.map((sentence, index) => (
                  <span
                    key={index}
                    onClick={() => onAnalyzeSentence(sentence)}
                    className="reader-sentence"
                  >
                    {sentence}
                  </span>
                ))
              )}
              {isSegmenting && (
                <span className="reader-segmenting-indicator" title="Loading word segments...">
                  <span className="spinner" style={{ width: '14px', height: '14px', display: 'inline-block', verticalAlign: 'middle', marginLeft: '0.5rem' }} />
                </span>
              )}
            </div>
          )}
          <button
            className="reader-audio-btn"
            onClick={isPlaying ? stopAudio : playAudio}
            aria-label={isPlaying ? 'Stop audio' : 'Play audio'}
          >
            {isPlaying ? '⏹' : '🔊'}
          </button>
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

        {/* Recording controls (homework mode only) */}
        {homeworkId && (
          <RecordingControls
            homeworkId={homeworkId}
            pageId={page.id}
            existingRecording={pageRecording || null}
            isCompleted={isCompleted || false}
          />
        )}
      </div>
    </div>
  );
}

export function ReaderPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const homeworkId = searchParams.get('homework') || undefined;

  const [currentPage, setCurrentPage] = useState(0);
  const [showPinyin, setShowPinyin] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [analysisModal, setAnalysisModal] = useState<{
    sentence: string;
    breakdown: SentenceBreakdownType | null;
    isLoading: boolean;
  } | null>(null);
  const [addingChunk, setAddingChunk] = useState<Chunk | null>(null);

  const readerQuery = useQuery({
    queryKey: ['reader', id],
    queryFn: () => getGradedReader(id!),
    enabled: !!id,
    refetchInterval: (q) =>
      q.state.data?.status === 'generating' || (q.state.data && q.state.data.pages.length === 0)
        ? 3000
        : false,
  });

  const recordingsQuery = useQuery({
    queryKey: ['homework-recordings', homeworkId],
    queryFn: () => getHomeworkRecordings(homeworkId!),
    enabled: !!homeworkId,
  });

  const recordings = recordingsQuery.data || [];

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
    if (homeworkId) {
      navigate('/homework');
    } else {
      navigate('/readers');
    }
  };

  const handleFinish = () => {
    if (id) void markDailyActivity('reader', id).catch(() => {});
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

  // Find recording for current page
  const pageRecording = recordings.find(
    (r) => r.page_id === page.id && r.type === 'page_reading'
  );

  // Calculate recording progress for homework mode
  const pagesWithRecordings = homeworkId
    ? new Set(recordings.filter((r) => r.type === 'page_reading').map((r) => r.page_id)).size
    : 0;

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
            {homeworkId && (
              <span style={{ marginLeft: '0.5rem', color: '#16a34a' }}>
                ({pagesWithRecordings}/{reader.pages.length} recorded)
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {!homeworkId && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => navigate(`/readers/${id}/edit`)}
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
            >
              Edit
            </button>
          )}
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
          onAnalyzeSentence={handleAnalyzeSentence}
          onAddChunk={(c) => setAddingChunk(c)}
          homeworkId={homeworkId}
          pageRecording={pageRecording}
          isCompleted={false}
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
            onClick={homeworkId ? handleBack : handleFinish}
          >
            {homeworkId ? 'Back to Homework' : 'Finish'}
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
          onAddChunk={(c) => {
            setAnalysisModal(null);
            setAddingChunk(c);
          }}
        />
      )}
      {addingChunk && (
        <AddChunkModal chunk={addingChunk} onClose={() => setAddingChunk(null)} />
      )}
    </div>
  );
}
