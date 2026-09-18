import { useCallback, useSyncExternalStore } from 'react';
import { detectPlatform } from '../../utils/inAppBrowser';

/**
 * Android's `beforeinstallprompt` fires once, early — usually before any
 * page component mounts — so it is captured at module level (this module is
 * imported by the eagerly loaded HomePage) and handed to whoever asks later.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedFlag = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(l => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installedFlag = true;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (installedFlag) return true;
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch { /* ignore */ }
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export interface InstallPromptState {
  /** The app is already running from the home screen. */
  installed: boolean;
  /** Android Chrome handed us the install prompt — `prompt()` will open it. */
  canPrompt: boolean;
  platform: 'ios' | 'android' | 'other';
  prompt: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

/** Live view of the PWA install state, for the "Add to home screen" checklist row. */
export function useInstallPrompt(): InstallPromptState {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => `${deferredPrompt ? 1 : 0}:${installedFlag ? 1 : 0}`,
    () => '0:0'
  );
  const canPrompt = snapshot.startsWith('1');

  const prompt = useCallback(async () => {
    const ev = deferredPrompt;
    if (!ev) return 'unavailable' as const;
    try {
      await ev.prompt();
      const choice = await ev.userChoice;
      if (choice.outcome === 'accepted') {
        deferredPrompt = null;
        notify();
      }
      return choice.outcome;
    } catch {
      return 'unavailable' as const;
    }
  }, []);

  return {
    installed: isStandalone(),
    canPrompt,
    platform: detectPlatform(typeof navigator !== 'undefined' ? navigator.userAgent : ''),
    prompt,
  };
}
