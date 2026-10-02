/**
 * Getting the camera and microphone for a call — and saying exactly what went
 * wrong when we can't. A call never depends on it: without a camera you join
 * with audio, without a microphone you join to listen and watch, and either
 * can be turned on later from the call bar.
 *
 * getUserMedia's errors, by what the person has to do about them:
 * - `blocked`    NotAllowedError — this site is blocked in the browser (or by
 *                the organisation's policy on a work computer): allow it in the
 *                site settings.
 * - `system`     NotAllowedError "…by system" — the operating system stops the
 *                browser using the camera / mic (macOS Privacy & Security,
 *                Windows privacy settings).
 * - `dismissed`  the prompt was closed without an answer: just try again.
 * - `in-use`     NotReadableError / AbortError — another app (Teams, Zoom…)
 *                has the camera, or the driver failed.
 * - `no-device`  NotFoundError / OverconstrainedError — nothing plugged in.
 * - `insecure`   no mediaDevices (http, or a very old browser).
 * - `waiting`    no answer after a few seconds — the prompt may be hidden
 *                behind an icon in the address bar.
 */

export type MediaProblem = 'blocked' | 'system' | 'dismissed' | 'in-use' | 'no-device' | 'insecure' | 'waiting' | 'unknown';
export type BrowserKind = 'chrome' | 'edge' | 'firefox' | 'safari' | 'samsung' | 'other';
export type DeviceKind = 'camera' | 'microphone' | 'both';

export function classifyMediaError(err: unknown): MediaProblem {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  const message = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      if (/system/i.test(message)) return 'system';
      if (/dismiss/i.test(message)) return 'dismissed';
      return 'blocked';
    case 'SecurityError':
      return 'blocked';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'in-use';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'no-device';
    case 'TypeError':
      return 'insecure';
    default:
      return 'unknown';
  }
}

export function detectBrowser(ua: string): BrowserKind {
  if (/Edg\//.test(ua)) return 'edge';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

export function detectOs(ua: string): 'mac' | 'windows' | 'android' | 'ios' | 'other' {
  if (/Android/.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Mac OS X|Macintosh/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  return 'other';
}

export interface MediaHelp {
  title: string;
  /** Plain steps, in order. */
  steps: string[];
  /** "Try again" makes sense (asks the browser again, from a tap). */
  canRetry: boolean;
}

function deviceWords(device: DeviceKind): { noun: string; nouns: string } {
  if (device === 'camera') return { noun: 'camera', nouns: 'Camera' };
  if (device === 'microphone') return { noun: 'microphone', nouns: 'Microphone' };
  return { noun: 'camera and microphone', nouns: 'Camera and Microphone' };
}

/** What to tell the person, for this problem, browser and device. */
export function mediaHelp(problem: MediaProblem, device: DeviceKind, ua: string): MediaHelp {
  const browser = detectBrowser(ua);
  const os = detectOs(ua);
  const { noun, nouns } = deviceWords(device);
  switch (problem) {
    case 'blocked': {
      const steps =
        browser === 'firefox'
          ? [`Click the crossed-out ${noun} icon at the left of the address bar.`, 'Remove “Blocked temporarily” / “Blocked”, then press Try again and choose Allow.']
          : browser === 'safari'
            ? ['Open Safari → Settings for This Website (or Safari → Settings → Websites).', `Set ${nouns} to Allow, then press Try again.`]
            : os === 'android'
              ? ['Tap the icon at the left of the address bar → Permissions (or Site settings).', `Turn on ${nouns}, then tap Try again.`]
              : [
                  `Click the icon at the left of the address bar (🔒 or ⚙ “site settings”) — or the crossed-out ${noun} icon at its right.`,
                  `Set ${nouns} to Allow, then press Try again (reload the page if nothing changes).`,
                  'On a work computer your organisation may block it — then join without them, or use your phone.',
                ];
      return { title: `Your browser is blocking the ${noun} for this site`, steps, canRetry: true };
    }
    case 'system': {
      const steps =
        os === 'mac'
          ? [`Open  → System Settings → Privacy & Security → ${device === 'microphone' ? 'Microphone' : 'Camera'}${device === 'both' ? ' (and Microphone)' : ''}.`, `Turn on ${browser === 'other' ? 'your browser' : browser === 'edge' ? 'Microsoft Edge' : browser[0].toUpperCase() + browser.slice(1)}, restart the browser, then Try again.`]
          : os === 'windows'
            ? [`Open Settings → Privacy & security → ${device === 'microphone' ? 'Microphone' : 'Camera'}${device === 'both' ? ' (and Microphone)' : ''}.`, 'Turn on access and “Let desktop apps access…”, then Try again.']
            : [`Your device’s settings stop the browser using the ${noun}. Allow it there, then Try again.`];
      return { title: `Your computer isn’t letting the browser use the ${noun}`, steps, canRetry: true };
    }
    case 'dismissed':
      return { title: `The ${noun} request was closed`, steps: [`Press Try again and choose Allow when the browser asks.`], canRetry: true };
    case 'in-use':
      return {
        title: `The ${noun} is busy`,
        steps: [`Another app (Teams, Zoom, another tab…) may be using the ${noun}. Close it, then Try again.`],
        canRetry: true,
      };
    case 'no-device':
      return { title: `No ${noun} found`, steps: [`Plug one in (or pick another in Devices), then Try again.`], canRetry: true };
    case 'insecure':
      return { title: 'This browser can’t use a camera here', steps: ['Open the app from its https:// address in an up-to-date Chrome, Edge, Firefox or Safari.'], canRetry: false };
    case 'waiting':
      return {
        title: `Waiting for you to allow the ${noun}`,
        steps: [
          browser === 'safari' ? 'Look for the prompt under the address bar.' : `Look for the prompt near the address bar — or a small ${noun} icon at its right edge; click it and choose Allow.`,
          'No prompt at all? Press Try again, or join without them and turn them on later.',
        ],
        canRetry: true,
      };
    default:
      return { title: `Couldn’t open the ${noun}`, steps: ['Press Try again. If it keeps failing, join without it.'], canRetry: true };
  }
}

// ------------------------------------------------------------------ acquiring

export const AUDIO_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

export function videoConstraints(facing: 'user' | 'environment', deviceId?: string | null): MediaTrackConstraints {
  const base: MediaTrackConstraints = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } };
  return deviceId ? { ...base, deviceId: { exact: deviceId } } : { ...base, facingMode: facing };
}

export function audioConstraints(deviceId?: string | null): MediaTrackConstraints {
  return deviceId ? { ...AUDIO_CONSTRAINTS, deviceId: { exact: deviceId } } : AUDIO_CONSTRAINTS;
}

export interface MediaResult {
  stream: MediaStream | null;
  audioProblem: MediaProblem | null;
  videoProblem: MediaProblem | null;
}

type GetUserMedia = (c: MediaStreamConstraints) => Promise<MediaStream>;

/**
 * Camera + mic together (one prompt); when that fails, each on its own, so a
 * blocked camera still gives a microphone and vice versa. A device id that no
 * longer exists falls back to the default device.
 */
export async function acquireMedia(
  want: { audio: boolean; video: boolean },
  prefs: { audioId?: string | null; videoId?: string | null; facing?: 'user' | 'environment' } = {},
  gum: GetUserMedia | null = typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia ? (c) => navigator.mediaDevices.getUserMedia(c) : null,
): Promise<MediaResult> {
  if (!gum) return { stream: null, audioProblem: want.audio ? 'insecure' : null, videoProblem: want.video ? 'insecure' : null };
  const facing = prefs.facing ?? 'user';
  const one = async (kind: 'audio' | 'video'): Promise<{ track: MediaStreamTrack | null; problem: MediaProblem | null }> => {
    const ids = kind === 'audio' ? [prefs.audioId, null] : [prefs.videoId, null];
    let problem: MediaProblem | null = null;
    for (const id of ids.filter((x, i) => i === ids.length - 1 || !!x)) {
      try {
        const s = await gum(kind === 'audio' ? { audio: audioConstraints(id) } : { video: videoConstraints(facing, id) });
        return { track: (kind === 'audio' ? s.getAudioTracks() : s.getVideoTracks())[0] ?? null, problem: null };
      } catch (err) {
        problem = classifyMediaError(err);
        if (problem !== 'no-device') break; // only a vanished device id is worth a retry with the default
      }
    }
    return { track: null, problem };
  };

  if (want.audio && want.video) {
    try {
      const s = await gum({ audio: audioConstraints(prefs.audioId), video: videoConstraints(facing, prefs.videoId) });
      return { stream: s, audioProblem: null, videoProblem: null };
    } catch {
      /* fall through: each on its own */
    }
  }
  const tracks: MediaStreamTrack[] = [];
  let audioProblem: MediaProblem | null = null;
  let videoProblem: MediaProblem | null = null;
  if (want.audio) {
    const r = await one('audio');
    if (r.track) tracks.push(r.track);
    audioProblem = r.problem;
  }
  if (want.video) {
    const r = await one('video');
    if (r.track) tracks.push(r.track);
    videoProblem = r.problem;
  }
  return { stream: tracks.length ? new MediaStream(tracks) : null, audioProblem, videoProblem };
}

/** Which device(s) a pair of problems is about (for the help text). */
export function problemDevice(audio: MediaProblem | null, video: MediaProblem | null): DeviceKind | null {
  if (audio && video) return 'both';
  if (audio) return 'microphone';
  if (video) return 'camera';
  return null;
}

/** The more actionable of two problems (both usually have the same cause). */
export function mainProblem(audio: MediaProblem | null, video: MediaProblem | null): MediaProblem | null {
  const order: MediaProblem[] = ['insecure', 'system', 'blocked', 'in-use', 'dismissed', 'no-device', 'waiting', 'unknown'];
  const found = [audio, video].filter((p): p is MediaProblem => !!p);
  return found.sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] ?? null;
}

// ------------------------------------------------------------------ remembered devices

const PREF_KEY = 'call-devices-v1';

export interface DevicePrefs {
  audioId?: string | null;
  videoId?: string | null;
  speakerId?: string | null;
  /**
   * The microphone / camera were switched OFF when I last left a call (absent =
   * on). A rejoin — the next call of the lesson, a reload — comes back the same
   * way instead of with everything off (Minghui, 2 Oct 2026).
   */
  micOff?: boolean;
  camOff?: boolean;
}

export function loadDevicePrefs(): DevicePrefs {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') as DevicePrefs;
  } catch {
    return {};
  }
}

export function saveDevicePrefs(p: DevicePrefs): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

/** Speaker choice works where <audio>/<video> support setSinkId (Chrome, Edge, Firefox). */
export function canPickSpeaker(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}
