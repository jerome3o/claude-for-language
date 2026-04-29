import { useEffect, useRef, useState } from 'react';
import {
  listLessonNotes,
  createLessonNote,
  uploadLessonNoteFile,
  deleteLessonNote,
  type LessonNote,
} from '../api/client';
import './RoleplayPage.css';

export function LessonNotesPage() {
  const [notes, setNotes] = useState<LessonNote[]>([]);
  const [text, setText] = useState('');
  const [givenAt, setGivenAt] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function reload() {
    listLessonNotes()
      .then((r) => setNotes(r.notes))
      .catch((e) => setError(String(e)));
  }

  useEffect(reload, []);

  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await createLessonNote(text, givenAt || undefined);
      for (const f of files) {
        await uploadLessonNoteFile(id, f);
      }
      setText('');
      setGivenAt('');
      setFiles([]);
      if (fileInput.current) fileInput.current.value = '';
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this lesson note?')) return;
    await deleteLessonNote(id);
    reload();
  }

  return (
    <div className="roleplay-page">
      <h1>Lesson notes</h1>
      <p className="rp-sub">
        Paste whatever your tutor sends you — vocab lists, sentences, anything. The next time you
        generate grammar practice or a role-play, this will be used as context. Format doesn't
        matter.
      </p>
      {error && <div className="rp-error">{error}</div>}

      <div className="ln-form">
        <textarea
          className="rp-input"
          style={{ minHeight: '180px' }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="同学 — tóngxué — classmate&#10;同事 — tóngshì — colleague&#10;…"
          lang="zh-CN"
        />
        <input
          className="rp-input"
          style={{ minHeight: 'auto' }}
          value={givenAt}
          onChange={(e) => setGivenAt(e.target.value)}
          placeholder="When (optional, e.g. 'Tue lesson' or 2026-04-28)"
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
        <button className="rp-send" onClick={submit} disabled={!text.trim() || busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>

      <h2 style={{ marginTop: '1.5rem' }}>Past notes</h2>
      {notes.length === 0 && <p className="rp-sub">Nothing yet.</p>}
      {notes.map((n) => (
        <div key={n.id} className="rp-sit" style={{ cursor: 'default' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: '0.5rem',
            }}
          >
            <div className="rp-sit-title">{n.given_at || n.created_at.slice(0, 10)}</div>
            <button
              onClick={() => remove(n.id)}
              style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer' }}
            >
              delete
            </button>
          </div>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              margin: '0.5rem 0 0',
              fontFamily: 'inherit',
              fontSize: '0.9rem',
              maxHeight: '8rem',
              overflow: 'auto',
            }}
          >
            {n.raw_text}
          </pre>
          {n.files.length > 0 && (
            <div className="rp-sit-goal">
              {n.files.map((f) => (
                <span key={f.id} style={{ marginRight: '0.75rem' }}>
                  📎 {f.filename}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
