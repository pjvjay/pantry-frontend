import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// The tokens first, so every rule after them can use them; component styles after the base.
import './styles/tokens.css';
import './index.css';
import './styles/buttons.css';
import './styles/theme-menu.css';
import './styles/ui.css';
import './styles/shell.css';
import './styles/workshop.css';
import './styles/ask.css';
import './styles/home.css';
import './styles/shop.css';
import { installTelemetry } from './telemetry';

// Before the first render, so the page's own load and every API call are measured.
installTelemetry();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
