import { useState, useCallback, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { createFeatureRequest } from '../api/client';

const FAB_SIZE = 48;
const STORAGE_KEY = 'feedback-fab-position';

function loadPosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function savePosition(x: number, y: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x, y }));
  } catch { /* ignore */ }
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

export function FeedbackFAB() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Position state — null means use CSS default (bottom-right)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(loadPosition);

  // Drag state refs (not in state to avoid re-renders during drag)
  const isDragging = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const fabStartPos = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);
  const fabRef = useRef<HTMLButtonElement>(null);

  // Compute default position (bottom-right with 1.5rem margin)
  const getDefaultPos = useCallback(() => ({
    x: window.innerWidth - FAB_SIZE - 24,
    y: window.innerHeight - FAB_SIZE - 24,
  }), []);

  // Get effective position
  const getPos = useCallback(() => position || getDefaultPos(), [position, getDefaultPos]);

  // Keep FAB in bounds on window resize
  useEffect(() => {
    const handleResize = () => {
      setPosition(prev => {
        if (!prev) return null;
        return {
          x: clamp(prev.x, 0, window.innerWidth - FAB_SIZE),
          y: clamp(prev.y, 0, window.innerHeight - FAB_SIZE),
        };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Drag handlers
  const handleDragStart = useCallback((clientX: number, clientY: number) => {
    isDragging.current = true;
    hasMoved.current = false;
    const pos = getPos();
    dragStartPos.current = { x: clientX, y: clientY };
    fabStartPos.current = { x: pos.x, y: pos.y };
  }, [getPos]);

  const handleDragMove = useCallback((clientX: number, clientY: number) => {
    if (!isDragging.current) return;

    const dx = clientX - dragStartPos.current.x;
    const dy = clientY - dragStartPos.current.y;

    // Only count as a drag if moved more than 5px (prevents accidental drags on tap)
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      hasMoved.current = true;
    }

    if (hasMoved.current) {
      const newX = clamp(fabStartPos.current.x + dx, 0, window.innerWidth - FAB_SIZE);
      const newY = clamp(fabStartPos.current.y + dy, 0, window.innerHeight - FAB_SIZE);
      setPosition({ x: newX, y: newY });
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    if (isDragging.current && hasMoved.current) {
      // Save position after drag
      const pos = getPos();
      savePosition(pos.x, pos.y);
    }
    isDragging.current = false;
  }, [getPos]);

  // Mouse events
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    handleDragStart(e.clientX, e.clientY);

    const onMouseMove = (e: MouseEvent) => handleDragMove(e.clientX, e.clientY);
    const onMouseUp = () => {
      handleDragEnd();
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [handleDragStart, handleDragMove, handleDragEnd]);

  // Touch events
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    handleDragStart(touch.clientX, touch.clientY);
  }, [handleDragStart]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    handleDragMove(touch.clientX, touch.clientY);
    if (hasMoved.current) {
      e.preventDefault(); // Prevent scroll while dragging
    }
  }, [handleDragMove]);

  const onTouchEnd = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  // Click/tap — only open modal if we didn't drag
  const handleClick = useCallback(() => {
    if (!hasMoved.current) {
      setIsOpen(true);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!content.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await createFeatureRequest(content.trim(), location.pathname);
      setSubmitted(true);
      setContent('');
      setTimeout(() => {
        setSubmitted(false);
        setIsOpen(false);
      }, 1500);
    } catch (err) {
      console.error('Failed to submit feedback:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [content, isSubmitting, location.pathname]);

  if (!isAuthenticated) return null;

  const isStudying = location.pathname === '/study';
  const pos = getPos();

  return (
    <>
      {!isOpen && (
        <button
          ref={fabRef}
          className={`feedback-fab ${isStudying ? 'feedback-fab-subtle' : ''} ${isDragging.current ? 'feedback-fab-dragging' : ''}`}
          style={{ left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }}
          onClick={handleClick}
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          aria-label="Send feedback"
        >
          <span className="feedback-fab-icon">💬</span>
        </button>
      )}

      {isOpen && (
        <div className="feedback-modal-overlay" onClick={() => { if (!isSubmitting) setIsOpen(false); }}>
          <div className="feedback-modal" onClick={(e) => e.stopPropagation()}>
            <div className="feedback-modal-header">
              <h3>Feedback / Feature Request</h3>
              <button className="modal-close" onClick={() => setIsOpen(false)}>&times;</button>
            </div>

            {submitted ? (
              <div className="feedback-success">
                <p>Thanks! Your feedback has been submitted.</p>
              </div>
            ) : (
              <>
                <textarea
                  className="feedback-textarea"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Describe a feature you'd like or give feedback..."
                  rows={4}
                  autoFocus
                  disabled={isSubmitting}
                />
                <div className="feedback-context">
                  Page: {location.pathname}
                </div>
                <div className="feedback-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={() => setIsOpen(false)}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleSubmit}
                    disabled={!content.trim() || isSubmitting}
                  >
                    {isSubmitting ? 'Sending...' : 'Submit'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
