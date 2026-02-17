import { useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getGradedReader,
  updateGradedReader,
  addReaderPage,
  updateReaderPage,
  deleteReaderPage,
  reorderReaderPages,
  publishReader,
  generateReaderPageText,
  generateReaderPageImage,
  getReaderImageUrl,
} from '../api/client';
import { Loading } from '../components/Loading';
import { ReaderPage, DifficultyLevel, GradedReaderWithPages } from '../types';

const DIFFICULTY_OPTIONS: { value: DifficultyLevel; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'elementary', label: 'Elementary' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

// ============ Page Editor Component ============

function PageEditor({
  page,
  readerId,
  pageIndex,
  totalPages,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  page: ReaderPage;
  readerId: string;
  pageIndex: number;
  totalPages: number;
  onUpdate: (pageId: string, data: Partial<ReaderPage>) => void;
  onDelete: (pageId: string) => void;
  onMoveUp: (pageIndex: number) => void;
  onMoveDown: (pageIndex: number) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [generatingField, setGeneratingField] = useState<string | null>(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [showAiPrompt, setShowAiPrompt] = useState<string | null>(null);

  const handleGenerateText = async (field: 'chinese' | 'pinyin' | 'english') => {
    setGeneratingField(field);
    try {
      const result = await generateReaderPageText(
        readerId,
        page.id,
        field,
        showAiPrompt === field ? aiPrompt : undefined
      );
      const fieldMap: Record<string, string> = {
        chinese: 'content_chinese',
        pinyin: 'content_pinyin',
        english: 'content_english',
      };
      onUpdate(page.id, { [fieldMap[field]]: result.text } as Partial<ReaderPage>);
      setShowAiPrompt(null);
      setAiPrompt('');
    } catch (err) {
      alert(`Failed to generate ${field}: ${(err as Error).message}`);
    } finally {
      setGeneratingField(null);
    }
  };

  const handleGenerateImage = async () => {
    if (!page.image_prompt) {
      alert('Please enter an image prompt first.');
      return;
    }
    setGeneratingImage(true);
    try {
      const result = await generateReaderPageImage(readerId, page.id);
      onUpdate(page.id, { image_url: result.image_url } as Partial<ReaderPage>);
    } catch (err) {
      alert(`Failed to generate image: ${(err as Error).message}`);
    } finally {
      setGeneratingImage(false);
    }
  };

  const imageUrl = page.image_url ? getReaderImageUrl(page.image_url) : null;

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      {/* Page header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          padding: '0.75rem 1rem',
          backgroundColor: '#f9fafb',
          borderRadius: isExpanded ? '8px 8px 0 0' : '8px',
          borderBottom: isExpanded ? '1px solid #e5e7eb' : 'none',
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>
            {isExpanded ? '▼' : '▶'}
          </span>
          <strong>Page {pageIndex + 1}</strong>
          {page.content_chinese && (
            <span style={{ color: '#6b7280', fontSize: '0.875rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
              — {page.content_chinese.slice(0, 30)}{page.content_chinese.length > 30 ? '...' : ''}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.25rem' }} onClick={(e) => e.stopPropagation()}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onMoveUp(pageIndex)}
            disabled={pageIndex === 0}
            title="Move page up"
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
          >
            ↑
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onMoveDown(pageIndex)}
            disabled={pageIndex === totalPages - 1}
            title="Move page down"
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
          >
            ↓
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (window.confirm(`Delete page ${pageIndex + 1}?`)) {
                onDelete(page.id);
              }
            }}
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: '#dc2626' }}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Page content editor */}
      {isExpanded && (
        <div style={{ padding: '1rem' }}>
          {/* Chinese text */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <label style={{ fontWeight: 500, fontSize: '0.875rem' }}>
                Chinese Text
              </label>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                {showAiPrompt === 'chinese' ? (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setShowAiPrompt(null); setAiPrompt(''); }}
                    style={{ padding: '0.125rem 0.375rem', fontSize: '0.6875rem' }}
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowAiPrompt('chinese')}
                    style={{ padding: '0.125rem 0.375rem', fontSize: '0.6875rem' }}
                  >
                    Custom Prompt
                  </button>
                )}
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => handleGenerateText('chinese')}
                  disabled={generatingField === 'chinese'}
                  style={{ padding: '0.125rem 0.375rem', fontSize: '0.6875rem' }}
                >
                  {generatingField === 'chinese' ? 'Generating...' : 'AI Generate'}
                </button>
              </div>
            </div>
            {showAiPrompt === 'chinese' && (
              <input
                type="text"
                className="form-input"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g., Write about a visit to the park..."
                style={{ marginBottom: '0.5rem', fontSize: '0.8125rem' }}
              />
            )}
            <textarea
              className="form-input"
              value={page.content_chinese}
              onChange={(e) => onUpdate(page.id, { content_chinese: e.target.value })}
              rows={3}
              placeholder="Enter Chinese text..."
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
            <p style={{ color: '#9ca3af', fontSize: '0.6875rem', margin: '0.25rem 0 0 0' }}>
              The main Chinese content for this page. Each sentence should end with 。, ！ or ？
            </p>
          </div>

          {/* Pinyin */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <label style={{ fontWeight: 500, fontSize: '0.875rem' }}>
                Pinyin
              </label>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleGenerateText('pinyin')}
                disabled={generatingField === 'pinyin' || !page.content_chinese}
                title={!page.content_chinese ? 'Add Chinese text first' : 'Auto-generate pinyin from Chinese text'}
                style={{ padding: '0.125rem 0.375rem', fontSize: '0.6875rem' }}
              >
                {generatingField === 'pinyin' ? 'Generating...' : 'Auto-generate'}
              </button>
            </div>
            <textarea
              className="form-input"
              value={page.content_pinyin}
              onChange={(e) => onUpdate(page.id, { content_pinyin: e.target.value })}
              rows={2}
              placeholder="Enter pinyin with tone marks (e.g., nǐ hǎo)..."
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
            <p style={{ color: '#9ca3af', fontSize: '0.6875rem', margin: '0.25rem 0 0 0' }}>
              Use tone marks (nǐ hǎo), not numbers (ni3 hao3). Click Auto-generate to create from Chinese text.
            </p>
          </div>

          {/* English translation */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <label style={{ fontWeight: 500, fontSize: '0.875rem' }}>
                English Translation
              </label>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleGenerateText('english')}
                disabled={generatingField === 'english' || !page.content_chinese}
                title={!page.content_chinese ? 'Add Chinese text first' : 'Auto-translate from Chinese text'}
                style={{ padding: '0.125rem 0.375rem', fontSize: '0.6875rem' }}
              >
                {generatingField === 'english' ? 'Generating...' : 'Auto-translate'}
              </button>
            </div>
            <textarea
              className="form-input"
              value={page.content_english}
              onChange={(e) => onUpdate(page.id, { content_english: e.target.value })}
              rows={2}
              placeholder="Enter English translation..."
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
            <p style={{ color: '#9ca3af', fontSize: '0.6875rem', margin: '0.25rem 0 0 0' }}>
              A natural English translation of the Chinese text. Students can reveal this while reading.
            </p>
          </div>

          {/* Image section */}
          <div>
            <label style={{ fontWeight: 500, fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' }}>
              Illustration
            </label>

            {imageUrl && (
              <div style={{ marginBottom: '0.75rem' }}>
                <img
                  src={imageUrl}
                  alt="Page illustration"
                  style={{ width: '100%', maxWidth: '300px', borderRadius: '8px', border: '1px solid #e5e7eb' }}
                />
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => onUpdate(page.id, { image_url: null })}
                  style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#dc2626' }}
                >
                  Remove Image
                </button>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <input
                  type="text"
                  className="form-input"
                  value={page.image_prompt || ''}
                  onChange={(e) => onUpdate(page.id, { image_prompt: e.target.value || null })}
                  placeholder="Describe the illustration you want..."
                  style={{ fontSize: '0.8125rem' }}
                />
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleGenerateImage}
                disabled={generatingImage || !page.image_prompt}
                style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
              >
                {generatingImage ? 'Generating...' : 'Generate Image'}
              </button>
            </div>
            <p style={{ color: '#9ca3af', fontSize: '0.6875rem', margin: '0.25rem 0 0 0' }}>
              Describe the scene for AI image generation. Be specific about characters and setting.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Preview Component ============

function ReaderPreview({ reader }: { reader: GradedReaderWithPages }) {
  const [currentPage, setCurrentPage] = useState(0);
  const [showPinyin, setShowPinyin] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);

  if (reader.pages.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
        No pages to preview. Add some pages first.
      </div>
    );
  }

  const page = reader.pages[currentPage];
  const imageUrl = page.image_url ? getReaderImageUrl(page.image_url) : null;

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
      {/* Preview header */}
      <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.5rem' }}>{reader.title_chinese}</h2>
        <p style={{ color: '#6b7280', margin: 0, fontSize: '0.875rem' }}>{reader.title_english}</p>
        <p style={{ color: '#9ca3af', margin: '0.25rem 0 0 0', fontSize: '0.75rem' }}>
          Page {currentPage + 1} of {reader.pages.length}
        </p>
      </div>

      {/* Image */}
      {imageUrl && (
        <div style={{ marginBottom: '1.5rem', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}>
          <img src={imageUrl} alt="Story illustration" style={{ width: '100%', display: 'block' }} />
        </div>
      )}

      {/* Chinese text */}
      <div style={{ fontSize: '1.5rem', lineHeight: 1.8, textAlign: 'center', marginBottom: '1rem' }}>
        {page.content_chinese || <span style={{ color: '#d1d5db', fontStyle: 'italic', fontSize: '1rem' }}>No Chinese text</span>}
      </div>

      {/* Pinyin */}
      <div
        onClick={() => setShowPinyin(!showPinyin)}
        style={{
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          cursor: 'pointer',
          textAlign: 'center',
          marginBottom: '0.75rem',
          border: '1px solid',
          transition: 'all 0.2s',
          backgroundColor: showPinyin ? '#eff6ff' : '#f9fafb',
          borderColor: showPinyin ? '#93c5fd' : '#e5e7eb',
          color: showPinyin ? '#3b82f6' : '#9ca3af',
        }}
      >
        {showPinyin ? (page.content_pinyin || 'No pinyin') : 'Tap to reveal pinyin'}
      </div>

      {/* Translation */}
      <div
        onClick={() => setShowTranslation(!showTranslation)}
        style={{
          padding: '1rem',
          borderRadius: '8px',
          cursor: 'pointer',
          textAlign: 'center',
          marginBottom: '1rem',
          border: '1px solid',
          transition: 'all 0.2s',
          backgroundColor: showTranslation ? '#f0fdf4' : '#f9fafb',
          borderColor: showTranslation ? '#86efac' : '#e5e7eb',
          color: showTranslation ? '#166534' : '#9ca3af',
        }}
      >
        {showTranslation ? (page.content_english || 'No translation') : 'Tap to reveal translation'}
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', gap: '1rem' }}>
        <button
          className="btn btn-secondary"
          onClick={() => { setCurrentPage(p => p - 1); setShowPinyin(false); setShowTranslation(false); }}
          disabled={currentPage === 0}
          style={{ flex: 1 }}
        >
          Previous
        </button>
        <button
          className="btn btn-primary"
          onClick={() => { setCurrentPage(p => p + 1); setShowPinyin(false); setShowTranslation(false); }}
          disabled={currentPage === reader.pages.length - 1}
          style={{ flex: 1 }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ============ Main Editor Page ============

export function ReaderEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, Partial<ReaderPage>>>({});

  const readerQuery = useQuery({
    queryKey: ['reader', id],
    queryFn: () => getGradedReader(id!),
    enabled: !!id,
  });

  // Save metadata
  const metadataMutation = useMutation({
    mutationFn: (data: Parameters<typeof updateGradedReader>[1]) =>
      updateGradedReader(id!, data),
    onSuccess: (data) => {
      queryClient.setQueryData(['reader', id], data);
    },
  });

  // Add page
  const addPageMutation = useMutation({
    mutationFn: () =>
      addReaderPage(id!, {
        content_chinese: '',
        content_pinyin: '',
        content_english: '',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reader', id] });
    },
  });

  // Delete page
  const deletePageMutation = useMutation({
    mutationFn: (pageId: string) => deleteReaderPage(id!, pageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reader', id] });
    },
  });

  // Reorder
  const reorderMutation = useMutation({
    mutationFn: (pageIds: string[]) => reorderReaderPages(id!, pageIds),
    onSuccess: (data) => {
      queryClient.setQueryData(['reader', id], data);
    },
  });

  // Publish
  const publishMutation = useMutation({
    mutationFn: () => publishReader(id!),
    onSuccess: (data) => {
      queryClient.setQueryData(['reader', id], data);
      queryClient.invalidateQueries({ queryKey: ['readers'] });
    },
  });

  // Handle page content updates (debounced save)
  const handlePageUpdate = useCallback((pageId: string, data: Partial<ReaderPage>) => {
    // Optimistically update the query cache
    queryClient.setQueryData(['reader', id], (old: GradedReaderWithPages | undefined) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map(p =>
          p.id === pageId ? { ...p, ...data } : p
        ),
      };
    });

    // Track pending updates
    setPendingUpdates(prev => ({
      ...prev,
      [pageId]: { ...prev[pageId], ...data },
    }));
  }, [id, queryClient]);

  // Save all pending page updates
  const saveAllChanges = useCallback(async () => {
    setSaving(true);
    try {
      const promises = Object.entries(pendingUpdates).map(([pageId, data]) =>
        updateReaderPage(id!, pageId, {
          content_chinese: data.content_chinese,
          content_pinyin: data.content_pinyin,
          content_english: data.content_english,
          image_prompt: data.image_prompt,
        })
      );
      await Promise.all(promises);
      setPendingUpdates({});
      queryClient.invalidateQueries({ queryKey: ['reader', id] });
    } catch (err) {
      alert(`Failed to save: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [id, pendingUpdates, queryClient]);

  // Move page up/down
  const handleMoveUp = useCallback((pageIndex: number) => {
    const reader = readerQuery.data;
    if (!reader || pageIndex === 0) return;
    const newPages = [...reader.pages];
    [newPages[pageIndex - 1], newPages[pageIndex]] = [newPages[pageIndex], newPages[pageIndex - 1]];
    reorderMutation.mutate(newPages.map(p => p.id));
  }, [readerQuery.data, reorderMutation]);

  const handleMoveDown = useCallback((pageIndex: number) => {
    const reader = readerQuery.data;
    if (!reader || pageIndex >= reader.pages.length - 1) return;
    const newPages = [...reader.pages];
    [newPages[pageIndex], newPages[pageIndex + 1]] = [newPages[pageIndex + 1], newPages[pageIndex]];
    reorderMutation.mutate(newPages.map(p => p.id));
  }, [readerQuery.data, reorderMutation]);

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
  const hasPendingChanges = Object.keys(pendingUpdates).length > 0;

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: '800px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Link to="/readers" style={{ color: '#3b82f6', textDecoration: 'none', fontSize: '1.25rem' }}>
              ←
            </Link>
            <h1 style={{ margin: 0, fontSize: '1.5rem' }}>
              {reader.title_chinese || 'New Reader'}
            </h1>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className={`btn ${mode === 'edit' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
              onClick={() => setMode('edit')}
            >
              Edit
            </button>
            <button
              className={`btn ${mode === 'preview' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
              onClick={() => { if (hasPendingChanges) saveAllChanges(); setMode('preview'); }}
            >
              Preview
            </button>
          </div>
        </div>

        {mode === 'preview' ? (
          <ReaderPreview reader={reader} />
        ) : (
          <>
            {/* Metadata section */}
            <div className="card" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ margin: '0 0 1rem 0' }}>Reader Details</h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ fontWeight: 500, fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' }}>
                    Chinese Title
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={reader.title_chinese}
                    onChange={(e) => metadataMutation.mutate({ title_chinese: e.target.value })}
                    placeholder="中文标题"
                  />
                </div>
                <div>
                  <label style={{ fontWeight: 500, fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' }}>
                    English Title
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={reader.title_english}
                    onChange={(e) => metadataMutation.mutate({ title_english: e.target.value })}
                    placeholder="English Title"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontWeight: 500, fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' }}>
                    Difficulty Level
                  </label>
                  <select
                    className="form-input"
                    value={reader.difficulty_level}
                    onChange={(e) => metadataMutation.mutate({ difficulty_level: e.target.value as DifficultyLevel })}
                  >
                    {DIFFICULTY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontWeight: 500, fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' }}>
                    Topic
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={reader.topic || ''}
                    onChange={(e) => metadataMutation.mutate({ topic: e.target.value || null })}
                    placeholder="e.g., Daily life, Travel..."
                  />
                </div>
              </div>
            </div>

            {/* Pages section */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>
                Pages ({reader.pages.length})
              </h3>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => addPageMutation.mutate()}
                disabled={addPageMutation.isPending}
              >
                {addPageMutation.isPending ? 'Adding...' : '+ Add Page'}
              </button>
            </div>

            {reader.pages.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                <p style={{ margin: '0 0 1rem 0' }}>No pages yet. Add your first page to get started.</p>
                <button
                  className="btn btn-primary"
                  onClick={() => addPageMutation.mutate()}
                  disabled={addPageMutation.isPending}
                >
                  Add First Page
                </button>
              </div>
            ) : (
              reader.pages.map((page, index) => (
                <PageEditor
                  key={page.id}
                  page={page}
                  readerId={id!}
                  pageIndex={index}
                  totalPages={reader.pages.length}
                  onUpdate={handlePageUpdate}
                  onDelete={(pageId) => deletePageMutation.mutate(pageId)}
                  onMoveUp={handleMoveUp}
                  onMoveDown={handleMoveDown}
                />
              ))
            )}

            {/* Bottom actions */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '1.5rem',
              paddingTop: '1.5rem',
              borderTop: '1px solid #e5e7eb',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {hasPendingChanges && (
                  <button
                    className="btn btn-primary"
                    onClick={saveAllChanges}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                )}
                <button
                  className="btn btn-secondary"
                  onClick={() => navigate(`/readers/${id}`)}
                >
                  View as Reader
                </button>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (hasPendingChanges) {
                    saveAllChanges().then(() => publishMutation.mutate());
                  } else {
                    publishMutation.mutate();
                  }
                }}
                disabled={publishMutation.isPending || reader.pages.length === 0}
              >
                {publishMutation.isPending ? 'Publishing...' : 'Publish'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
