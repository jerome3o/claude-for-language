import { describe, it, expect } from 'vitest';
import { detectInAppBrowser, suggestedBrowser } from './inAppBrowser';

const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 9 Pro Fold) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1';
const DESKTOP_CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const WECHAT_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-S911B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 XWEB/1160065 MMWEBSDK/20231202 MMWEBID/4632 MicroMessenger/8.0.47.2560(0x28002F35) WeChat/arm64';
const WECHAT_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.44(0x18002c2f) NetType/WIFI Language/zh_CN';
const GMAIL_ANDROID_WEBVIEW = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240405.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36';
const GMAIL_IOS_WEBVIEW = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const FACEBOOK_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/430.0.0.32.113;FBBV/525623098;FBDV/iPhone15,3]';
const INSTAGRAM_ANDROID = 'Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/117.0.0.0 Mobile Safari/537.36 Instagram 302.0.0.23.113 Android';

describe('detectInAppBrowser', () => {
  it('treats real browsers as not in-app', () => {
    expect(detectInAppBrowser(CHROME_ANDROID)).toEqual({ inApp: false, name: null, platform: 'android' });
    expect(detectInAppBrowser(SAFARI_IOS)).toEqual({ inApp: false, name: null, platform: 'ios' });
    expect(detectInAppBrowser(CHROME_IOS)).toEqual({ inApp: false, name: null, platform: 'ios' });
    expect(detectInAppBrowser(DESKTOP_CHROME)).toEqual({ inApp: false, name: null, platform: 'other' });
  });

  it('recognises WeChat on both platforms', () => {
    expect(detectInAppBrowser(WECHAT_ANDROID)).toEqual({ inApp: true, name: 'WeChat', platform: 'android' });
    expect(detectInAppBrowser(WECHAT_IOS)).toEqual({ inApp: true, name: 'WeChat', platform: 'ios' });
  });

  it('recognises Facebook and Instagram', () => {
    expect(detectInAppBrowser(FACEBOOK_IOS).name).toBe('Facebook');
    expect(detectInAppBrowser(INSTAGRAM_ANDROID).name).toBe('Instagram');
  });

  it('flags an anonymous Android webview (Gmail) via the wv token', () => {
    expect(detectInAppBrowser(GMAIL_ANDROID_WEBVIEW)).toEqual({ inApp: true, name: null, platform: 'android' });
  });

  it('flags an anonymous iOS webview (no Safari token, no known browser)', () => {
    expect(detectInAppBrowser(GMAIL_IOS_WEBVIEW)).toEqual({ inApp: true, name: null, platform: 'ios' });
  });

  it('copes with an empty or missing user agent', () => {
    expect(detectInAppBrowser('')).toEqual({ inApp: false, name: null, platform: 'other' });
    expect(detectInAppBrowser(null)).toEqual({ inApp: false, name: null, platform: 'other' });
  });

  it('suggests Safari on iOS and Chrome elsewhere', () => {
    expect(suggestedBrowser('ios')).toBe('Safari');
    expect(suggestedBrowser('android')).toBe('Chrome');
    expect(suggestedBrowser('other')).toBe('Chrome');
  });
});
