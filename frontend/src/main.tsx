import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initConsoleBuffer } from './utils/consoleBuffer';
import { initDebugConsole } from './utils/debugConsole';
import { initAutoUpdate } from './utils/appUpdates';

// Initialize console buffer early to capture all logs
initConsoleBuffer();

// On-device devtools (Eruda) if enabled — see utils/debugConsole.ts
initDebugConsole();

// Pick up new deploys automatically (on app focus + hourly)
initAutoUpdate();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
