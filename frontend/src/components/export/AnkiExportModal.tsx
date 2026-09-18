/**
 * "Export to Anki" — options, progress and result for building an .apkg from
 * a deck, a lesson or a graded reader. The heavy module (sql.js + WASM,
 * JSZip) is imported on the Export tap so it never loads with the study path.
 *
 * Works offline: clips already in the IndexedDB audio cache are bundled, the
 * rest are reported as missing and the deck is still saved.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CustomLessonSpec } from '@shared/lesson';
import type { AnkiExportProgress, AnkiExportResult } from '../../services/anki';
import './AnkiExport.css';

export type AnkiExportTarget =
  | { kind: 'deck'; deckId: string; name: string }
  | { kind: 'lesson'; spec: CustomLessonSpec; sourceId?: string }
  | { kind: 'reader'; readerId: string; title: string };

type Phase =
  | { status: 'options' }
  | { status: 'running'; progress: AnkiExportProgress | null }
  | { status: 'done'; result: AnkiExportResult }
  | { status: 'error'; message: string };

function targetTitle(target: AnkiExportTarget): string {
  switch (target.kind) {
    case 'deck': return target.name;
    case 'lesson': return target.spec.title;
    case 'reader': return target.title;
  }
}

function progressText(p: AnkiExportProgress | null): string {
  if (!p) return 'Preparing…';
  if (p.stage === 'loading') return 'Loading…';
  if (p.stage === 'audio') {
    if (p.total === 0) return 'No audio to fetch';
    return `Fetching ${p.total} audio clip${p.total === 1 ? '' : 's'}… (${p.done}/${p.total})`;
  }
  return 'Building the Anki package…';
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function AnkiExportModal({ target, onClose }: { target: AnkiExportTarget; onClose: () => void }) {
  const [includeAudio, setIncludeAudio] = useState(true);
  const [includeProgress, setIncludeProgress] = useState(false);
  const [phase, setPhase] = useState<Phase>({ status: 'options' });
  const [wasOffline, setWasOffline] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; // StrictMode runs the cleanup once before the real mount
    return () => { mounted.current = false; };
  }, []);

  const busy = phase.status === 'running';

  async function run() {
    setWasOffline(typeof navigator !== 'undefined' && !navigator.onLine);
    setPhase({ status: 'running', progress: null });
    try {
      const anki = await import('../../services/anki');
      const onProgress = (progress: AnkiExportProgress) => {
        if (mounted.current) setPhase({ status: 'running', progress });
      };
      let result: AnkiExportResult;
      if (target.kind === 'deck') {
        result = await anki.exportDeckToAnki(target.deckId, { includeAudio, includeProgress, onProgress });
      } else if (target.kind === 'lesson') {
        result = await anki.exportLessonToAnki(target.spec, { includeAudio, sourceId: target.sourceId, onProgress });
      } else {
        result = await anki.exportReaderToAnki(target.readerId, { includeAudio, onProgress });
      }
      anki.saveAnkiExport(result);
      if (mounted.current) setPhase({ status: 'done', result });
    } catch (err) {
      if (mounted.current) setPhase({ status: 'error', message: err instanceof Error ? err.message : 'Export failed' });
    }
  }

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal anki-export-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Export to Anki">
        <div className="modal-header">
          <h2 className="modal-title">Export to Anki</h2>
          <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Close">&times;</button>
        </div>
        <p className="anki-export-target">{targetTitle(target)}</p>

        {phase.status === 'options' && (
          <>
            <p className="text-light anki-export-help">
              Saves an <strong>.apkg</strong> file you can open in Anki (desktop, AnkiDroid or AnkiMobile).
              {target.kind === 'deck'
                ? ' Each word becomes one note with the same three cards as here: Hanzi → Meaning, Meaning → Hanzi and Audio → Hanzi.'
                : target.kind === 'lesson'
                  ? ' Words become vocabulary notes (three cards each), sentences become Chinese → English cards.'
                  : ' Every page becomes a Chinese → English card, and the reader’s vocabulary gets word cards.'}
              {' '}Exporting again later updates the same notes in Anki instead of duplicating them.
            </p>
            <label className="anki-export-option">
              <input type="checkbox" checked={includeAudio} onChange={e => setIncludeAudio(e.target.checked)} />
              <span>
                <span className="anki-export-option-title">Include audio</span>
                <span className="anki-export-option-sub">Bundles the pronunciation clips. Clips not cached on this device are fetched when online.</span>
              </span>
            </label>
            {target.kind === 'deck' && (
              <label className="anki-export-option">
                <input type="checkbox" checked={includeProgress} onChange={e => setIncludeProgress(e.target.checked)} />
                <span>
                  <span className="anki-export-option-title">Include review progress</span>
                  <span className="anki-export-option-sub">Approximate: intervals and due dates carry over, learning steps are treated as due today. Off = every card starts new.</span>
                </span>
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={run}>⬇ Export .apkg</button>
            </div>
          </>
        )}

        {phase.status === 'running' && (
          <div className="anki-export-progress" role="status" aria-live="polite">
            <div className="spinner" />
            <div className="anki-export-progress-text">{progressText(phase.progress)}</div>
            {phase.progress?.stage === 'audio' && phase.progress.total > 0 && (
              <div className="anki-export-bar">
                <div className="anki-export-bar-fill" style={{ width: `${Math.round((phase.progress.done / phase.progress.total) * 100)}%` }} />
              </div>
            )}
          </div>
        )}

        {phase.status === 'done' && (
          <>
            <div className="anki-export-result" role="status">
              <div className="anki-export-result-icon">✅</div>
              <div>
                <div className="anki-export-result-title">Saved <strong>{phase.result.filename}</strong></div>
                <div className="anki-export-result-sub">
                  {plural(phase.result.stats.notes, 'note')}, {plural(phase.result.stats.cards, 'card')}
                  {includeAudio && (
                    <>
                      , {plural(phase.result.stats.audioIncluded, 'audio clip')}
                      {phase.result.stats.audioMissing > 0 && ` (${phase.result.stats.audioMissing} missing)`}
                    </>
                  )}
                  {' · '}{formatBytes(phase.result.stats.bytes)}
                </div>
                {includeAudio && phase.result.stats.audioMissing > 0 && (
                  <div className="anki-export-result-note">
                    {wasOffline
                      ? `You’re offline — ${plural(phase.result.stats.audioMissing, 'clip')} weren’t cached on this device, so those cards have no audio. Export again when online to include them.`
                      : `${plural(phase.result.stats.audioMissing, 'clip')} couldn’t be fetched; those cards were exported without audio.`}
                  </div>
                )}
                <div className="anki-export-result-note">In Anki: File → Import, pick the file.</div>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}

        {phase.status === 'error' && (
          <>
            <div className="anki-export-error" role="alert">{phase.message}</div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
              <button type="button" className="btn btn-primary" onClick={run}>Try again</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** A button that opens the export modal for one target. */
export function AnkiExportButton({ target, className = 'btn btn-secondary', style, children }: {
  target: AnkiExportTarget;
  className?: string;
  style?: React.CSSProperties;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} style={style} onClick={e => { e.stopPropagation(); setOpen(true); }}>
        {children ?? '⬇ Export to Anki'}
      </button>
      {open && <AnkiExportModal target={target} onClose={() => setOpen(false)} />}
    </>
  );
}
