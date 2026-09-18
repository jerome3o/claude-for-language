/**
 * Detect in-app browsers (WeChat, Facebook, Instagram, Gmail's webview, …)
 * from the user agent. Google sign-in is blocked inside most of them and none
 * can install a PWA, so /join tells the visitor to open the link in
 * Chrome/Safari instead of letting them hit a dead end.
 */

export type InAppPlatform = 'ios' | 'android' | 'other';

export interface InAppBrowserInfo {
  /** The page is running inside another app's embedded browser. */
  inApp: boolean;
  /** Human-readable name of the host app, when recognisable. */
  name: string | null;
  platform: InAppPlatform;
}

const KNOWN_APPS: Array<[RegExp, string]> = [
  [/MicroMessenger/i, 'WeChat'],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, 'Facebook'],
  [/Instagram/i, 'Instagram'],
  [/\bLine\//i, 'LINE'],
  [/Twitter|X\/[\d.]+ \(/i, 'X'],
  [/Snapchat/i, 'Snapchat'],
  [/TikTok|musical_ly|Bytedance/i, 'TikTok'],
  [/LinkedInApp/i, 'LinkedIn'],
  [/Pinterest/i, 'Pinterest'],
  [/\bGSA\//i, 'the Google app'],
  [/\bDingTalk\b/i, 'DingTalk'],
  [/\bQQ\//i, 'QQ'],
  [/Weibo/i, 'Weibo'],
  [/Telegram/i, 'Telegram'],
];

export function detectPlatform(ua: string): InAppPlatform {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

export function detectInAppBrowser(ua: string | undefined | null = typeof navigator !== 'undefined' ? navigator.userAgent : ''): InAppBrowserInfo {
  const agent = ua || '';
  const platform = detectPlatform(agent);

  for (const [re, name] of KNOWN_APPS) {
    if (re.test(agent)) return { inApp: true, name, platform };
  }

  // Android WebView (Gmail, most other Android apps) marks itself with "; wv)"
  // and Chrome-based webviews carry "Version/x.x Chrome/…" without "wv" only
  // on very old builds, so the "wv" token is the reliable signal.
  if (platform === 'android' && /;\s*wv\)/.test(agent)) {
    return { inApp: true, name: null, platform };
  }

  // iOS: an embedded WKWebView is an "iPhone … AppleWebKit" UA with neither
  // Safari nor a known standalone browser token (CriOS = Chrome, FxiOS =
  // Firefox, EdgiOS = Edge, OPT = Opera, DuckDuckGo, Brave).
  if (platform === 'ios' && /AppleWebKit/i.test(agent) && !/Safari\//i.test(agent) && !/CriOS|FxiOS|EdgiOS|OPT\/|DuckDuckGo|Brave/i.test(agent)) {
    return { inApp: true, name: null, platform };
  }

  return { inApp: false, name: null, platform };
}

/** Which real browser to suggest for this platform. */
export function suggestedBrowser(platform: InAppPlatform): string {
  return platform === 'ios' ? 'Safari' : 'Chrome';
}
