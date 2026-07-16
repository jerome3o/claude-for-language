import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  copyTextToClipboard,
  copyImageToClipboard,
  isNativeApp,
  hasNativeClipboard,
} from './clipboard';

const APP_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel Fold) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const CHROME_UA =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36';

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: ua,
    configurable: true,
  });
}

function setAsyncClipboard(clipboard: Partial<Clipboard> | undefined) {
  Object.defineProperty(window.navigator, 'clipboard', {
    value: clipboard,
    configurable: true,
  });
}

describe('clipboard', () => {
  let execCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setUserAgent(CHROME_UA);
    execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand as unknown as typeof document.execCommand;
  });

  afterEach(() => {
    delete window.AndroidClipboard;
    delete window.Capacitor;
    setAsyncClipboard(undefined);
    vi.restoreAllMocks();
  });

  describe('isNativeApp', () => {
    it('is false in a regular browser', () => {
      expect(isNativeApp()).toBe(false);
      expect(hasNativeClipboard()).toBe(false);
    });

    it('detects the clipboard bridge (new APK)', () => {
      window.AndroidClipboard = { writeText: () => true, writeImageBase64: () => true };
      expect(isNativeApp()).toBe(true);
      expect(hasNativeClipboard()).toBe(true);
    });

    it('detects the Capacitor runtime (old APK without the bridge)', () => {
      window.Capacitor = {};
      expect(isNativeApp()).toBe(true);
      expect(hasNativeClipboard()).toBe(false);
    });

    it('detects the frozen app user agent (old APK, no Capacitor global)', () => {
      setUserAgent(APP_UA);
      expect(isNativeApp()).toBe(true);
    });
  });

  describe('copyTextToClipboard', () => {
    it('prefers the native bridge and skips navigator.clipboard', async () => {
      const writeText = vi.fn().mockReturnValue(true);
      window.AndroidClipboard = { writeText, writeImageBase64: () => true };
      const asyncWrite = vi.fn().mockResolvedValue(undefined);
      setAsyncClipboard({ writeText: asyncWrite });

      expect(await copyTextToClipboard('hello')).toBe(true);
      expect(writeText).toHaveBeenCalledWith('hello');
      expect(asyncWrite).not.toHaveBeenCalled();
      expect(execCommand).not.toHaveBeenCalled();
    });

    it('uses navigator.clipboard in a real browser', async () => {
      const asyncWrite = vi.fn().mockResolvedValue(undefined);
      setAsyncClipboard({ writeText: asyncWrite });

      expect(await copyTextToClipboard('hello')).toBe(true);
      expect(asyncWrite).toHaveBeenCalledWith('hello');
      expect(execCommand).not.toHaveBeenCalled();
    });

    it('never trusts navigator.clipboard inside the app without the bridge', async () => {
      window.Capacitor = {};
      // The WebView clipboard resolves without writing — it must not be called.
      const asyncWrite = vi.fn().mockResolvedValue(undefined);
      setAsyncClipboard({ writeText: asyncWrite });

      expect(await copyTextToClipboard('hello')).toBe(true);
      expect(asyncWrite).not.toHaveBeenCalled();
      expect(execCommand).toHaveBeenCalledWith('copy');
    });

    it('falls back to execCommand when the bridge rejects the write', async () => {
      window.AndroidClipboard = {
        writeText: vi.fn().mockReturnValue(false),
        writeImageBase64: () => true,
      };

      expect(await copyTextToClipboard('hello')).toBe(true);
      expect(execCommand).toHaveBeenCalledWith('copy');
    });
  });

  describe('copyImageToClipboard', () => {
    const blob = new Blob(['fake-png'], { type: 'image/png' });

    it('uses the native bridge when present', async () => {
      const writeImageBase64 = vi.fn().mockReturnValue(true);
      window.AndroidClipboard = { writeText: () => true, writeImageBase64 };

      await copyImageToClipboard(blob);
      expect(writeImageBase64).toHaveBeenCalledTimes(1);
      // base64 of the blob's bytes, no data-URL prefix
      expect(writeImageBase64.mock.calls[0][0]).toBe(btoa('fake-png'));
    });

    it('throws when the bridge rejects the image', async () => {
      window.AndroidClipboard = {
        writeText: () => true,
        writeImageBase64: vi.fn().mockReturnValue(false),
      };
      await expect(copyImageToClipboard(blob)).rejects.toThrow();
    });

    it('throws inside the app without the bridge instead of lying', async () => {
      window.Capacitor = {};
      const asyncWrite = vi.fn().mockResolvedValue(undefined);
      setAsyncClipboard({ write: asyncWrite });

      await expect(copyImageToClipboard(blob)).rejects.toThrow();
      expect(asyncWrite).not.toHaveBeenCalled();
    });
  });
});
