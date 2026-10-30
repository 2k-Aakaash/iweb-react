// The controls Control Center can show, after macOS 26's. A browser page can't switch Wi-Fi,
// Bluetooth or the display, so each control drives the iWeb feature that does the same job.
// Tiles sit on a 4-column grid:
//   small  1 × 1 (a round button)   medium  2 × 1 (a pill)
//   large  2 × 2 (Now Playing)      wide    4 × 1 (a slider)
// Which controls show, and in what order, is chosen with Edit Controls (ccPrefs.js).

/** Window event that opens Control Center: detail { view } ('grid', 'timer', 'sound'…). */
export const OPEN_CONTROL_CENTER = 'controlcenter:open';

export const CONTROLS = Object.freeze({
  connection: { label: 'Wi-Fi', size: 'medium' },
  nowPlaying: { label: 'Now Playing', size: 'large' },
  widgets: { label: 'Widgets', size: 'small' },
  glassClock: { label: 'Glass Clock', size: 'small' },
  focus: { label: 'Focus', size: 'medium' },
  showDesktop: { label: 'Show Desktop', size: 'small' },
  editWidgets: { label: 'Edit Widgets', size: 'small' },
  display: { label: 'Display', size: 'wide' },
  sound: { label: 'Sound', size: 'wide' },
  nightShift: { label: 'Night Shift', size: 'small' },
  calculator: { label: 'Calculator', size: 'small' },
  timer: { label: 'Timer', size: 'small' },
  screenshot: { label: 'Screenshot', size: 'small' },
  fullscreen: { label: 'Full Screen', size: 'small' },
});

/** Today's arrangement, as in the macOS 26 Control Center (Full Screen can be added). */
export const DEFAULT_CONTROLS = Object.freeze([
  'connection', 'nowPlaying', 'widgets', 'glassClock', 'focus', 'showDesktop', 'editWidgets',
  'display', 'sound', 'nightShift', 'calculator', 'timer', 'screenshot',
]);

/** A valid arrangement: known controls, each once, in order (null when not a list). */
export function normalizeControls(list) {
  if (!Array.isArray(list)) return null;
  return [...new Set(list)].filter((id) => Object.hasOwn(CONTROLS, id));
}

/** Controls that are not shown and can be added. */
export function hiddenControls(shown) {
  return Object.keys(CONTROLS).filter((id) => !shown.includes(id));
}

/** `list` with `id` moved to just before `beforeId` (or to the end when beforeId is null). */
export function moveControl(list, id, beforeId) {
  if (id === beforeId || !list.includes(id)) return list;
  const rest = list.filter((x) => x !== id);
  const at = beforeId === null ? rest.length : rest.indexOf(beforeId);
  if (at < 0) return list;
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}
