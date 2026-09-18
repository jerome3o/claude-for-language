import { useEffect, useState } from 'react';
import QR from 'qrcode';

/**
 * A QR code rendered client-side as a data-URL image, so the link never
 * leaves the device to be drawn. Size is CSS-controlled by the parent.
 */
export function QRCode({ value, size = 220, className }: { value: string; size?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QR.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: 'M' })
      .then(url => { if (!cancelled) setSrc(url); })
      .catch(() => { if (!cancelled) setSrc(null); });
    return () => { cancelled = true; };
  }, [value, size]);

  if (!src) {
    return <div className={className} style={{ width: size, height: size }} aria-hidden="true" />;
  }
  return <img className={className} src={src} width={size} height={size} alt="QR code for the invite link" />;
}
