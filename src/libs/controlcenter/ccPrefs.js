// Control Center's settings, saved in iWebDB (libs/prefs/storedPref.js):
//
//   focus              Focus: a calm desktop, only the clock, the search bar and the Dock;
//                      update notices wait
//   widgetsHidden      Widgets off: the widgets step aside (the clock and quote stay)
//   nightShift         Night Shift: warmer colours over the whole page
//   wallpaperBrightness  Display: how bright the wallpaper is, 20–100 (%)
//   controls           which controls Control Center shows, in order (Edit Controls)
import { createStoredPref, toBoolean } from '../prefs/storedPref.js';
import { DEFAULT_CONTROLS, normalizeControls } from './controls.js';

export const MIN_BRIGHTNESS = 20;

export const focusPref = createStoredPref({ key: 'cc_focus', mirrorKey: 'iweb:ccFocus', fallback: false, normalize: toBoolean });

export const widgetsHiddenPref = createStoredPref({
  key: 'cc_widgets_hidden', mirrorKey: 'iweb:ccWidgetsHidden', fallback: false, normalize: toBoolean,
});

export const nightShiftPref = createStoredPref({
  key: 'cc_night_shift', mirrorKey: 'iweb:ccNightShift', fallback: false, normalize: toBoolean,
});

export function normalizeBrightness(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(100, Math.max(MIN_BRIGHTNESS, v))) : null;
}

export const wallpaperBrightnessPref = createStoredPref({
  key: 'cc_wallpaper_brightness',
  mirrorKey: 'iweb:ccWallpaperBrightness',
  fallback: 100,
  normalize: normalizeBrightness,
  debounceMs: 400, // a slider: saved once it settles
});

export const controlsPref = createStoredPref({
  key: 'cc_controls',
  mirrorKey: 'iweb:ccControls',
  fallback: [...DEFAULT_CONTROLS],
  normalize: normalizeControls,
});

/** How dark the wallpaper's veil is for a brightness (100% → none, 20% → 0.8). */
export const dimFor = (brightness) => Math.round((1 - brightness / 100) * 100) / 100;
