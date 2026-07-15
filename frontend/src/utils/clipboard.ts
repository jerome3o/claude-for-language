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
 *   2. navigator.clipboard (real browsers — Chrome PWA etc.)
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
  }
}

/** True when running inside the Android app with the clipboard bridge. */
export function hasNativeClipboard(): boolean {
  return typeof window !== 'undefined' && !!window.AndroidClipboard;
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

  // In the WebView (old APK without the bridge) this can lie; nothing more we
  // can do web-side there. In real browsers it's reliable.
  if (!hasNativeClipboard() && navigator.clipboard?.writeText) {
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

  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('Image clipboard not supported here');
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
