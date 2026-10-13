import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NOTE_IMAGE_UPLOAD_PX, noteImageState } from '@shared/cards/note-image';
import { track } from '../../services/analytics';
import {
  generateNoteImage,
  pollNoteImage,
  removeNoteImage,
  uploadNoteImage,
  type NoteImageView,
} from '../../services/noteImages';
import { loadImage, outputSize, renderCrop, type SourceRect } from '../../services/profilePicture';
import { PictureCropSheet } from '../profile/PictureCropSheet';
import { NoteImage } from './NoteImage';
import './noteImage.css';

export interface NotePictureFields {
  image_key?: string | null;
  image_source?: 'generated' | 'upload' | null;
  image_status?: 'pending' | 'failed' | null;
}

/**
 * The note's picture in the edit sheet and on the card hub: ✨ Generate (↻ Regenerate), 📷 Take a
 * photo, 🖼 Choose a photo (square crop, ≤ 800 px JPEG made on the device), Remove. Acts at once —
 * not part of the sheet's Save — and writes the note's picture fields into IndexedDB so study shows
 * it straight away. While a picture is being drawn it says so and polls until it appears.
 */
export function NotePictureSection({
  noteId,
  note,
  where,
  onChange,
  heading = 'Picture',
}: {
  noteId: string;
  note: NotePictureFields;
  where: 'edit' | 'hub';
  onChange?: (fields: NotePictureFields) => void;
  heading?: string;
}) {
  const [fields, setFields] = useState<NotePictureFields>({ image_key: note.image_key ?? null, image_source: note.image_source ?? null, image_status: note.image_status ?? null });
  const [busy, setBusy] = useState<null | 'generate' | 'upload' | 'remove'>(null);
  const [error, setError] = useState<string | null>(null);
  const [cropImage, setCropImage] = useState<HTMLImageElement | null>(null);
  const [cropFromCamera, setCropFromCamera] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const state = noteImageState(fields);

  const apply = (v: NoteImageView) => {
    const next = { image_key: v.image_key, image_source: v.image_source, image_status: v.image_status };
    setFields(next);
    onChange?.(next);
  };

  // Keep polling while the picture is being drawn.
  useEffect(() => {
    if (state !== 'pending') return;
    return pollNoteImage(noteId, apply);
  }, [state, noteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const offline = typeof navigator !== 'undefined' && !navigator.onLine;

  const generate = async () => {
    const regenerate = !!fields.image_key;
    setBusy('generate');
    setError(null);
    try {
      apply(await generateNoteImage(noteId, regenerate));
      track('card.picture_generate', { regenerate, where });
    } catch (e) {
      setError(navigator.onLine ? (e instanceof Error ? e.message : 'Could not start the picture') : 'You are offline — drawing a picture needs a connection');
    } finally {
      setBusy(null);
    }
  };

  const pick = async (file: File | undefined, camera: boolean) => {
    if (!file) return;
    setError(null);
    try {
      setCropFromCamera(camera);
      setCropImage(await loadImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This photo couldn’t be opened');
    }
  };

  const closeCrop = () => {
    if (cropImage) URL.revokeObjectURL(cropImage.src);
    setCropImage(null);
  };

  const upload = async (rect: SourceRect) => {
    if (!cropImage) return;
    setBusy('upload');
    setError(null);
    try {
      const blob = await renderCrop(cropImage, rect, outputSize(rect.side, NOTE_IMAGE_UPLOAD_PX));
      apply(await uploadNoteImage(noteId, blob));
      track('card.picture_upload', { camera: cropFromCamera, where });
      closeCrop();
    } catch (e) {
      setError(navigator.onLine ? (e instanceof Error ? e.message : 'Could not upload the picture') : 'You are offline — adding a picture needs a connection');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm('Take the picture off this card?')) return;
    setBusy('remove');
    setError(null);
    try {
      apply(await removeNoteImage(noteId));
      track('card.picture_remove', { where });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the picture');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card-edit-audio-section note-picture-section" data-testid="note-picture-section">
      <h3>{heading}</h3>
      <p className="note-picture-hint">
        Shown with the English when you write the Chinese, and on the answer side of the other cards.
      </p>
      <div className="note-picture-row">
        {state === 'ready' || (state === 'pending' && fields.image_key) ? (
          <NoteImage imageKey={fields.image_key} variant="preview" testId="note-picture-preview" />
        ) : state === 'pending' ? (
          <div className="note-picture-empty note-picture-drawing" role="status" data-testid="note-picture-drawing">Drawing the picture…</div>
        ) : (
          <div className="note-picture-empty" data-testid="note-picture-empty">
            {state === 'failed' ? 'The picture couldn’t be drawn — try again' : 'No picture yet'}
          </div>
        )}
        <div className="note-picture-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={generate}
            disabled={!!busy || state === 'pending' || offline}
            title={offline ? 'Needs a connection' : undefined}
            data-testid="note-picture-generate"
          >
            {busy === 'generate' ? 'Starting…' : fields.image_key ? '↻ Regenerate' : '✨ Generate picture'}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => cameraRef.current?.click()} disabled={!!busy || offline} data-testid="note-picture-camera">
            📷 Take photo
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => pickRef.current?.click()} disabled={!!busy || offline} data-testid="note-picture-choose">
            🖼 Choose photo
          </button>
          {fields.image_key && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={remove} disabled={!!busy || offline} data-testid="note-picture-remove">
              {busy === 'remove' ? '…' : 'Remove'}
            </button>
          )}
        </div>
      </div>
      {state === 'pending' && fields.image_key && <p className="note-picture-meta" role="status">Drawing a new picture…</p>}
      {fields.image_source === 'upload' && state === 'ready' && <p className="note-picture-meta">Your own picture</p>}
      {error && <div className="inline-error" role="alert"><span className="inline-error-text">{error}</span></div>}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void pick(e.target.files?.[0], true); e.target.value = ''; }} data-testid="note-picture-camera-input" />
      <input ref={pickRef} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0], false); e.target.value = ''; }} data-testid="note-picture-file-input" />
      {cropImage && createPortal(
        <div className="note-picture-crop">
        <PictureCropSheet
          image={cropImage}
          busy={busy === 'upload'}
          error={error}
          onCancel={closeCrop}
          onConfirm={upload}
          title="Crop the picture"
          round={false}
          confirmLabel="Use this picture"
        />
        </div>,
        document.body,
      )}
    </div>
  );
}
