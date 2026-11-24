import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

// Use one address only. Firebase also serves the site on *.firebaseapp.com, but each address has
// its own storage, so a DJ who switched addresses would lose their DJ sign-in.
const home = new URL(__FIREBASE__.publicUrl);
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if (!isLocal && location.host !== home.host) {
  location.replace(`${home.origin}${location.pathname}${location.search}${location.hash}`);
} else {
  // Back/forward can restore a page exactly as it was left (say, mid-"loading"). Start it fresh.
  window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
