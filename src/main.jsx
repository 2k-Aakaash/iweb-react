import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts.css'
import './styles/style.css'
import './styles/scrollbars.css'
import App from './App.jsx'

// Offline support for the website (PWA). Not in the extension, which has its own service
// worker. This lives here, not inline in index.html: extension pages block inline scripts.
if ('serviceWorker' in navigator && !window.chrome?.runtime?.id) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/pwa-service-worker.js')
      .then((reg) => console.log('PWA Service Worker registered:', reg))
      .catch((err) => console.error('Service Worker registration failed:', err));
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
