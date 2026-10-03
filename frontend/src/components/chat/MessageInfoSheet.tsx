import type { MessageWithSender } from '../../types';
import { formatBytes } from './FileBubble';
import { formatDuration } from '../../services/chatThread';

function when(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/**
 * Message info (round 2 PR 3): who sent it and when, edited, read by the other
 * person (from their read marker — the app knows THAT they read it, not the
 * minute), pinned, forwarded, corrected, and what is attached.
 */
export function MessageInfoSheet({ message, myId, otherName, otherReadAt, onClose }: {
  message: MessageWithSender;
  myId: string;
  otherName: string;
  otherReadAt: string | null;
  onClose: () => void;
}) {
  const mine = message.sender_id === myId;
  const att = message.attachment;
  const rows: Array<[string, string]> = [];
  rows.push(['From', mine ? 'You' : message.sender.name || 'Unknown']);
  rows.push(['Sent', when(message.created_at) ?? '—']);
  if (message.edited_at) rows.push(['Edited', when(message.edited_at) ?? 'yes']);
  if (mine) rows.push([`Read by ${otherName}`, otherReadAt && message.created_at <= otherReadAt ? 'Yes ✓✓' : 'Not yet']);
  if (message.forwarded_from) rows.push(['Forwarded', 'Yes']);
  if (message.pinned_at) rows.push(['Pinned', when(message.pinned_at) ?? 'yes']);
  if (message.correction) rows.push(['Corrected', when(message.correction.at) ?? 'yes']);
  if (att?.kind === 'image') rows.push(['Photo', `${att.width} × ${att.height} · ${formatBytes(att.bytes)}`]);
  if (att?.kind === 'voice') rows.push(['Voice', `${formatDuration(att.duration_ms)} · ${formatBytes(att.bytes)} · transcript ${att.transcript_status}`]);
  if (att?.kind === 'file') rows.push(['File', `${att.name} · ${formatBytes(att.bytes)}`]);
  if (att?.kind === 'video') rows.push(['Video', `${att.duration_ms ? formatDuration(att.duration_ms) + ' · ' : ''}${formatBytes(att.bytes)}`]);
  const text = message.content.trim();
  if (text) rows.push(['Characters', String([...text].length)]);
  if (message.reactions?.length) rows.push(['Reactions', message.reactions.map((r) => `${r.emoji} ${r.users.map((u) => u.name || '?').join(', ')}`).join(' · ')]);

  return (
    <div className="msg-sheet-overlay" onClick={onClose}>
      <div className="msg-sheet chat-info-sheet" role="dialog" aria-label="Message info" data-testid="chat-info-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="msg-sheet-handle" aria-hidden="true" />
        <div className="msg-sheet-preview">
          <span className="msg-sheet-preview-name">Message info</span>
          {text && <span className="msg-sheet-preview-text">{text.length > 120 ? text.slice(0, 120) + '…' : text}</span>}
        </div>
        <dl className="chat-info-rows">
          {rows.map(([k, v]) => (
            <div key={k} className="chat-info-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
