/**
 * File-save helpers that actually work in the Android app.
 *
 * The app is the PWA loaded in a Capacitor WebView, where the classic
 * blob-URL + <a download> trick silently does nothing — the WebView has no
 * download handler, so the export button appeared to work but no file was
 * ever saved. MainActivity injects a JavascriptInterface
 * (window.AndroidDownload) that opens Android's "Save as" dialog (Storage
 * Access Framework) so the user picks where on the phone the file goes;
 * prefer it whenever present.
 *
 * Fallback order:
 *   1. AndroidDownload bridge (native app — system save dialog)
 *   2. blob URL + <a download> (real browsers — Chrome PWA etc.)
 */

interface AndroidDownloadBridge {
  saveFile(filename: string, mimeType: string, base64Data: string): boolean;
}

declare global {
  interface Window {
    AndroidDownload?: AndroidDownloadBridge;
  }
}

/** True when running inside the Android app with the download bridge. */
export function hasNativeDownload(): boolean {
  return typeof window !== 'undefined' && !!window.AndroidDownload;
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

/**
 * Save a blob to a file the user can keep. In the native app this opens the
 * system save dialog (pick any folder); in browsers it's a normal download.
 * Throws when no path could start the save.
 */
export async function saveBlobAs(blob: Blob, filename: string): Promise<void> {
  const native = window.AndroidDownload;
  if (native?.saveFile) {
    const base64 = await blobToBase64(blob);
    const mimeType = blob.type || 'application/octet-stream';
    if (!native.saveFile(filename, mimeType, base64)) {
      throw new Error('Could not open the save dialog');
    }
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
