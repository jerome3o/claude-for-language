/**
 * Screen sharing, the sharer's side (Jerome's lesson with Minghui, 5 Oct 2026):
 *
 * 1. "我听不见" — Minghui shared a browser tab with Jerome's recordings and played
 *    them; neither of them heard a thing: the share carried no sound. The share now
 *    asks for the tab's (or the system's) sound too and sends it on its own audio
 *    transceiver beside the screen's video (frontend/src/services/calls/peer.ts).
 *    The browser decides whether there is any: Chrome gives a TAB's sound when
 *    "Also share tab audio" is ticked (Windows / ChromeOS also a whole screen's);
 *    a window or screen on macOS, Safari and Firefox give none — and the Lab app
 *    can't send sound (its WebRTC takes audio from the microphone only). Then the
 *    sharer sees a note saying so ([shareAudioNote]).
 *
 * 2. "If I share my screen, I don't need to see my screen on the screen" — since
 *    "Same view" a share is on both stages. The SHARER's screen tile shows a compact
 *    card ("You're sharing your screen · Stop") instead of a mirror of their own
 *    screen; the other person still gets the share on their stage. Drawing on my
 *    own share ("✏️ Draw on it") shows it again — I can't circle what I can't see —
 *    and so does "Show it here" ([myShareTile]).
 *
 * Pure rules + words for the web call page and the Lab app
 * (`core/…/calls/CallShare.kt`, parity-tested by parity/fixtures/calls-share.ts).
 */

export type SharePlatform = 'web' | 'lab';

/** Does my share carry sound? */
export type ShareAudio = 'shared' | 'none';

/** What `getDisplayMedia` is asked for (the fields Chrome / the spec know; others ignore unknown ones). */
export interface DisplayCaptureOptions {
  video: { frameRate: { ideal: number } };
  audio:
    | false
    | {
        /** Keep playing the tab's sound for the sharer too (she hears what he hears). */
        suppressLocalAudioPlayback: boolean;
        /** Music and recordings, not a voice: no voice processing on the shared sound. */
        echoCancellation: boolean;
        noiseSuppression: boolean;
        autoGainControl: boolean;
      };
  /** Offer the whole system's sound when a screen is picked (Chrome on Windows / ChromeOS). */
  systemAudio?: 'include' | 'exclude';
  /** The picker opens on "Chrome tab" / other tabs, not on the call's own tab. */
  preferCurrentTab?: boolean;
  /** Never offer the call's own tab (a mirror in a mirror). */
  selfBrowserSurface?: 'include' | 'exclude';
  /** "Share this tab instead" while sharing a tab. */
  surfaceSwitching?: 'include' | 'exclude';
}

export const SHARE_FRAME_RATE = 15;

/**
 * The options for `navigator.mediaDevices.getDisplayMedia`. `withAudio` false = the
 * picture only (the retry for a browser that refuses an audio request outright).
 */
export function displayCaptureOptions(withAudio = true): DisplayCaptureOptions {
  const video = { frameRate: { ideal: SHARE_FRAME_RATE } };
  if (!withAudio) return { video, audio: false, preferCurrentTab: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include' };
  return {
    video,
    audio: { suppressLocalAudioPlayback: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: 'include',
    preferCurrentTab: false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
  };
}

/** A capture's sound, from how many live audio tracks it has. */
export function shareAudioOf(audioTracks: number): ShareAudio {
  return audioTracks > 0 ? 'shared' : 'none';
}

export const SHARE_AUDIO_NOTE_WEB = 'Sound isn’t shared — share a Chrome tab and tick “Also share tab audio”';
export const SHARE_AUDIO_NOTE_LAB = 'Sound isn’t shared from the app — to share sound, share a Chrome tab from a computer and tick “Also share tab audio”';
export const SHARE_AUDIO_ON = '🔊 Sound is shared too';

/** The sharer's note about sound (null = sound is shared). */
export function shareAudioNote(audio: ShareAudio, platform: SharePlatform): string | null {
  if (audio === 'shared') return null;
  return platform === 'lab' ? SHARE_AUDIO_NOTE_LAB : SHARE_AUDIO_NOTE_WEB;
}

/** The sound line on the sharer's card: on, or the note. */
export function shareAudioLine(audio: ShareAudio, platform: SharePlatform): string {
  return shareAudioNote(audio, platform) ?? SHARE_AUDIO_ON;
}

/**
 * What MY screen tile shows while I share: the compact card, or my screen itself
 * (only while I draw on it, or I asked to see it — "Show it here").
 */
export type MyShareTile = 'card' | 'full';

export function myShareTile(o: { annotating: boolean; peek: boolean }): MyShareTile {
  return o.annotating || o.peek ? 'full' : 'card';
}

// ------------------------------------------------------------------ words

export const SHARING_CARD_TITLE = 'You’re sharing your screen';
export const STOP_SHARING_LABEL = '⏹ Stop sharing';
export const SHOW_MY_SHARE_LABEL = '👁 Show it here';
export const HIDE_MY_SHARE_LABEL = 'Hide my screen';

const first = (name: string, fallback: string) => name.trim().split(/\s+/)[0] || fallback;

/** Under the card's title: who sees it (so the empty stage makes sense). */
export function sharingCardSub(otherName: string | null): string {
  return otherName && otherName.trim() ? `${first(otherName, 'They')} sees it on their screen.` : 'The other person sees it on their screen.';
}

/** The viewer's small badge on the shared screen while its sound comes through. */
export function theirShareSoundLabel(otherName: string, audio: boolean): string | null {
  if (!audio) return null;
  const n = first(otherName, '');
  return n ? `🔊 Sound from ${n}’s screen` : '🔊 Sound from the shared screen';
}
