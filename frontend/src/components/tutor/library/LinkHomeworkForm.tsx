import { useEffect, useState } from 'react';
import { linkSiteName, linkThumbnail, normalizeLinkUrl, LINK_INSTRUCTIONS_MAX, LINK_TITLE_MAX } from '@shared/homework';
import { createHomeworkLink, updateHomeworkLink, type HomeworkLink } from '../../../api/homeworkLibrary';
import { getLinkPreview } from '../../../services/linkPreview';
import './homework-library.css';

/** The link card: thumbnail (YouTube) or 🔗, title, site. */
export function LinkCard({ url, title, thumbnail }: { url: string; title: string; thumbnail?: string | null }) {
  const thumb = thumbnail ?? linkThumbnail(url);
  const [failed, setFailed] = useState(false);
  return (
    <span className="hl-linkcard">
      {thumb && !failed ? <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="hl-linkcard-icon" aria-hidden="true">🔗</span>}
      <span className="hl-linkcard-main">
        <span className="hl-linkcard-title">{title || url}</span>
        <span className="hl-linkcard-site">{linkSiteName(url)}</span>
      </span>
    </span>
  );
}

/**
 * Make (or edit) a link in the tutor's OWN account — a video, a song, a clip,
 * an article — with instructions. Saving never sends it (tutor-first); the
 * caller sends it afterwards. Pasting a link fills the title from the page.
 */
export function LinkHomeworkForm({
  initial,
  submitLabel,
  onSaved,
  onCancel,
  children,
}: {
  initial?: HomeworkLink | null;
  submitLabel: string;
  onSaved: (link: HomeworkLink) => void | Promise<void>;
  onCancel?: () => void;
  /** Extra fields under the form (e.g. the due date when sending). */
  children?: React.ReactNode;
}) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [titleTouched, setTitleTouched] = useState(!!initial);
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = normalizeLinkUrl(url);

  // Fill the title from the page (YouTube title, article headline) until the tutor types one.
  useEffect(() => {
    if (!clean || titleTouched) return;
    let live = true;
    const t = setTimeout(() => {
      getLinkPreview(clean)
        .then((p) => {
          if (live && p?.title && !titleTouched) setTitle(p.title.slice(0, LINK_TITLE_MAX));
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [clean, titleTouched]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clean) return setError('Paste a web link (https://…)');
    if (!title.trim()) return setError('Give it a title');
    setBusy(true);
    setError(null);
    try {
      const body = { url: clean, title: title.trim(), instructions: instructions.trim() || null };
      const link = initial ? await updateHomeworkLink(initial.id, body) : await createHomeworkLink(body);
      await onSaved(link);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the link');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="hl-linkform" onSubmit={submit} data-testid="link-homework-form">
      <label className="hl-field">
        <span>Link</span>
        <input type="url" inputMode="url" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus={!initial} data-testid="link-url" />
      </label>
      {clean && <LinkCard url={clean} title={title} />}
      <label className="hl-field">
        <span>Title</span>
        <input
          type="text"
          maxLength={LINK_TITLE_MAX}
          placeholder="月亮代表我的心 — 邓丽君"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setTitleTouched(true);
          }}
          data-testid="link-title"
        />
      </label>
      <label className="hl-field">
        <span>Instructions</span>
        <textarea
          rows={3}
          maxLength={LINK_INSTRUCTIONS_MAX}
          placeholder="Watch the first 5 minutes and note 5 new words."
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          data-testid="link-instructions"
        />
      </label>
      {children}
      {error && <div className="td-error" role="alert">{error}</div>}
      <div className="td-confirm-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !url.trim()} data-testid="link-submit">
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>Back</button>
        )}
      </div>
      <p className="hl-muted hl-small">Only a link is saved — the video or page stays where it is and opens in their browser.</p>
    </form>
  );
}
