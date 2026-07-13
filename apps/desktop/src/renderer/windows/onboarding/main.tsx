import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/tokens.css';
import { OnboardingApp } from './OnboardingApp';

const root = document.getElementById('root');
if (root) createRoot(root).render(<React.StrictMode><OnboardingApp /></React.StrictMode>);
