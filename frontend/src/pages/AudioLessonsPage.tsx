import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDecks } from '../api/client';
import {
  listAudioLessons,
  createAudioLesson,
  deleteAudioLesson,
  getAudioLessonDownloadUrl,
  type AudioLesson,
} from '../api/client';

function StatusBadge({ status }: { status: AudioLesson['status'] }) {
  const colors: Record<AudioLesson['status'], string> = {
    pending: '#888',
    generating: '#f90',
    done: '#2a9d2a',
    error: '#c0392b',
  };
  const labels: Record<AudioLesson['status'], string> = {
    pending: 'Pending',
    generating: 'Generating…',
    done: 'Ready',
    error: 'Error',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.15rem 0.5rem',
        borderRadius: '999px',
        background: colors[status],
        color: '#fff',
        fontSize: '0.75rem',
        fontWeight: 600,
        verticalAlign: 'middle',
      }}
    >
      {labels[status]}
    </span>
  );
}

function LessonRow({
  lesson,
  onDelete,
}: {
  lesson: AudioLesson;
  onDelete: (id: string) => void;
}) {
  const downloadUrl = lesson.status === 'done' ? getAudioLessonDownloadUrl(lesson.id) : null;
  const date = new Date(lesson.created_at).toLocaleDateString();

  return (
    <div
      className="card"
      style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem', marginBottom: '0.5rem' }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, marginBottom: '0.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lesson.title}
        </div>
        <div style={{ fontSize: '0.8rem', color: '#888' }}>
          {date}
          {lesson.segment_count ? ` · ${lesson.segment_count} segments` : ''}
        </div>
        {lesson.error && (
          <div style={{ fontSize: '0.8rem', color: '#c0392b', marginTop: '0.2rem' }}>{lesson.error}</div>
        )}
      </div>
      <StatusBadge status={lesson.status} />
      {downloadUrl && (
        <a
          href={downloadUrl}
          download
          className="btn btn-primary"
          style={{ whiteSpace: 'nowrap', fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
        >
          Download
        </a>
      )}
      <button
        className="btn btn-secondary"
        style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
        onClick={() => onDelete(lesson.id)}
      >
        Delete
      </button>
    </div>
  );
}

export function AudioLessonsPage() {
  const queryClient = useQueryClient();
  const [deckId, setDeckId] = useState('');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: getDecks,
  });

  const lessonsQuery = useQuery({
    queryKey: ['audio-lessons'],
    queryFn: listAudioLessons,
  });

  const lessons = lessonsQuery.data ?? [];
  const hasInProgress = lessons.some((l) => l.status === 'pending' || l.status === 'generating');

  // Poll while any lesson is pending/generating
  useEffect(() => {
    if (hasInProgress) {
      pollingRef.current = setInterval(() => {
        queryClient.invalidateQueries({ queryKey: ['audio-lessons'] });
      }, 3000);
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [hasInProgress, queryClient]);

  const createMutation = useMutation({
    mutationFn: () => createAudioLesson({ deck_id: deckId || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audio-lessons'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAudioLesson,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['audio-lessons'] }),
  });

  const decks = decksQuery.data ?? [];

  return (
    <div className="page">
      <div className="container">
        <h1 style={{ marginBottom: '0.25rem' }}>Audio Lessons</h1>
        <p className="text-light" style={{ marginBottom: '1.5rem' }}>
          Generate downloadable MP3 lessons from your vocabulary decks for offline listening practice.
        </p>

        <div className="card mb-4">
          <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Generate New Lesson</h2>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.3rem', color: '#666' }}>
                Select deck
              </label>
              <select
                value={deckId}
                onChange={(e) => setDeckId(e.target.value)}
                className="rp-input"
                style={{ minHeight: 'auto', width: '100%' }}
              >
                <option value="">-- choose a deck --</option>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => createMutation.mutate()}
              disabled={!deckId || createMutation.isPending}
              style={{ whiteSpace: 'nowrap' }}
            >
              {createMutation.isPending ? 'Starting…' : 'Generate MP3'}
            </button>
          </div>
          {createMutation.isError && (
            <p style={{ color: '#c0392b', marginTop: '0.5rem', fontSize: '0.85rem' }}>
              {createMutation.error instanceof Error ? createMutation.error.message : 'Failed to start generation'}
            </p>
          )}
          <p style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.75rem', marginBottom: 0 }}>
            Lesson format: each word is spoken 3× slowly in Chinese, then the English meaning, then a review.
            Generation takes 1–3 minutes. Download the MP3 and listen in any podcast app.
          </p>
        </div>

        <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Your Lessons</h2>

        {lessonsQuery.isLoading && <p className="text-light">Loading…</p>}

        {lessons.length === 0 && !lessonsQuery.isLoading && (
          <p className="text-light">No lessons yet. Generate one above!</p>
        )}

        {lessons.map((lesson) => (
          <LessonRow
            key={lesson.id}
            lesson={lesson}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        ))}
      </div>
    </div>
  );
}
