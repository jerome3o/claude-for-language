/**
 * A lesson material presented in the call (round 4): the current page's
 * picture (from this device's cache when it has it — services/materials/cache),
 * page turns both people share (‹ ›, ← / → keys), and the same Pen / Text
 * annotation layer as a shared screen, scoped to this page (kept per page per
 * lesson by the room). The next page is fetched ahead so turning is instant.
 * ☰ Contents (round 6, shared/materials/toc.ts) jumps to a section — a
 * page turn like ‹ ›, so both people go there.
 */

import { useEffect, useMemo, useState } from 'react';
import { ANNOT_COLORS, type AnnotStroke, type AnnotText, type VideoSize } from '@shared/calls';
import { materialContents, type MaterialTocEntry, type PresentedMaterial } from '@shared/materials';
import type { MaterialPageInfo } from '../../api/materials';
import { loadMaterial, pageImage, prefetchMaterial } from '../../services/materials/cache';
import { MaterialContentsButton } from '../materials/MaterialContents';
import type { AnnotationStore } from '../../services/calls/annotations';
import { AnnotationLayer, type AnnotTool } from './AnnotationLayer';

interface Props {
  presenting: PresentedMaterial;
  store: AnnotationStore;
  persist: boolean;
  onPersist: (keep: boolean) => void;
  myColor: string;
  onTurn: (page: number) => void;
  onStop: () => void;
  annot: { stroke: (s: AnnotStroke) => void; ping: (x: number, y: number) => void; text: (t: AnnotText) => void; deleteText: (id: string) => void; clear: () => void };
  /** The material tile is on the stage (keys turn its pages). */
  active: boolean;
}

export function MaterialTile({ presenting, store, persist, onPersist, myColor, onTurn, onStop, annot, active }: Props) {
  const [pages, setPages] = useState<MaterialPageInfo[] | null>(null);
  const [toc, setToc] = useState<MaterialTocEntry[] | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<VideoSize | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState<AnnotTool>('pen');
  const [color, setColor] = useState<string | null>(null);
  const pen = color ?? myColor;
  const { material_id: id, page, page_count: count } = presenting;

  useEffect(() => {
    let alive = true;
    setPages(null);
    setToc(null);
    loadMaterial(id)
      .then((r) => {
        if (!alive) return;
        setPages(r.pages);
        setToc(r.material.toc ?? null);
        void prefetchMaterial(r.pages); // the whole material on this device for later / offline
      })
      .catch(() => alive && setPages([]));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setError(null);
    const imageUrl = `/api/materials/${id}/pages/${page}/image`;
    pageImage(imageUrl)
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => alive && setError('Couldn’t load this page'));
    if (page + 1 < count) void pageImage(`/api/materials/${id}/pages/${page + 1}/image`).catch(() => {});
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, page, count]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') onTurn(Math.min(count - 1, page + 1));
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') onTurn(Math.max(0, page - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, page, count, onTurn]);

  const meta = pages?.[page];
  const contents = useMemo(() => (pages ? materialContents(toc, count, pages) : null), [toc, count, pages]);
  return (
    <div className="call-tile-body mt" data-testid="material-tile">
      <div className="mt-bar">
        <span className="mt-title" title={presenting.title}>📑 {presenting.title}</span>
        {contents && count > 1 && (
          <MaterialContentsButton entries={contents.entries} source={contents.source} page={page} onJump={onTurn} where="call" buttonClassName="mt-btn mt-contents" />
        )}
        <button type="button" className="mt-btn" onClick={() => onTurn(Math.max(0, page - 1))} disabled={page <= 0} aria-label="Previous page" data-testid="material-prev">‹</button>
        <span className="mt-page" data-testid="material-page">{page + 1} / {count}</span>
        <button type="button" className="mt-btn" onClick={() => onTurn(Math.min(count - 1, page + 1))} disabled={page >= count - 1} aria-label="Next page" data-testid="material-next">›</button>
        <button type="button" className={`mt-btn mt-draw${drawing ? ' on' : ''}`} onClick={() => setDrawing((v) => !v)} data-testid="material-draw">{drawing ? '✓ Done' : '✏️ Draw / type'}</button>
        <button type="button" className="mt-btn mt-stop" onClick={onStop} data-testid="material-stop" title="Stop presenting (for both)">✕</button>
      </div>
      <div className="mt-stage">
        {url && <img src={url} alt={`Page ${page + 1} of ${presenting.title}`} className="mt-img" onLoad={(e) => setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} data-testid="material-image" />}
        {!url && !error && <div className="mt-loading">Loading page {page + 1}…</div>}
        {error && <div className="mt-loading">{error}</div>}
        <AnnotationLayer
          store={store}
          video={size}
          interactive={drawing}
          color={pen}
          tool={tool}
          onStroke={annot.stroke}
          onPing={annot.ping}
          onText={annot.text}
          onTextDelete={annot.deleteText}
          className="annot-over-material"
          testId="annot-material"
        />
      </div>
      {drawing && (
        <div className="mt-tools annot-tools" data-testid="material-tools">
          <span className="annot-toolset" role="radiogroup" aria-label="Tool">
            <button type="button" role="radio" aria-checked={tool === 'pen'} className={`annot-tool${tool === 'pen' ? ' on' : ''}`} onClick={() => setTool('pen')}>✏️ Pen</button>
            <button type="button" role="radio" aria-checked={tool === 'text'} className={`annot-tool${tool === 'text' ? ' on' : ''}`} onClick={() => setTool('text')} data-testid="material-tool-text">T Text</button>
          </span>
          {ANNOT_COLORS.map((c) => (
            <button key={c} type="button" className={`annot-swatch${c === pen ? ' active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Colour ${c}`} />
          ))}
          <button type="button" className="annot-clear" onClick={annot.clear}>Clear</button>
          <label className="annot-keep" title="Keep drawings and text on this page (saved with the lesson)">
            <input type="checkbox" checked={persist} onChange={(e) => onPersist(e.target.checked)} /> Keep
          </label>
        </div>
      )}
      {meta?.notes && <div className="mt-notes" title="Speaker notes">🗒 {meta.notes}</div>}
    </div>
  );
}
