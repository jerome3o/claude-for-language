import { useState, useRef, useCallback, useEffect } from 'react';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
  color: string;
  lineWidth: number;
}

interface AnnotationCanvasProps {
  screenshotDataUrl: string;
  onSave: (compositedDataUrl: string) => void;
  onCancel: () => void;
}

const COLORS = [
  { value: '#ef4444', label: 'Red' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#22c55e', label: 'Green' },
  { value: '#000000', label: 'Black' },
  { value: '#ffffff', label: 'White' },
];

const LINE_WIDTHS = [
  { value: 2, label: 'Thin' },
  { value: 5, label: 'Medium' },
  { value: 10, label: 'Thick' },
];

export function AnnotationCanvas({ screenshotDataUrl, onSave, onCancel }: AnnotationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [color, setColor] = useState('#ef4444');
  const [lineWidth, setLineWidth] = useState(5);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const scaleRef = useRef(1);

  // Load the screenshot image
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
    };
    img.src = screenshotDataUrl;
  }, [screenshotDataUrl]);

  // Size the canvas to fit the container while maintaining aspect ratio
  useEffect(() => {
    if (!imageLoaded || !imageRef.current || !canvasRef.current || !containerRef.current) return;

    const img = imageRef.current;
    const container = containerRef.current;
    const canvas = canvasRef.current;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const scaleX = containerWidth / img.width;
    const scaleY = containerHeight / img.height;
    const scale = Math.min(scaleX, scaleY, 1); // Don't upscale

    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    scaleRef.current = scale;

    redraw(canvas, img, strokes, null, scale);
  }, [imageLoaded, strokes]);

  const redraw = useCallback((
    canvas: HTMLCanvasElement,
    img: HTMLImageElement,
    allStrokes: Stroke[],
    active: Stroke | null,
    scale: number,
  ) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const drawStroke = (stroke: Stroke) => {
      if (stroke.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.lineWidth * scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(stroke.points[0].x * scale, stroke.points[0].y * scale);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x * scale, stroke.points[i].y * scale);
      }
      ctx.stroke();
    };

    for (const stroke of allStrokes) {
      drawStroke(stroke);
    }
    if (active) {
      drawStroke(active);
    }
  }, []);

  // Get position relative to canvas in unscaled coordinates
  const getCanvasPoint = useCallback((clientX: number, clientY: number): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = scaleRef.current;
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
    };
  }, []);

  const startStroke = useCallback((clientX: number, clientY: number) => {
    const point = getCanvasPoint(clientX, clientY);
    if (!point) return;
    currentStrokeRef.current = { points: [point], color, lineWidth };
  }, [color, lineWidth, getCanvasPoint]);

  const continueStroke = useCallback((clientX: number, clientY: number) => {
    const prev = currentStrokeRef.current;
    if (!prev) return;
    const point = getCanvasPoint(clientX, clientY);
    if (!point) return;
    const updated = { ...prev, points: [...prev.points, point] };
    currentStrokeRef.current = updated;

    // Redraw during active drawing
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (canvas && img) {
      redraw(canvas, img, strokes, updated, scaleRef.current);
    }
  }, [getCanvasPoint, strokes, redraw]);

  const endStroke = useCallback(() => {
    const stroke = currentStrokeRef.current;
    if (stroke && stroke.points.length >= 2) {
      setStrokes(s => [...s, stroke]);
    }
    currentStrokeRef.current = null;
  }, []);

  // Mouse handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startStroke(e.clientX, e.clientY);
  }, [startStroke]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    continueStroke(e.clientX, e.clientY);
  }, [continueStroke]);

  const onMouseUp = useCallback(() => {
    endStroke();
  }, [endStroke]);

  // Touch handlers
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault(); // Prevent scrolling
    const touch = e.touches[0];
    startStroke(touch.clientX, touch.clientY);
  }, [startStroke]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault(); // Prevent scrolling
    const touch = e.touches[0];
    continueStroke(touch.clientX, touch.clientY);
  }, [continueStroke]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    endStroke();
  }, [endStroke]);

  const handleUndo = useCallback(() => {
    setStrokes(s => s.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    setStrokes([]);
  }, []);

  const handleSave = useCallback(() => {
    const img = imageRef.current;
    if (!img) return;

    // Composite at full resolution
    const offscreen = document.createElement('canvas');
    offscreen.width = img.width;
    offscreen.height = img.height;
    redraw(offscreen, img, strokes, null, 1);
    onSave(offscreen.toDataURL('image/png'));
  }, [strokes, redraw, onSave]);

  return (
    <div className="annotation-overlay">
      <div className="annotation-toolbar">
        <div className="annotation-toolbar-group">
          {COLORS.map(c => (
            <button
              key={c.value}
              className={`annotation-color-btn ${color === c.value ? 'active' : ''}`}
              style={{
                backgroundColor: c.value,
                border: c.value === '#ffffff' ? '1px solid #ccc' : '1px solid transparent',
              }}
              onClick={() => setColor(c.value)}
              aria-label={c.label}
            />
          ))}
        </div>
        <div className="annotation-toolbar-group">
          {LINE_WIDTHS.map(lw => (
            <button
              key={lw.value}
              className={`annotation-width-btn ${lineWidth === lw.value ? 'active' : ''}`}
              onClick={() => setLineWidth(lw.value)}
            >
              <span
                className="annotation-width-dot"
                style={{ width: lw.value * 2, height: lw.value * 2 }}
              />
            </button>
          ))}
        </div>
        <div className="annotation-toolbar-group">
          <button
            className="annotation-tool-btn"
            onClick={handleUndo}
            disabled={strokes.length === 0}
            aria-label="Undo"
          >
            Undo
          </button>
          <button
            className="annotation-tool-btn"
            onClick={handleClear}
            disabled={strokes.length === 0}
            aria-label="Clear"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="annotation-canvas-container" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className="annotation-canvas"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        />
      </div>

      <div className="annotation-bottom-bar">
        <button className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={handleSave}>
          Done
        </button>
      </div>
    </div>
  );
}
