import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/tokens.css';
import { WorkspaceApp } from './WorkspaceApp';

const root = document.getElementById('root');
if (root) createRoot(root).render(<React.StrictMode><WorkspaceApp /></React.StrictMode>);
