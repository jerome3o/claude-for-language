import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { FeedbackSheet } from './FeedbackSheet';
import { flushFeedback, isShakeEnabled, shakeBlockedOn, shakeSupported } from '../../services/feedback';
import { installMicTracker, micInUse } from '../../services/micActivity';
import { track } from '../../services/analytics';
import { initialShakeState, shakeStep, type FeedbackVia } from '@shared/feedback';

interface FeedbackApi {
  /** Opens the Send feedback sheet (after a screenshot of the page as it is now). */
  openFeedback: (via: FeedbackVia) => void;
}

const Ctx = createContext<FeedbackApi>({ openFeedback: () => {} });

export function useFeedback(): FeedbackApi {
  return useContext(Ctx);
}

/**
 * The page as it looks now, as a JPEG data URL — html2canvas (already the app's screenshot library,
 * loaded only when needed) redraws the DOM; videos, canvases and cross-origin pictures may come out
 * blank. Elements marked `data-html2canvas-ignore` (the feedback button and sheet) are left out.
 */
async function captureScreenshot(): Promise<string | null> {
  try {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(document.body, {
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight,
      x: window.scrollX,
      y: window.scrollY,
      scale: Math.min(window.devicePixelRatio || 1, 2),
      logging: false,
      useCORS: true,
    });
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch (err) {
    console.warn('[feedback] screenshot failed', err);
    return null;
  }
}

function typingInto(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * The one Send feedback sheet of the web app (docs/FEEDBACK.md), opened from More, Settings, the 💬
 * button, Shift+? on a keyboard, or by shaking a phone (Android Chrome; Settings → "Shake to send
 * feedback"; never in a call or while the microphone is recording). Queued items are sent when the
 * browser comes back online (and by every sync).
 */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState<{ via: FeedbackVia; path: string; screenshot: string | null } | null>(null);
  const opening = useRef(false);
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const isOpen = useRef(false);
  isOpen.current = !!open;

  const openFeedback = useCallback((via: FeedbackVia) => {
    if (opening.current || isOpen.current) return;
    opening.current = true;
    track('feedback.open', { via });
    void captureScreenshot().then((screenshot) => {
      opening.current = false;
      setOpen({ via, path: pathRef.current, screenshot });
    });
  }, []);

  // Shift+? — anywhere but a text box.
  useEffect(() => {
    if (!isAuthenticated) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || typingInto(e.target)) return;
      e.preventDefault();
      openFeedback('shortcut');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isAuthenticated, openFeedback]);

  // Shake (phones whose browser reports motion without asking).
  const [shakeOn, setShakeOn] = useState(() => shakeSupported() && isShakeEnabled());
  useEffect(() => {
    const onChange = () => setShakeOn(shakeSupported() && isShakeEnabled());
    window.addEventListener('feedback-shake-changed', onChange);
    return () => window.removeEventListener('feedback-shake-changed', onChange);
  }, []);
  useEffect(() => {
    if (!isAuthenticated || !shakeOn) return;
    installMicTracker();
    let state = initialShakeState();
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const r = shakeStep(state, { t: e.timeStamp || performance.now(), x: a.x, y: a.y, z: a.z });
      state = r.state;
      if (!r.shake) return;
      if (document.visibilityState !== 'visible' || shakeBlockedOn(pathRef.current) || micInUse()) return;
      openFeedback('shake');
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [isAuthenticated, shakeOn, openFeedback]);

  // Anything saved offline goes when the connection is back.
  useEffect(() => {
    if (!isAuthenticated) return;
    const onOnline = () => void flushFeedback();
    window.addEventListener('online', onOnline);
    void flushFeedback();
    return () => window.removeEventListener('online', onOnline);
  }, [isAuthenticated]);

  const close = useCallback(() => setOpen(null), []);

  return (
    <Ctx.Provider value={{ openFeedback }}>
      {children}
      {open && isAuthenticated && <FeedbackSheet via={open.via} path={open.path} screenshot={open.screenshot} onClose={close} />}
    </Ctx.Provider>
  );
}
