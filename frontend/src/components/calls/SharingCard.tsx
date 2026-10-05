/**
 * What the SHARER's screen tile shows while they share (shared/calls/share.ts):
 * "You're sharing your screen · Stop" instead of a mirror of their own screen —
 * the other person still has the share on their stage. ✏️ Draw on it and
 * 👁 Show it here bring the screen itself back (drawing needs to see it).
 */

import {
  shareAudioLine,
  sharingCardSub,
  SHARING_CARD_TITLE,
  SHOW_MY_SHARE_LABEL,
  STOP_SHARING_LABEL,
  type ShareAudio,
} from '@shared/calls';

export interface SharingCardProps {
  otherName: string | null;
  audio: ShareAudio;
  onStop: () => void;
  onDraw: () => void;
  onShow: () => void;
}

export function SharingCard({ otherName, audio, onStop, onDraw, onShow }: SharingCardProps) {
  return (
    <div className="call-tile-body call-sharing-card-wrap" data-testid="sharing-card">
      <div className="call-sharing-card" role="status">
        <div className="call-sharing-icon" aria-hidden="true">🖥️</div>
        <div className="call-sharing-title">{SHARING_CARD_TITLE}</div>
        <div className="call-sharing-sub">{sharingCardSub(otherName)}</div>
        <div className={`call-sharing-audio ${audio === 'shared' ? 'on' : 'off'}`} data-testid="sharing-audio">
          {audio === 'shared' ? shareAudioLine(audio, 'web') : `🔇 ${shareAudioLine(audio, 'web')}`}
        </div>
        <div className="call-sharing-actions">
          <button type="button" className="call-sharing-stop" onClick={onStop} data-testid="sharing-stop">{STOP_SHARING_LABEL}</button>
          <button type="button" className="call-share-btn" onClick={onDraw} data-testid="sharing-draw">✏️ Draw on it</button>
          <button type="button" className="call-share-btn" onClick={onShow} data-testid="sharing-show">{SHOW_MY_SHARE_LABEL}</button>
        </div>
      </div>
    </div>
  );
}
