/**
 * "Present material" in a call (round 4): pick one of my lesson materials (or
 * one shared with me) — or add a PDF / PowerPoint / picture right here — and
 * both people see it as a tile, page turns shared.
 */

import { useEffect, useRef, useState } from 'react';
import { listMaterials, type MaterialInfo } from '../../api/materials';
import { addMaterial, type UploadStage } from '../../services/materials/upload';
import { track } from '../../services/analytics';

const KIND_ICON: Record<string, string> = { pdf: '📄', pptx: '📊', image: '🖼️' };

export function PresentMaterialSheet({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const [list, setList] = useState<MaterialInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<UploadStage | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listMaterials()
      .then((r) => setList(r.materials.filter((m) => m.status === 'ready')))
      .catch((e) => setError(e instanceof Error ? e.message : 'Couldn’t load your materials'));
  }, []);

  const upload = async (file: File) => {
    setError(null);
    try {
      const m = await addMaterial(file, { onProgress: setStage });
      track('call.material_present', { material_kind: m.kind, pages: m.page_count });
      onPick(m.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setStage(null);
    }
  };

  return (
    <div className="call-sheet-backdrop" onClick={onClose}>
      <div className="call-sheet pm-sheet" role="dialog" aria-label="Present a material" onClick={(e) => e.stopPropagation()} data-testid="present-material-sheet">
        <div className="pm-head">
          <h2>Present a material</h2>
          <button type="button" className="call-panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="call-muted">Both of you see it; either of you can turn the pages, draw and type on it.</p>
        {list === null && !error && <p className="call-muted">Loading…</p>}
        {list && list.length === 0 && <p className="call-muted">No materials yet — add one below.</p>}
        <div className="pm-list">
          {(list ?? []).map((m) => (
            <button key={m.id} type="button" className="pm-row" onClick={() => { track('call.material_present', { material_kind: m.kind, pages: m.page_count }); onPick(m.id); }} data-testid="present-material-row">
              <span className="pm-icon" aria-hidden="true">{KIND_ICON[m.kind] ?? '📑'}</span>
              <span className="pm-main">
                <span className="pm-title">{m.title}</span>
                <span className="pm-meta">{m.page_count} page{m.page_count === 1 ? '' : 's'}{m.mine ? '' : ` · from ${m.owner_name ?? 'your tutor'}`}</span>
              </span>
            </button>
          ))}
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.pptx,image/png,image/jpeg,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation" hidden data-testid="present-material-file" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        <button type="button" className="btn btn-secondary pm-add" disabled={!!stage} onClick={() => fileRef.current?.click()}>
          {stage
            ? stage.stage === 'rendering'
              ? `Preparing page ${stage.done} of ${stage.total}…`
              : stage.stage === 'uploading'
                ? `Uploading page ${stage.done + 1} of ${stage.total}…`
                : 'Finishing…'
            : '+ Add a PDF, PowerPoint or picture'}
        </button>
        {error && <p className="cr-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
