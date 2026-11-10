// The Dock's size and magnification, as in macOS 26 (System Settings → Desktop & Dock), saved
// in iWebDB (libs/prefs/storedPref.js) and included in backups:
//
//   dock_size           icon size in px (DOCK_SIZE_MIN–DOCK_SIZE_MAX); also set by dragging the
//                       Dock's divider up or down
//   dock_magnification  how much the icon under the pointer grows: off, small, medium, large
//
// The size is a maximum: when the apps don't fit the window, every icon shrinks evenly until
// they do (fitIconSize), and grows back when there's room.
import { createStoredPref } from '../prefs/storedPref.js';

export const DOCK_SIZE_MIN = 32;
export const DOCK_SIZE_MAX = 96;
export const DOCK_SIZE_DEFAULT = 60;
/** The smallest an icon gets when shrinking to fit. */
export const DOCK_FIT_MIN = 16; // macOS's smallest Dock

export const DOCK_SIZE_PRESETS = [
  { id: 'small', label: 'Small', size: 44 },
  { id: 'medium', label: 'Medium', size: DOCK_SIZE_DEFAULT },
  { id: 'large', label: 'Large', size: 80 },
];

// Extra size of the hovered icon, as a share of the icon size (Medium: 60 → 90 px, as before).
export const MAGNIFICATIONS = [
  { id: 'off', label: 'Off', factor: 0 },
  { id: 'small', label: 'Small', factor: 0.25 },
  { id: 'medium', label: 'Medium', factor: 0.5 },
  { id: 'large', label: 'Large', factor: 0.8 },
];

export function normalizeDockSize(v) {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.min(DOCK_SIZE_MAX, Math.max(DOCK_SIZE_MIN, n))) : null;
}

export function normalizeMagnification(v) {
  return MAGNIFICATIONS.some((m) => m.id === v) ? v : null;
}

export const dockSizePref = createStoredPref({
  key: 'dock_size',
  mirrorKey: 'iweb:dockSize',
  fallback: DOCK_SIZE_DEFAULT,
  normalize: normalizeDockSize,
  debounceMs: 400, // a slider or a drag: saved once it settles
});

export const dockMagnificationPref = createStoredPref({
  key: 'dock_magnification',
  mirrorKey: 'iweb:dockMagnification',
  fallback: 'medium',
  normalize: normalizeMagnification,
});

/** The hovered icon's extra size in px for an icon size and a magnification setting. */
export function magnificationPx(size, magnification) {
  const factor = MAGNIFICATIONS.find((m) => m.id === magnification)?.factor ?? 0.5;
  return Math.round(size * factor);
}

// The Dock's width in icon sizes, besides the icons: its side padding (a third of an icon
// each side) and each divider (0.28 of an icon). Matches Dock.module.css.
const PADDING_UNITS = 2 / 3;
const DIVIDER_UNITS = 0.28;
// While magnifying, the hovered icon grows by m and its four neighbours by 2m/3 and m/3 each:
// the Dock gets up to 3m wider.
const WAVE_GROWTH = 3;

/**
 * The icon size to draw: the chosen size, or smaller so that `count` icons (and `dividers`)
 * fit in `available` px even while magnified. Never below DOCK_FIT_MIN.
 */
export function fitIconSize({ size, count, dividers = 0, available, magnification = 0 }) {
  if (!(count > 0) || !(available > 0)) return size;
  const units = count + PADDING_UNITS + dividers * DIVIDER_UNITS;
  const fits = Math.floor((available - WAVE_GROWTH * magnification) / units);
  return Math.max(DOCK_FIT_MIN, Math.min(size, fits));
}
