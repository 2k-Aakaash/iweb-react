import { useSyncExternalStore } from 'react';

// Which glass every <GlassSurface> renders:
//   'static' — rendered once per size/wallpaper change and shown as a still (no per-frame
//              cost; the default).
//   'liquid' — live @samasante/liquid-glass refraction (heavier: the GPU re-runs every
//              filter on each frame while anything on the page animates).
// Chosen in Settings → Appearance; saved per browser.

const KEY = 'iweb:glassMode';
const EVENT = 'iweb:glass-mode';
export const GLASS_MODES = ['static', 'liquid'];

export function getGlassMode() {
  try {
    const mode = localStorage.getItem(KEY);
    return GLASS_MODES.includes(mode) ? mode : 'static';
  } catch {
    return 'static';
  }
}

export function setGlassMode(mode) {
  if (!GLASS_MODES.includes(mode)) return;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* private mode: applies for this page only */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));
}

function subscribe(callback) {
  const onStorage = (e) => e.key === KEY && callback();
  window.addEventListener(EVENT, callback);
  window.addEventListener('storage', onStorage); // other tabs
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener('storage', onStorage);
  };
}

export function useGlassMode() {
  return useSyncExternalStore(subscribe, getGlassMode, () => 'static');
}
