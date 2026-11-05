import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/tajawal/400.css';
import '@fontsource/tajawal/500.css';
import '@fontsource/tajawal/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/700.css';
import './styles.css';
import App from './App';
import { installHooks, startSync } from './sync/sync';
import { installHistoryHooks } from './lib/history';

installHooks();
installHistoryHooks();
void startSync();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
