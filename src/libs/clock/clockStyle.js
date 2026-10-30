// The desktop clock's look, chosen in Settings → Appearance → Clock, by right-clicking it, or
// in Control Center (Glass Clock):
//
//   glass    Glass (default): frosted glass over the wallpaper, as on the iOS 26 Lock Screen
//            (clockGlass.js)
//   vibrant  Vibrant Colour: painted in the wallpaper's dominant colour (Vibrant, picked by
//            wallpaperRenderer.js only for this style)
//
// Saved in iWebDB (row 'clock_style') with a localStorage copy for the first frame
// (libs/prefs/storedPref.js).
import { createStoredPref, usePref } from '../prefs/storedPref.js';

export const CLOCK_STYLES = Object.freeze([
  { id: 'glass', label: 'Glass' },
  { id: 'vibrant', label: 'Vibrant Colour' },
]);

export const CLOCK_STYLE_KEY = 'clock_style';

/** A known style id, or null. 'solid' was this style's name in development builds. */
export function normalizeClockStyle(value) {
  const id = value === 'solid' ? 'vibrant' : value;
  return CLOCK_STYLES.some((s) => s.id === id) ? id : null;
}

export const clockStylePref = createStoredPref({
  key: CLOCK_STYLE_KEY,
  mirrorKey: 'iweb:clockStyle',
  fallback: 'glass',
  normalize: normalizeClockStyle,
});

export const getClockStyle = clockStylePref.get;
export const setClockStyle = clockStylePref.set;
export const loadClockStyle = clockStylePref.load;
export const getStoredClockStyle = clockStylePref.getStored;
export const _resetClockStyle = clockStylePref._reset;

export function useClockStyle() {
  return usePref(clockStylePref);
}
