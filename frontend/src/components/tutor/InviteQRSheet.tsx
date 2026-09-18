import { useEffect, useState } from 'react';
import { QRCode } from '../invites/QRCode';
import { copyTextToClipboard } from '../../utils/clipboard';
import './tutor-dashboard.css';

/**
 * Re-shows the QR + link of an existing invite ("Show invite QR again",
 * "Resend"). The invite sheet itself belongs to components/invites — this
 * only renders a link that already exists.
 */
export function InviteQRSheet({ url, title = 'Invite link', hint, onClose }: { url: string; title?: string; hint?: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async () => {
    const ok = await copyTextToClipboard(url);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  };

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <div className="td-sheet-backdrop" onClick={onClose} role="presentation">
      <div className="td-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="td-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="td-sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="td-sheet-body">
          <div className="td-qr-wrap">
            <QRCode value={url} size={220} />
            <div className="td-qr-link">{url}</div>
            <div className="td-card-actions" style={{ width: '100%', marginTop: 0 }}>
              <button type="button" className="btn btn-primary" onClick={copy}>
                {copied ? 'Copied ✓' : 'Copy link'}
              </button>
              {canShare ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => navigator.share({ title: 'Learn Chinese with me', url }).catch(() => undefined)}
                >
                  Share…
                </button>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Done
                </button>
              )}
            </div>
            {hint && <p className="td-muted" style={{ margin: 0 }}>{hint}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
