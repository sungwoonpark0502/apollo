import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/tokens.css';
import { SettingsApp } from './SettingsApp';

const root = document.getElementById('root');
if (root) createRoot(root).render(<React.StrictMode><SettingsApp /></React.StrictMode>);
