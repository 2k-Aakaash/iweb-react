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

/** The look in effect now: 'light' or 'dark'. */
export function useResolvedAppearance() {
  const setting = usePref(appearancePref);
  const dark = useSyncExternalStore(subscribeSystem, systemDark, () => true);
  return resolveAppearance(setting, dark);
}

/** Keeps <html data-appearance> (and color-scheme) in step with the setting and the system. */
export function startAppearance() {
  const apply = () => {
    const look = resolveAppearance(appearancePref.get(), systemDark());
    const root = document.documentElement;
    if (root.dataset.appearance !== look) root.dataset.appearance = look;
    root.style.colorScheme = look;
  };
  apply();
  appearancePref.subscribe(apply);
  subscribeSystem(apply);
  appearancePref.load?.();
}
