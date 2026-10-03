import { useLinkPreview } from '../../services/linkPreview';

/** The card under a message with a link (docs/CHAT.md "Round 2"). Renders nothing until there is a preview. */
export function LinkPreviewCard({ url, isOnline }: { url: string; isOnline: boolean }) {
  const p = useLinkPreview(url, isOnline);
  if (!p || (!p.title && !p.image)) return null;
  return (
    <a
      className="chat-link-preview"
      href={p.url || url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="chat-link-preview"
      onClick={(e) => e.stopPropagation()}
    >
      {p.image && <img className="chat-link-preview-img" src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => ((e.currentTarget.style.display = 'none'))} />}
      <span className="chat-link-preview-body">
        {p.site_name && <span className="chat-link-preview-site">{p.site_name}</span>}
        {p.title && <span className="chat-link-preview-title">{p.title}</span>}
        {p.description && <span className="chat-link-preview-desc">{p.description}</span>}
      </span>
    </a>
  );
}
