// Settings → Appearance → Light / Dark / Auto, as in macOS 26. Saved in iWebDB
// (libs/prefs/storedPref.js) and included in backups.
//
// The chosen look is written to <html data-appearance="light|dark"> (Auto follows the
// system). Windows, menus, Control Center, Spotlight, Settings, Notes and dialogs restyle from
// it: their light look is generated from the dark CSS at build time (scripts/
// postcss-light-appearance.mjs). Things on the wallpaper (clock, menu bar, Dock, widgets) keep
// their look, as in macOS. An element marked [data-force-dark] keeps the dark look (Music).
import { useSyncExternalStore } from 'react';
import { createStoredPref, usePref } from '../prefs/storedPref.js';

export const APPEARANCES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'auto', label: 'Auto' },
];

export const normalizeAppearance = (v) => (APPEARANCES.some((a) => a.id === v) ? v : null);

export const appearancePref = createStoredPref({
  key: 'appearance',
  mirrorKey: 'iweb:appearance',
  fallback: 'dark', // iWeb's look until now
  normalize: normalizeAppearance,
});

const DARK_QUERY = '(prefers-color-scheme: dark)';
const systemDark = () => (typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia(DARK_QUERY).matches);
const subscribeSystem = (cb) => {
  const mq = window.matchMedia?.(DARK_QUERY);
  mq?.addEventListener('change', cb);
  return () => mq?.removeEventListener('change', cb);
};

/** 'light' or 'dark' for a setting and whether the system is dark. */
export const resolveAppearance = (setting, isSystemDark) => (setting === 'auto' ? (isSystemDark ? 'dark' : 'light') : setting === 'light' ? 'light' : 'dark');

// A theme made for one appearance only (libs/theme) holds iWeb to it while it's in use:
// 'light' | 'dark', or null to follow the setting.
let locked = null;
const lockListeners = new Set();
const subscribeLock = (cb) => {
  lockListeners.add(cb);
  return () => lockListeners.delete(cb);
};
export const getAppearanceLock = () => locked;
export function setAppearanceLock(look) {
  const next = look === 'light' || look === 'dark' ? look : null;
  if (next === locked) return;
  locked = next;
  for (const cb of [...lockListeners]) cb();
}
/** The appearance a theme holds iWeb to ('light' | 'dark'), or null. */
export const useAppearanceLock = () => useSyncExternalStore(subscribeLock, getAppearanceLock, () => null);

/** The look in effect now: 'light' or 'dark'. */
export function useResolvedAppearance() {
  const setting = usePref(appearancePref);
  const dark = useSyncExternalStore(subscribeSystem, systemDark, () => true);
  const lock = useAppearanceLock();
  return lock || resolveAppearance(setting, dark);
}

/** Keeps <html data-appearance> (and color-scheme) in step with the setting and the system. */
export function startAppearance() {
  const apply = () => {
    const look = locked || resolveAppearance(appearancePref.get(), systemDark());
    const root = document.documentElement;
    if (root.dataset.appearance !== look) root.dataset.appearance = look;
    root.style.colorScheme = look;
  };
  apply();
  appearancePref.subscribe(apply);
  subscribeSystem(apply);
  subscribeLock(apply);
  appearancePref.load?.();
}
