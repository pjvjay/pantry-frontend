import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { installTelemetry } from './telemetry';

// Before the first render, so the page's own load and every API call are measured.
installTelemetry();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
