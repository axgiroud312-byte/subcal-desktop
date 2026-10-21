import './styles/base.css';
import './styles.css';
import './styles/shell.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Apply the last resolved theme before the first paint; the real preference is
// still authoritative once the production snapshot arrives.
try {
  const cached = window.localStorage.getItem('subcal:resolved-theme');
  if (cached === 'dark' || cached === 'light') {
    document.documentElement.dataset.theme = cached;
    document.documentElement.classList.toggle('dark', cached === 'dark');
    document.documentElement.style.colorScheme = cached;
  }
} catch {
  /* first run or storage unavailable */
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
