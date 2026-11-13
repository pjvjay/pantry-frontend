import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// The display face for headings and the wordmark (--font-display in styles/tokens.css), served
// with the console's own files: the browser asks no other site for it.
import '@fontsource-variable/fraunces/opsz.css';
// The tokens first, so every rule after them can use them; component styles after the base.
import './styles/tokens.css';
import './index.css';
import './styles/buttons.css';
import './styles/theme-menu.css';
import './styles/ui.css';
import './styles/card.css';
import './styles/table.css';
import './styles/shell.css';
import './styles/plan.css';
import './styles/workshop.css';
import './styles/ask.css';
import './styles/home.css';
import './styles/shop.css';
import './styles/check.css';
import './styles/calendar.css';
import { installTelemetry } from './telemetry';

// Before the first render, so the page's own load and every API call are measured.
installTelemetry();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
