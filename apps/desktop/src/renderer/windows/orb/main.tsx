import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/tokens.css';
import { OrbApp } from './OrbApp';

const root = document.getElementById('root');
if (root) createRoot(root).render(<React.StrictMode><OrbApp /></React.StrictMode>);
