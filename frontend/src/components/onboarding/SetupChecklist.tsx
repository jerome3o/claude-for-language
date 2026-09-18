import { useState } from 'react';
import { useInstallPrompt } from './useInstallPrompt';
import { useAudioPrefetchProgress, prefetchAllAudio } from '../../services/audioPrefetch';
import { useNetwork } from '../../contexts/NetworkContext';

/**
 * "Two things before the train": install the app (one tap on Android, a hint
 * on iOS) and a quiet status line for the audio download. Audio gets no
 * buttons unless something failed — it happens by itself.
 */
export function SetupChecklist() {
  const install = useInstallPrompt();
  const audio = useAudioPrefetchProgress();
  const { isOnline } = useNetwork();
  const [showHint, setShowHint] = useState(false);
  const [promptResult, setPromptResult] = useState<'accepted' | 'dismissed' | 'unavailable' | null>(null);
  const [retrying, setRetrying] = useState(false);

  const onInstall = async () => {
    if (install.canPrompt) {
      const r = await install.prompt();
      setPromptResult(r);
      if (r === 'unavailable') setShowHint(true);
    } else {
      setShowHint(v => !v);
    }
  };

  const retryAudio = async () => {
    setRetrying(true);
    try {
      await prefetchAllAudio({ force: true });
    } finally {
      setRetrying(false);
    }
  };

  const installDone = install.installed || promptResult === 'accepted';

  let audioLine: string;
  let audioTone: 'muted' | 'done' | 'warn' = 'muted';
  if (audio.status === 'running') {
    audioLine = audio.total > 0 ? `downloading… ${Math.min(audio.done, audio.total)} of ${audio.total}` : 'downloading…';
  } else if (audio.status === 'error') {
    audioLine = 'download failed';
    audioTone = 'warn';
  } else if (audio.status === 'done' && audio.failed > 0) {
    audioLine = `${audio.cachedCount} clips · ${audio.failed} failed`;
    audioTone = 'warn';
  } else if (audio.manifestTotal > 0) {
    audioLine = `${audio.manifestTotal} ${audio.manifestTotal === 1 ? 'clip' : 'clips'} · done ✓`;
    audioTone = 'done';
  } else if (!isOnline) {
    audioLine = 'downloads when you are online';
  } else {
    audioLine = 'downloads automatically';
  }
  const audioNeedsHelp = audioTone === 'warn' && isOnline;

  return (
    <section className="card onb-checklist" aria-label="Two things before the train">
      <h2 className="onb-checklist-title">Two things before the train</h2>

      <div className={`onb-check-row${installDone ? ' done' : ''}`}>
        <span className="onb-check-icon" aria-hidden="true">{installDone ? '✅' : '📲'}</span>
        <div className="onb-check-text">
          <span className="onb-check-label">Add to home screen</span>
          <span className="onb-check-sub">
            {installDone
              ? 'Installed — it opens like an app and works offline.'
              : 'So it opens like an app and works offline (or install the Android app — ask your tutor for the link).'}
          </span>
          {showHint && !installDone && (
            <div className="onb-install-hint">
              {install.platform === 'ios' ? (
                <>
                  <span><strong>1.</strong> Tap <span className="onb-kbd" aria-label="Share">⎙ Share</span> at the bottom of Safari</span>
                  <span><strong>2.</strong> Choose <span className="onb-kbd">Add to Home Screen</span></span>
                </>
              ) : (
                <>
                  <span><strong>1.</strong> Open the browser menu <span className="onb-kbd">⋮</span></span>
                  <span><strong>2.</strong> Choose <span className="onb-kbd">Add to Home screen</span> or <span className="onb-kbd">Install app</span></span>
                </>
              )}
            </div>
          )}
        </div>
        {!installDone && (
          <button type="button" className="btn btn-secondary btn-sm onb-check-btn" onClick={onInstall}>
            {install.canPrompt ? 'Install' : showHint ? 'Hide' : 'Show me'}
          </button>
        )}
      </div>

      <div className={`onb-check-row${audioTone === 'done' ? ' done' : ''}`}>
        <span className="onb-check-icon" aria-hidden="true">🔊</span>
        <div className="onb-check-text">
          <span className="onb-check-label">Audio for your words</span>
          <span className={`onb-check-sub onb-audio-${audioTone}`}>{audioLine}</span>
        </div>
        {audioNeedsHelp && (
          <button type="button" className="btn btn-secondary btn-sm onb-check-btn" onClick={retryAudio} disabled={retrying}>
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        )}
      </div>
    </section>
  );
}
