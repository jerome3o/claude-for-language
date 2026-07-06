import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initConsoleBuffer } from './utils/consoleBuffer';
import { initDebugConsole } from './utils/debugConsole';

// Initialize console buffer early to capture all logs
initConsoleBuffer();

// On-device devtools (Eruda) if enabled — see utils/debugConsole.ts
initDebugConsole();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
