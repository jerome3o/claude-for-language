/**
 * /materials — lesson materials (round 4): the PDFs, PowerPoints and pictures
 * a tutor teaches from. Upload (pages are drawn on this device and uploaded
 * as pictures, the original kept), rename, delete, share with a student, and
 * /materials/:id — read it page by page (cache-first, so a material opened or
 * presented before works offline), its ☰ Contents (shared/materials/toc.ts;
 * an older upload of mine gets its Contents read from the original here),
 * its text, the original file.
 * Presenting happens in a call (⋯ → Present material).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { getMyRelationships } from '../api/client';
import { getOtherUserInRelationship } from '../types';
import {
  deleteMaterial,
  fetchPageImage,
  listMaterials,
  renameMaterial,
  shareMaterial,
  unshareMaterial,
  type MaterialInfo,
  type MaterialPageInfo,
} from '../api/materials';
import { addMaterial, type UploadStage } from '../services/materials/upload';
import { loadMaterial, pageImage, prefetchMaterial } from '../services/materials/cache';
import { backfillMaterialToc } from '../services/materials/toc';
import { MaterialContentsButton } from '../components/materials/MaterialContents';
import { MAX_MATERIAL_BYTES, materialContents } from '@shared/materials';
import './MaterialsPage.css';

const KIND_ICON: Record<string, string> = { pdf: '📄', pptx: '📊', image: '🖼️' };
const ACCEPT = '.pdf,.pptx,image/png,image/jpeg,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation';

function stageLabel(s: UploadStage): string {
  if (s.stage === 'rendering') return `Preparing page ${s.done} of ${s.total}…`;
  if (s.stage === 'uploading') return `Uploading page ${s.done + 1} of ${s.total}…`;
  return 'Finishing…';
}

export function MaterialsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<UploadStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<MaterialInfo | null>(null);
  const list = useQuery({ queryKey: ['materials'], queryFn: () => listMaterials(), retry: false });
  const rels = useQuery({ queryKey: ['nav-relationships'], queryFn: getMyRelationships, staleTime: 30_000, retry: false });
  const students = rels.data?.students ?? [];

  const upload = async (file: File) => {
    setError(null);
    try {
      const m = await addMaterial(file, { onProgress: setStage });
      await qc.invalidateQueries({ queryKey: ['materials'] });
      navigate(`/materials/${m.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setStage(null);
    }
  };

  const rename = async (m: MaterialInfo) => {
    const title = window.prompt('Title', m.title)?.trim();
    if (!title || title === m.title) return;
    await renameMaterial(m.id, title).catch((e) => setError(e instanceof Error ? e.message : 'Rename failed'));
    void qc.invalidateQueries({ queryKey: ['materials'] });
  };

  const remove = async (m: MaterialInfo) => {
    if (!window.confirm(`Delete “${m.title}”? Drawings made on it in lessons go too.`)) return;
    await deleteMaterial(m.id).catch((e) => setError(e instanceof Error ? e.message : 'Delete failed'));
    void qc.invalidateQueries({ queryKey: ['materials'] });
  };

  const materials = list.data?.materials ?? [];
  const mine = materials.filter((m) => m.mine);
  const shared = materials.filter((m) => !m.mine);

  return (
    <div className="page materials-page">
      <div className="container">
        <h1>Lesson materials</h1>
        <p className="mat-intro">PDFs, PowerPoints and pictures to teach from. Present one in a video call (⋯ → 📑 Present material): you both see it, turn the pages together and draw or type on it.</p>
        <input ref={fileRef} type="file" accept={ACCEPT} hidden data-testid="materials-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
        <button type="button" className="btn btn-primary mat-upload" disabled={!!stage} onClick={() => fileRef.current?.click()} data-testid="materials-upload">
          {stage ? stageLabel(stage) : '+ Add a PDF, PowerPoint or picture'}
        </button>
        <p className="mat-hint">Up to {Math.round(MAX_MATERIAL_BYTES / (1024 * 1024))} MB. PowerPoint slides are drawn from their text and pictures — for exact slides, export as PDF.</p>
        {error && <p className="mat-error" role="alert">{error}</p>}
        {list.isError && <p className="mat-error">Couldn’t load your materials{navigator.onLine ? '' : ' — you’re offline'}.</p>}
        {list.isLoading && <p className="mat-muted">Loading…</p>}

        {mine.length > 0 && <h2>Mine</h2>}
        <ul className="mat-list">
          {mine.map((m) => (
            <li key={m.id} className="mat-row" data-testid="material-row">
              <Link to={`/materials/${m.id}`} className="mat-main">
                <span className="mat-icon" aria-hidden="true">{KIND_ICON[m.kind] ?? '📑'}</span>
                <span className="mat-text">
                  <span className="mat-title">{m.title}</span>
                  <span className="mat-meta">
                    {m.status === 'ready' ? `${m.page_count} page${m.page_count === 1 ? '' : 's'}` : m.status === 'uploading' ? 'Upload not finished' : 'Failed'}
                    {m.shared_with?.length ? ` · shared with ${m.shared_with.length}` : ''}
                  </span>
                </span>
              </Link>
              <span className="mat-actions">
                {students.length > 0 && <button type="button" className="mat-btn" onClick={() => setSharing(m)} data-testid="material-share">Share</button>}
                <button type="button" className="mat-btn" onClick={() => void rename(m)}>Rename</button>
                <button type="button" className="mat-btn danger" onClick={() => void remove(m)} aria-label={`Delete ${m.title}`}>🗑</button>
              </span>
            </li>
          ))}
        </ul>
        {shared.length > 0 && (
          <>
            <h2>From your tutor</h2>
            <ul className="mat-list">
              {shared.map((m) => (
                <li key={m.id} className="mat-row">
                  <Link to={`/materials/${m.id}`} className="mat-main">
                    <span className="mat-icon" aria-hidden="true">{KIND_ICON[m.kind] ?? '📑'}</span>
                    <span className="mat-text">
                      <span className="mat-title">{m.title}</span>
                      <span className="mat-meta">{m.page_count} pages · from {m.owner_name ?? 'your tutor'}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {list.data && materials.length === 0 && <p className="mat-muted">Nothing here yet.</p>}
      </div>

      {sharing && user && (
        <div className="mat-sheet-backdrop" onClick={() => setSharing(null)}>
          <div className="mat-sheet" role="dialog" aria-label="Share with" onClick={(e) => e.stopPropagation()} data-testid="material-share-sheet">
            <h2>Share “{sharing.title}”</h2>
            <p className="mat-muted">They can read it and see it in calls. Presenting it in a call with them shares it automatically.</p>
            {students.map((r) => {
              const other = getOtherUserInRelationship(r, user.id);
              const on = sharing.shared_with?.includes(r.id) ?? false;
              return (
                <label key={r.id} className="mat-share-row">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={async (e) => {
                      const want = e.target.checked;
                      try {
                        if (want) await shareMaterial(sharing.id, r.id);
                        else await unshareMaterial(sharing.id, r.id);
                        const next = want ? [...(sharing.shared_with ?? []), r.id] : (sharing.shared_with ?? []).filter((x) => x !== r.id);
                        setSharing({ ...sharing, shared_with: next });
                        void qc.invalidateQueries({ queryKey: ['materials'] });
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Sharing failed');
                      }
                    }}
                  />
                  {other.name || other.email}
                </label>
              );
            })}
            <button type="button" className="btn btn-secondary" onClick={() => setSharing(null)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MaterialViewerPage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<{ material: MaterialInfo; pages: MaterialPageInfo[]; offline: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [kept, setKept] = useState<'no' | 'saving' | 'yes'>('no');
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    loadMaterial(id).then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Couldn’t load it'));
  }, [id]);

  // My own older material has no Contents yet: read it from the original once, quietly.
  const material0 = data && !data.offline ? data.material : null;
  useEffect(() => {
    if (!material0) return;
    let alive = true;
    void backfillMaterialToc(material0).then((toc) => {
      if (alive && toc) setData((d) => (d ? { ...d, material: { ...d.material, toc } } : d));
    });
    return () => {
      alive = false;
    };
  }, [material0]);

  const contents = useMemo(() => (data ? materialContents(data.material.toc, data.pages.length, data.pages) : null), [data]);

  const pageInfo = data?.pages[page];
  useEffect(() => {
    if (!pageInfo?.image_url) return;
    let alive = true;
    let objectUrl: string | null = null;
    pageImage(pageInfo.image_url)
      .then((b) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pageInfo?.image_url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!data) return;
      if (e.key === 'ArrowRight') setPage((p) => Math.min(data.pages.length - 1, p + 1));
      if (e.key === 'ArrowLeft') setPage((p) => Math.max(0, p - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data]);

  const download = async () => {
    try {
      const blob = await fetchPageImage(`/api/materials/${id}/original`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = data?.material.file_name || data?.material.title || 'material';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    }
  };

  if (error && !data) return <div className="page"><div className="container"><p className="mat-error">{error}</p><Link to="/materials">← Materials</Link></div></div>;
  if (!data) return <div className="page"><div className="container"><p className="mat-muted">Loading…</p></div></div>;
  const { material, pages } = data;
  const count = pages.length;

  return (
    <div className="page material-viewer" data-testid="material-viewer">
      <div className="container">
        <Link to="/materials" className="mat-back">← Materials</Link>
        <h1>{material.title}</h1>
        {data.offline && <p className="mat-muted">Offline — showing the copy on this device.</p>}
        {material.render_note && <p className="mat-note">{material.render_note}</p>}
        <div className="mv-bar">
          <button type="button" className="mat-btn" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page <= 0} aria-label="Previous page">‹</button>
          <span className="mv-page" data-testid="viewer-page">{count ? page + 1 : 0} / {count}</span>
          <button type="button" className="mat-btn" onClick={() => setPage((p) => Math.min(count - 1, p + 1))} disabled={page >= count - 1} aria-label="Next page">›</button>
          {contents && count > 1 && (
            <MaterialContentsButton entries={contents.entries} source={contents.source} page={page} onJump={setPage} where="viewer" buttonClassName="mat-btn mv-contents" />
          )}
        </div>
        <div className="mv-stage">
          {url ? <img src={url} alt={`Page ${page + 1}`} className="mv-img" data-testid="viewer-image" /> : <p className="mat-muted">{pageInfo?.image_url ? 'Loading page…' : 'This page has no picture.'}</p>}
        </div>
        {pageInfo?.notes && <p className="mv-notes">🗒 {pageInfo.notes}</p>}
        <div className="mv-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={kept !== 'no'}
            onClick={async () => {
              setKept('saving');
              await prefetchMaterial(pages);
              setKept('yes');
            }}
          >
            {kept === 'yes' ? '✓ On this device' : kept === 'saving' ? 'Saving…' : '⬇ Keep on this device'}
          </button>
          {material.has_text && <button type="button" className="btn btn-secondary" onClick={() => setShowText((v) => !v)}>{showText ? 'Hide text' : 'Show text'}</button>}
          {material.original_size ? <button type="button" className="btn btn-secondary" onClick={() => void download()}>Original file</button> : null}
        </div>
        {showText && <pre className="mv-text">{pageInfo?.text || '(no text on this page)'}</pre>}
        {error && <p className="mat-error">{error}</p>}
      </div>
    </div>
  );
}
