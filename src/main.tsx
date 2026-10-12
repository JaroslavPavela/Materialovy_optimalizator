import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import './app/styles.css';
import { createDexieStorage } from './storage/db.ts';
import { initPersistence } from './storage/persistence.ts';

const root = document.getElementById('root');
if (!root) throw new Error('Chybí kořenový element #root.');

const render = () =>
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

// Bez IndexedDB (např. zakázané úložiště) aplikace běží dál, jen neukládá.
initPersistence(createDexieStorage())
  .then((persistence) => {
    window.addEventListener('pagehide', () => void persistence.flush());
  })
  .catch((e: unknown) => console.warn('Úložiště není dostupné, projekt se nebude ukládat:', e))
  .finally(render);
