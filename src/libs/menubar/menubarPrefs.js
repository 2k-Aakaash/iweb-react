// Settings → Appearance → "Automatically hide and show the menu bar", as in macOS 26:
//
//   desktop     On Desktop Only (default): hidden with no app open, shown while one is
//   always      Always: hidden everywhere
//   fullscreen  In Full Screen Only: hidden while the browser is full screen
//   never       Never: always shown
//
// A hidden bar slides in when the pointer reaches the top edge. Saved in localStorage and
// followed across tabs.
import { useSyncExternalStore } from 'react';
import { MENUBAR_H } from '../desktop/layout';

export const MENUBAR_MODES = Object.freeze([
  { id: 'always', label: 'Always' },
  { id: 'desktop', label: 'On Desktop Only' },
  { id: 'fullscreen', label: 'In Full Screen Only' },
  { id: 'never', label: 'Never' },
]);

export const MENUBAR_MODE_KEY = 'iweb:menubarAutoHide';
const DEFAULT_MODE = 'desktop';

const valid = (mode) => MENUBAR_MODES.some((m) => m.id === mode);

function readMode() {
  try {
    const stored = localStorage.getItem(MENUBAR_MODE_KEY);
    return valid(stored) ? stored : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

let mode = readMode();
const listeners = new Set();
const emit = () => {
  for (const listener of [...listeners]) listener();
};

export function setMenubarMode(next) {
  if (!valid(next) || next === mode) return;
  mode = next;
  try {
    localStorage.setItem(MENUBAR_MODE_KEY, next);
  } catch {
    // Not saved (storage blocked): still applies for this session.
  }
  emit();
}

let storageAttached = false;
function subscribe(listener) {
  listeners.add(listener);
  if (!storageAttached && typeof window !== 'undefined') {
    storageAttached = true;
    window.addEventListener('storage', (e) => {
      if (e.key !== MENUBAR_MODE_KEY && e.key !== null) return;
      mode = readMode();
      emit();
    });
  }
  return () => listeners.delete(listener);
}

const getMode = () => mode;

export function useMenubarMode() {
  return useSyncExternalStore(subscribe, getMode, getMode);
}

/** Whether the bar hides, given the mode, whether an app window is open and full screen. */
export function isMenubarHidden(current, { appOpen, fullscreen }) {
  if (current === 'always') return true;
  if (current === 'desktop') return !appOpen;
  if (current === 'fullscreen') return fullscreen;
  return false;
}

/** Room the bar takes on the desktop (no app open): widgets and the island sit below it. */
export function desktopInsetFor(current, { fullscreen }) {
  return isMenubarHidden(current, { appOpen: false, fullscreen }) ? 0 : MENUBAR_H;
}
