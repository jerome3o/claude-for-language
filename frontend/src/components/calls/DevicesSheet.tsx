/**
 * Camera / microphone / speaker for the call, remembered on this device
 * (services/calls/mediaAccess.ts `DevicePrefs`). Device names only appear once
 * the browser has been allowed to use a device, so an unnamed list says so.
 */

import { useEffect, useState } from 'react';
import { canPickSpeaker, type DevicePrefs } from '../../services/calls/mediaAccess';

interface Lists {
  audio: MediaDeviceInfo[];
  video: MediaDeviceInfo[];
  speaker: MediaDeviceInfo[];
}

function useDevices(): Lists {
  const [lists, setLists] = useState<Lists>({ audio: [], video: [], speaker: [] });
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    const read = () =>
      md.enumerateDevices().then((all) =>
        setLists({
          audio: all.filter((d) => d.kind === 'audioinput'),
          video: all.filter((d) => d.kind === 'videoinput'),
          speaker: all.filter((d) => d.kind === 'audiooutput'),
        }),
      ).catch(() => {});
    void read();
    md.addEventListener?.('devicechange', read);
    return () => md.removeEventListener?.('devicechange', read);
  }, []);
  return lists;
}

function label(d: MediaDeviceInfo, i: number, noun: string): string {
  return d.label || `${noun} ${i + 1}`;
}

export function DevicesSheet({
  prefs,
  current,
  onChoose,
  onClose,
}: {
  prefs: DevicePrefs;
  /** The device ids of the tracks in use now (the selects show them). */
  current: { audio: string | null; video: string | null };
  onChoose: (kind: 'audio' | 'video' | 'speaker', deviceId: string | null) => void;
  onClose: () => void;
}) {
  const lists = useDevices();
  const unnamed = [...lists.audio, ...lists.video].some((d) => !d.label);
  const row = (kind: 'audio' | 'video' | 'speaker', title: string, noun: string, items: MediaDeviceInfo[], value: string | null | undefined) => (
    <label className="call-devices-row">
      <span>{title}</span>
      <select
        value={value ?? items[0]?.deviceId ?? ''}
        onChange={(e) => onChoose(kind, e.target.value || null)}
        disabled={items.length === 0}
        data-testid={`device-${kind}`}
      >
        {items.length === 0 && <option value="">None found</option>}
        {items.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>{label(d, i, noun)}</option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="call-sheet-backdrop" onClick={onClose}>
      <div className="call-sheet" role="dialog" aria-label="Devices" onClick={(e) => e.stopPropagation()} data-testid="devices-sheet">
        <div className="call-sheet-head">
          <h2>Devices</h2>
          <button type="button" className="call-panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {row('video', 'Camera', 'Camera', lists.video, current.video ?? prefs.videoId)}
        {row('audio', 'Microphone', 'Microphone', lists.audio, current.audio ?? prefs.audioId)}
        {canPickSpeaker() && lists.speaker.length > 0 && row('speaker', 'Speaker', 'Speaker', lists.speaker, prefs.speakerId)}
        {unnamed && <p className="call-muted">Names appear once the browser is allowed to use the camera and microphone.</p>}
      </div>
    </div>
  );
}
