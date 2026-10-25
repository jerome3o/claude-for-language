/**
 * Is the microphone in use on this page right now? (docs/FEEDBACK.md: a shake never opens the
 * feedback sheet while recording — a take, a voice message, dictation — or in a call.)
 *
 * Every recorder in the app gets its stream from `navigator.mediaDevices.getUserMedia`, so ONE
 * wrapper installed at start-up remembers the streams it handed out; the mic is busy while any of
 * them still has a live audio track. Nothing else changes: the wrapper returns the same stream.
 */
const streams = new Set<MediaStream>();
let installed = false;

export function installMicTracker(): void {
  if (installed || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
  installed = true;
  const md = navigator.mediaDevices;
  const original = md.getUserMedia.bind(md);
  md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    const stream = await original(constraints);
    if (stream.getAudioTracks().length > 0) streams.add(stream);
    return stream;
  };
}

export function micInUse(): boolean {
  for (const s of streams) {
    if (s.getAudioTracks().some((t) => t.readyState === 'live')) return true;
    streams.delete(s);
  }
  return false;
}
