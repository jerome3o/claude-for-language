/**
 * Where the desktop app points. The app is the deployed web app (the same
 * origin as the PWA and the Android shell, native/capacitor.config.json) in a
 * window, so a web deploy updates it with no new desktop release. For testing
 * against a local or preview build: CHINESE_LEARNING_URL / CHINESE_LEARNING_API.
 */

export const APP_URL = (process.env.CHINESE_LEARNING_URL || 'https://chinese-learning-2x9.pages.dev').replace(/\/+$/, '');
export const API_URL = (process.env.CHINESE_LEARNING_API || 'https://chinese-learning-api.jeromeswannack.workers.dev').replace(/\/+$/, '');

export const APP_ORIGIN = new URL(APP_URL).origin;
export const API_ORIGIN = new URL(API_URL).origin;

/** The GitHub repo whose `desktop-v*` pre-releases carry new versions. */
export const RELEASES_API = 'https://api.github.com/repos/jerome3o/claude-for-language/releases?per_page=30';

/** macOS: the Screen Recording pane of System Settings. */
export const MAC_SCREEN_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
