/**
 * Sound in VR: one player for every window (a new clip replaces the one playing), cache first —
 * the same device caches as the web app (note clips by R2 key, practice TTS, reader narration),
 * so whatever played on the phone plays offline in the headset too.
 */
import { createAudioPlayer } from '../utils/audioPlayback';
import { getAudioWithCache, speakWithBrowserTTS } from '../services/audioCache';
import { getTTSWithCache } from '../services/ttsCache';

let player: ReturnType<typeof createAudioPlayer> | null = null;
function audio() {
  if (!player) player = createAudioPlayer();
  return player;
}

async function playFrom(load: () => Promise<Blob | null>, fallbackText: string | null) {
  const p = audio();
  const id = p.claim();
  const blob = await load().catch(() => null);
  if (!p.isCurrent(id)) return;
  if (blob) p.play(blob, { label: 'vr' });
  else if (fallbackText) void speakWithBrowserTTS(fallbackText).catch(() => {});
}

/** A note's stored clip (R2 key), else the device voice. */
export function playNoteClip(audioKey: string | null | undefined, text: string) {
  return playFrom(() => (audioKey ? getAudioWithCache(audioKey) : Promise.resolve(null)), text);
}

/** Any Chinese text through the practice TTS cache (the explorer's ▶, lesson sentences). */
export function playText(text: string) {
  return playFrom(() => getTTSWithCache(text), text);
}

/** A ready-made blob (reader narration). */
export function playBlob(load: () => Promise<Blob | null>, fallbackText: string | null) {
  return playFrom(load, fallbackText);
}

export function stopAudio() {
  player?.stop();
}

export function disposeAudio() {
  player?.dispose();
  player = null;
}
