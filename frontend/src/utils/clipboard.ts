/**
 * Clipboard helpers that actually work in the Android app.
 *
 * The app is the PWA loaded in a Capacitor WebView. The WebView's async
 * clipboard API (navigator.clipboard.write/writeText) can RESOLVE without
 * writing anything — the page thinks it copied, the clipboard stays empty.
 * MainActivity injects a JavascriptInterface (window.AndroidClipboard) that
 * writes through Android's real ClipboardManager; prefer it whenever present.
 *
 * Fallback order:
 *   1. AndroidClipboard bridge (native app, trustworthy)
 *   2. navigator.clipboard (real browsers — Chrome PWA etc.; NEVER used
 *      inside the native app, even on old APKs without the bridge, because
 *      the WebView implementation lies)
 *   3. document.execCommand('copy') (legacy, works inside a user gesture,
 *      including in WebViews)
 */

interface AndroidClipboardBridge {
  writeText(text: string): boolean;
  writeImageBase64(base64Png: string): boolean;
}

declare global {
  interface Window {
    AndroidClipboard?: AndroidClipboardBridge;
    /** Injected by the Capacitor runtime inside the native app's WebView. */
    Capacitor?: unknown;
  }
}

/**
 * The frozen UA the APK reports. Must stay in sync with
 * android.overrideUserAgent in native/capacitor.config.json. Real Chrome on
 * any device never reports this exact string (reduced UA uses "Android 10; K"
 * and a current major version), so an exact match means we're in the app —
 * this catches old APKs where neither the bridge nor Capacitor is available.
 */
const NATIVE_APP_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel Fold) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

/** True when running inside the Android app with the clipboard bridge. */
export function hasNativeClipboard(): boolean {
  return typeof window !== 'undefined' && !!window.AndroidClipboard;
}

/**
 * True when running inside the Android app's WebView at all (with or without
 * the clipboard bridge). In that environment navigator.clipboard must never
 * be trusted.
 */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    !!window.AndroidClipboard ||
    !!window.Capacitor ||
    navigator.userAgent === NATIVE_APP_USER_AGENT
  );
}

function copyViaExecCommand(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Copy text; returns true if some path reported success. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const native = window.AndroidClipboard;
  if (native?.writeText) {
    try {
      if (native.writeText(text)) return true;
    } catch (err) {
      console.warn('[clipboard] native writeText failed', err);
    }
  }

  // navigator.clipboard is reliable in real browsers, but inside the app's
  // WebView (old APK without the bridge) it can report success while writing
  // nothing — skip it there and use execCommand, which works in a gesture.
  if (!isNativeApp() && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to execCommand
    }
  }

  return copyViaExecCommand(text);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Copy a PNG blob to the clipboard. Throws when no path can do it. */
export async function copyImageToClipboard(blob: Blob): Promise<void> {
  const native = window.AndroidClipboard;
  if (native?.writeImageBase64) {
    const base64 = await blobToBase64(blob);
    if (native.writeImageBase64(base64)) return;
    throw new Error('Native clipboard rejected the image');
  }

  // Old APK without the bridge: navigator.clipboard.write would resolve
  // without writing anything. Throw so callers fall back (e.g. to text)
  // instead of showing "Copied!" over an empty clipboard.
  if (isNativeApp()) {
    throw new Error('Image clipboard unavailable in the app — update the APK');
  }

  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('Image clipboard not supported here');
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
