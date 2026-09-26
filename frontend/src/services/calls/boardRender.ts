/** Draw the call whiteboard (shared/calls/board) onto a canvas — live in the call and on the review page. */

import { BOARD_HEIGHT, BOARD_WIDTH, type BoardItem, type BoardPoint, type LiveStroke } from '@shared/calls';

function drawStroke(ctx: CanvasRenderingContext2D, points: BoardPoint[], color: string, width: number, w: number, h: number, scale: number): void {
  if (points.length === 0) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, width * scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0][0] * w, points[0][1] * h, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0][0] * w, points[0][1] * h);
  // Quadratic smoothing through midpoints — finger strokes look like ink, not polylines.
  for (let i = 1; i < points.length - 1; i++) {
    const mx = ((points[i][0] + points[i + 1][0]) / 2) * w;
    const my = ((points[i][1] + points[i + 1][1]) / 2) * h;
    ctx.quadraticCurveTo(points[i][0] * w, points[i][1] * h, mx, my);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last[0] * w, last[1] * h);
  ctx.stroke();
}

/** `w` × `h` are the canvas's CSS-pixel size (the context is already scaled for devicePixelRatio). */
export function drawBoard(ctx: CanvasRenderingContext2D, items: readonly BoardItem[], live: readonly LiveStroke[], w: number, h: number): void {
  const scale = w / BOARD_WIDTH;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  for (const item of items) {
    if (item.type === 'stroke') {
      drawStroke(ctx, item.points, item.color, item.width, w, h, scale);
    } else {
      ctx.fillStyle = item.color;
      ctx.textBaseline = 'top';
      ctx.font = `${Math.max(8, item.size * scale)}px system-ui, -apple-system, "PingFang SC", "Noto Sans SC", sans-serif`;
      const lines = item.text.split('\n');
      lines.forEach((line, i) => ctx.fillText(line, item.x * w, item.y * h + i * item.size * scale * 1.25));
    }
  }
  for (const stroke of live) drawStroke(ctx, stroke.points, stroke.color, stroke.width, w, h, scale);
}

/** The largest BOARD_WIDTH:BOARD_HEIGHT box that fits the container. */
export function fitBoard(containerW: number, containerH: number): { w: number; h: number } {
  const ratio = BOARD_WIDTH / BOARD_HEIGHT;
  if (containerW <= 0 || containerH <= 0) return { w: 0, h: 0 };
  return containerW / containerH > ratio
    ? { w: Math.floor(containerH * ratio), h: Math.floor(containerH) }
    : { w: Math.floor(containerW), h: Math.floor(containerW / ratio) };
}
