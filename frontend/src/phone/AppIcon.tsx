/** A simulated app's icon (fictional glyph + colours from shared/phone/copy.ts), with an unread badge. */
import { PHONE_APPS, type PhoneAppId } from '@shared/phone';

export function AppIcon({ app, size = 'normal', badge }: { app: PhoneAppId; size?: 'normal' | 'small'; badge?: number }) {
  const meta = PHONE_APPS[app];
  return (
    <span className={`ph-icon${size === 'small' ? ' ph-icon-small' : ''}`} style={{ background: `linear-gradient(145deg, ${meta.colors[0]}, ${meta.colors[1]})` }} aria-hidden>
      {meta.glyph}
      {badge ? <span className="ph-icon-badge">{badge > 99 ? '99+' : badge}</span> : null}
    </span>
  );
}
