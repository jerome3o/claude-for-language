import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initConsoleBuffer } from './utils/consoleBuffer';
import { initDebugConsole } from './utils/debugConsole';
import { initAutoUpdate } from './utils/appUpdates';
import { setDiagnosticsContext } from './utils/audioDiagnostics';
import { livePlayerCount, warmAudioOutput } from './utils/audioPlayback';
import { getPrefetchStatus } from './services/audioPrefetch';
import { getManualOfflineMode } from './services/offlineMode';

// Initialize console buffer early to capture all logs
initConsoleBuffer();

// On-device devtools (Eruda) if enabled — see utils/debugConsole.ts
initDebugConsole();

// Let playback diagnostics see what else the app is doing (see
// utils/audioDiagnostics.ts). Wired here to keep the audio modules from
// depending on services they otherwise have no business importing.
setDiagnosticsContext({
  playersLive: livePlayerCount,
  prefetchStatus: getPrefetchStatus,
  offlineMode: getManualOfflineMode,
});

// Opening the audio output takes a moment and can only be done from a user
// gesture, so do it on the first tap — long before a card needs to play.
document.addEventListener('pointerdown', warmAudioOutput, { once: true });

// Pick up new deploys automatically (on app focus + hourly)
initAutoUpdate();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
