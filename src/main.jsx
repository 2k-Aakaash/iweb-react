import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/style.css'
import './styles/mac-controls.css'
import './styles/scrollbars.css'
import './styles/appearance-light.css'
import './styles/accent.css'
import App from './App.jsx'
import './libs/boot/bootReveal' // starts the veil's time limit
import { startAppearance } from './libs/appearance/appearance'
import { startAccent } from './libs/appearance/accent'
import { startClockFont } from './libs/fonts/clockFontBoot'
import { startTheme } from './libs/theme/engine'

// Light / Dark / Auto (Settings → Appearance), on <html> before the first frame.
startAppearance()
// Control Center's Focus and Widgets off, likewise (DesktopModes keeps them in step after).
try {
  const on = (key) => localStorage.getItem(key) === 'true'
  document.documentElement.classList.toggle('cc-focus', on('iweb:ccFocus'))
  document.documentElement.classList.toggle('cc-widgets-hidden', on('iweb:ccWidgetsHidden'))
} catch {
  // storage blocked: DesktopModes sets them once the settings load
}
startAccent()
// The clock's chosen font: loading now, the digits held back until it's ready.
startClockFont()
// The theme in use (libs/theme): applied before the desktop is revealed.
startTheme()

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
