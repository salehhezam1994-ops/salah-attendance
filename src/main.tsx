import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/tajawal/400.css';
import '@fontsource/tajawal/500.css';
import '@fontsource/tajawal/700.css';
import './styles.css';
import App from './App';
import { installHooks, startSync } from './sync/sync';

installHooks();
void startSync();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
