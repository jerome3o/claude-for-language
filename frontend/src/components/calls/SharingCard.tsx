/**
 * The SHARER's screen tile when it doesn't show the screen itself (shared/calls/share.ts
 * `myShareTile`): after "Hide my screen", or for a whole screen (shown here it would mirror
 * itself). "You're sharing your screen · Stop" — the other person still has the share on their
 * stage. ✏️ Draw on it and 👁 Show it here bring the screen itself back.
 */

import {
  shareAudioLine,
  sharingCardSub,
  MIRROR_NOTE,
  SHARING_CARD_TITLE,
  SHOW_MY_SHARE_LABEL,
  STOP_SHARING_LABEL,
  type ShareAudio,
} from '@shared/calls';

export interface SharingCardProps {
  otherName: string | null;
  audio: ShareAudio;
  /** A whole screen is shared: say why it isn't shown here. */
  wholeScreen?: boolean;
  onStop: () => void;
  onDraw: () => void;
  onShow: () => void;
}

export function SharingCard({ otherName, audio, wholeScreen, onStop, onDraw, onShow }: SharingCardProps) {
  return (
    <div className="call-tile-body call-sharing-card-wrap" data-testid="sharing-card">
      <div className="call-sharing-card" role="status">
        <div className="call-sharing-icon" aria-hidden="true">🖥️</div>
        <div className="call-sharing-title">{SHARING_CARD_TITLE}</div>
        <div className="call-sharing-sub">{sharingCardSub(otherName)}</div>
        {wholeScreen && <div className="call-sharing-sub" data-testid="sharing-mirror-note">{MIRROR_NOTE}</div>}
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
