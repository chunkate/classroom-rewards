import React from 'react';
import { createRoot } from 'react-dom/client';
import Home from './app/page';
import AuthGate from './components/auth-gate';
import './app/globals.css';
import './app/warm-theme.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate><Home/></AuthGate></React.StrictMode>);
