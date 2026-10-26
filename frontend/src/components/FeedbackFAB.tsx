import { useState, useCallback, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useFeedback } from './feedback/FeedbackProvider';
import { isImmersiveRoute } from './nav/tabs';
import { FAB_SIZE, clampFabPosition, hasEditorBottomBar, isStudyLikePath } from './fabPosition';

const TAB_BAR_HEIGHT = 56; // keep in step with --tab-bar-height in index.css
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
  const { openFeedback } = useFeedback();

  // Position state — null means use CSS default (bottom-right)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(loadPosition);

  // Drag state refs (not in state to avoid re-renders during drag)
  const isDragging = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const fabStartPos = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);
  const fabRef = useRef<HTMLButtonElement>(null);

  // Compute default position (bottom-right with 1.5rem margin, above the
  // bottom tab bar on the pages that have one — see components/nav/TabBar)
  const tabBarVisible = isAuthenticated && (!isImmersiveRoute(location.pathname) || hasEditorBottomBar(location.pathname, window.innerWidth));
  const getDefaultPos = useCallback(() => ({
    x: window.innerWidth - FAB_SIZE - 24,
    y: window.innerHeight - FAB_SIZE - 24 - (tabBarVisible ? TAB_BAR_HEIGHT : 0),
  }), [tabBarVisible]);

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
    const pos = clampFabPosition(getPos(), { width: window.innerWidth, height: window.innerHeight });
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

  // Click/tap — only open the sheet if we didn't drag (the sheet takes the screenshot; this button
  // is left out of it, data-html2canvas-ignore).
  const handleClick = useCallback(() => {
    if (hasMoved.current) return;
    openFeedback('fab');
  }, [openFeedback]);

  if (!isAuthenticated) return null;
  // A video call fills the screen and has its own controls where the FAB would sit; so does the homework pass,
  // and a chat (its 🎤 / Send button is in that corner).
  if (/^\/(calls|homework|audio-lessons|group-class)\/[^/]+\/?$/.test(location.pathname)) return null;
  if (/^\/connections\/[^/]+\/chat\/[^/]+\/?$/.test(location.pathname)) return null;
  // 🎬 Clips: full-screen video-style feed with its own right rail.
  if (/^\/clips(\/[^/]+)?\/?$/.test(location.pathname)) return null;
  // 🥽 VR: the room has its own 💬 Feedback on the tray (with a screenshot of the 3D view).
  if (/^\/vr\/?$/.test(location.pathname)) return null;
  // 📱 Phone practice: the simulated phone fills the screen; its navigation bar is where the FAB would sit.
  if (/^\/phone\/[^/]+\/?$/.test(location.pathname)) return null;

  // Study, the tutor's "Try it" previews and the catalogue samples: keep the FAB faint, out of the card's way.
  const isStudying = isStudyLikePath(location.pathname);
  // Never over the top bar (the ✕ of a lesson / study screen, the header's
  // buttons) — not even where it was last dropped. While dragging it follows the finger.
  const pos = isDragging.current ? getPos() : clampFabPosition(getPos(), { width: window.innerWidth, height: window.innerHeight });

  return (
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
      data-html2canvas-ignore
    >
      <span className="feedback-fab-icon">💬</span>
    </button>
  );
}
