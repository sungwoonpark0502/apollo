import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/tokens.css';
import { CaptureApp } from './CaptureApp';

const root = document.getElementById('root');
if (root) createRoot(root).render(<React.StrictMode><CaptureApp /></React.StrictMode>);
