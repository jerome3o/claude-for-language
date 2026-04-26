import { QueueCounts } from '../types';

const COLORS = {
  new: '#3b82f6',
  learning: '#ef4444',
  review: '#22c55e',
  separator: '#6b7280',
  background: '#ffffff',
};

/**
 * Render the new+learning+review queue counts to a PNG and write it to the
 * system clipboard so it can be pasted into chat apps.
 */
export async function copyQueueCountsImage(counts: QueueCounts): Promise<void> {
  const segments = [
    { text: String(counts.new), color: COLORS.new, weight: 600 },
    { text: ' + ', color: COLORS.separator, weight: 400 },
    { text: String(counts.learning), color: COLORS.learning, weight: 600 },
    { text: ' + ', color: COLORS.separator, weight: 400 },
    { text: String(counts.review), color: COLORS.review, weight: 600 },
  ];

  const fontSize = 48;
  const padding = 24;
  const scale = 2;
  const fontFamily =
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  const font = (weight: number) => `${weight} ${fontSize}px ${fontFamily}`;

  // Measure total width using a scratch canvas.
  const measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) throw new Error('Canvas not supported');
  let textWidth = 0;
  for (const seg of segments) {
    measureCtx.font = font(seg.weight);
    textWidth += measureCtx.measureText(seg.text).width;
  }

  const width = Math.ceil(textWidth + padding * 2);
  const height = Math.ceil(fontSize + padding * 2);

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.scale(scale, scale);

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  ctx.textBaseline = 'middle';
  let x = padding;
  const y = height / 2;
  for (const seg of segments) {
    ctx.font = font(seg.weight);
    ctx.fillStyle = seg.color;
    ctx.fillText(seg.text, x, y);
    x += ctx.measureText(seg.text).width;
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );

  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
