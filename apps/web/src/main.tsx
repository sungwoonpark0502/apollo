import React from 'react';
import { createRoot } from 'react-dom/client';
import { configureFormat } from '@apollo/shared';
import { App } from './App';

// Shared format helpers need a context; the browser's own locale is the truth here.
configureFormat({ locale: navigator.language });
import './tokens.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
