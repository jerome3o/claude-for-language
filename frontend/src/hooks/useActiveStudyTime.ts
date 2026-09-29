import { useEffect } from 'react';
import { noteStudyInteraction, pauseStudyTime, reportStudyTimeIfDue } from '../services/studyTime';

/**
 * Counts active study time while the study screen is mounted (docs/STUDY_SESSION.md "Time"):
 * opening it and every tap / key / scroll / wheel is an interaction; hiding the page (tab
 * switch, screen off, app backgrounded) pauses at once; coming back is an interaction;
 * leaving Study pauses and reports the day's total.
 */
export function useActiveStudyTime(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const interact = () => {
      if (document.visibilityState !== 'hidden') noteStudyInteraction();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') pauseStudyTime();
      else noteStudyInteraction();
    };
    const onHide = () => pauseStudyTime();
    interact();
    const opts: AddEventListenerOptions = { passive: true, capture: true };
    const events = ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, interact, opts));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('blur', onHide);
    window.addEventListener('focus', interact);
    return () => {
      events.forEach((e) => window.removeEventListener(e, interact, opts));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('blur', onHide);
      window.removeEventListener('focus', interact);
      pauseStudyTime();
      void reportStudyTimeIfDue(true);
    };
  }, [enabled]);
}
