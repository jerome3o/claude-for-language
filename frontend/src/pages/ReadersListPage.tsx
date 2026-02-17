import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { getGradedReaders, deleteGradedReader, createBlankReader } from '../api/client';
import { Loading, EmptyState } from '../components/Loading';
import { GradedReader, DifficultyLevel } from '../types';

const DIFFICULTY_COLORS: Record<DifficultyLevel, { bg: string; text: string; label: string }> = {
  beginner: { bg: '#dcfce7', text: '#166534', label: 'Beginner' },
  elementary: { bg: '#dbeafe', text: '#1e40af', label: 'Elementary' },
  intermediate: { bg: '#fef3c7', text: '#92400e', label: 'Intermediate' },
  advanced: { bg: '#fce7f3', text: '#9d174d', label: 'Advanced' },
};

function ReaderCard({ reader, onDelete }: { reader: GradedReader; onDelete: () => void }) {
  const navigate = useNavigate();
  const difficultyStyle = DIFFICULTY_COLORS[reader.difficulty_level];
  const isGenerating = reader.status === 'generating';
  const isFailed = reader.status === 'failed';

  // Format date nicely
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
  };

  const handleClick = () => {
    if (!isGenerating && !isFailed) {
      navigate(`/readers/${reader.id}`);
    }
  };

  return (
    <div
      className="card"
      style={{
        padding: '1rem',
        opacity: isGenerating ? 0.8 : 1,
        position: 'relative',
      }}
    >
      <div
        onClick={handleClick}
        style={{ cursor: isGenerating || isFailed ? 'default' : 'pointer' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h3 style={{ fontSize: '1.25rem', margin: 0 }}>
              {isGenerating ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="spinner" style={{ width: '18px', height: '18px' }} />
                  {reader.title_chinese}
                </span>
              ) : (
                reader.title_chinese
              )}
            </h3>
          </div>
          <span
            style={{
              padding: '0.125rem 0.5rem',
              borderRadius: '1rem',
              fontSize: '0.75rem',
              backgroundColor: difficultyStyle.bg,
              color: difficultyStyle.text,
              fontWeight: 500,
            }}
          >
            {difficultyStyle.label}
          </span>
        </div>
        <p style={{ color: '#6b7280', margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>
          {reader.title_english}
        </p>
        {reader.topic && (
          <p style={{ color: '#9ca3af', margin: '0 0 0.5rem 0', fontSize: '0.75rem' }}>
            Topic: {reader.topic}
          </p>
        )}
        {isGenerating ? (
          <p style={{ color: '#3b82f6', margin: 0, fontSize: '0.75rem', fontStyle: 'italic' }}>
            Generating story and illustrations...
          </p>
        ) : isFailed ? (
          <p style={{ color: '#dc2626', margin: 0, fontSize: '0.75rem' }}>
            Generation failed
          </p>
        ) : (
          <p style={{ color: '#9ca3af', margin: 0, fontSize: '0.75rem' }}>
            {reader.vocabulary_used.length} vocabulary items &middot; {formatDate(reader.created_at)}
          </p>
        )}
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: '0.75rem',
        paddingTop: '0.75rem',
        borderTop: '1px solid #e5e7eb'
      }}>
        {isGenerating ? (
          <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>
            Generating...
          </span>
        ) : isFailed ? (
          <span style={{ color: '#dc2626', fontSize: '0.75rem' }}>
            Unable to generate
          </span>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleClick}
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.875rem' }}
            >
              Read
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={(e) => { e.stopPropagation(); navigate(`/readers/${reader.id}/edit`); }}
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.875rem' }}
            >
              Edit
            </button>
          </div>
        )}
        <button
          className="btn btn-secondary btn-sm"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem', color: '#dc2626' }}
        >
          {isGenerating ? 'Cancel' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

function CreateReaderModal({ onClose, onCreate }: { onClose: () => void; onCreate: (data: { title_chinese: string; title_english: string; difficulty_level: DifficultyLevel; topic?: string }) => void }) {
  const [titleChinese, setTitleChinese] = useState('');
  const [titleEnglish, setTitleEnglish] = useState('');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('beginner');
  const [topic, setTopic] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!titleChinese.trim() || !titleEnglish.trim()) return;
    onCreate({ title_chinese: titleChinese.trim(), title_english: titleEnglish.trim(), difficulty_level: difficulty, topic: topic.trim() || undefined });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Create New Reader</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '1rem' }}>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">Chinese Title</label>
            <input className="form-input" value={titleChinese} onChange={(e) => setTitleChinese(e.target.value)} placeholder="e.g. 小猫的冒险" required />
          </div>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">English Title</label>
            <input className="form-input" value={titleEnglish} onChange={(e) => setTitleEnglish(e.target.value)} placeholder="e.g. The Kitten's Adventure" required />
          </div>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">Difficulty</label>
            <select className="form-input" value={difficulty} onChange={(e) => setDifficulty(e.target.value as DifficultyLevel)}>
              <option value="beginner">Beginner</option>
              <option value="elementary">Elementary</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">Topic (optional)</label>
            <input className="form-input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. animals, food, travel" />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!titleChinese.trim() || !titleEnglish.trim()}>Create</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ReadersListPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const createMutation = useMutation({
    mutationFn: createBlankReader,
    onSuccess: (reader) => {
      queryClient.invalidateQueries({ queryKey: ['readers'] });
      navigate(`/readers/${reader.id}/edit`);
    },
  });

  const readersQuery = useQuery({
    queryKey: ['readers'],
    queryFn: getGradedReaders,
    // Poll every 3 seconds if there are any generating readers
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasGenerating = data?.some((r: GradedReader) => r.status === 'generating');
      return hasGenerating ? 3000 : false;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteGradedReader,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['readers'] });
    },
  });

  const handleDelete = (reader: GradedReader) => {
    const message = reader.status === 'generating'
      ? `Cancel generation of "${reader.title_english}"?`
      : `Delete "${reader.title_english}"? This cannot be undone.`;
    if (window.confirm(message)) {
      deleteMutation.mutate(reader.id);
    }
  };

  if (readersQuery.isLoading) {
    return <Loading />;
  }

  if (readersQuery.error) {
    return (
      <div className="page">
        <div className="container">
          <div className="card" style={{ textAlign: 'center', color: '#dc2626' }}>
            Failed to load readers. Please try again.
          </div>
        </div>
      </div>
    );
  }

  const readers = readersQuery.data || [];

  return (
    <div className="page">
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h1 style={{ margin: 0 }}>Graded Readers</h1>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" onClick={() => setShowCreateModal(true)}>
              Create New
            </button>
            <Link to="/readers/generate" className="btn btn-primary">
              AI Generate
            </Link>
          </div>
        </div>

        {readers.length === 0 ? (
          <EmptyState
            icon="📚"
            title="No stories yet"
            description="Generate AI-powered reading stories using vocabulary from your decks"
            action={
              <Link to="/readers/generate" className="btn btn-primary">
                Generate Your First Story
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {readers.map((reader) => (
              <ReaderCard
                key={reader.id}
                reader={reader}
                onDelete={() => handleDelete(reader)}
              />
            ))}
          </div>
        )}

        {showCreateModal && (
          <CreateReaderModal
            onClose={() => setShowCreateModal(false)}
            onCreate={(data) => {
              setShowCreateModal(false);
              createMutation.mutate(data);
            }}
          />
        )}
      </div>
    </div>
  );
}
