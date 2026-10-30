// The desktop clock's look, chosen in Settings → Appearance → Clock (or by right-clicking it):
//
//   glass    Glass (default): frosted glass over the wallpaper, as on the iOS 26 Lock Screen
//            (clockGlass.js)
//   vibrant  Vibrant Colour: painted in the wallpaper's dominant colour (Vibrant, picked by
//            wallpaperRenderer.js only for this style)
//
// Saved in iWebDB (the `wallpaper_meta` store, row 'clock_style'), which backups include.
// IndexedDB answers asynchronously, so a copy is kept in localStorage to draw the right clock
// on the first frame; it also tells other tabs about a change. iWebDB wins when they differ.
import { useSyncExternalStore } from 'react';
import { openIwebDB, reqToPromise, STORES } from '../wallpaper/db.js';

export const CLOCK_STYLES = Object.freeze([
  { id: 'glass', label: 'Glass' },
  { id: 'vibrant', label: 'Vibrant Colour' },
]);

export const CLOCK_STYLE_KEY = 'clock_style'; // iWebDB wallpaper_meta row
const MIRROR_KEY = 'iweb:clockStyle'; // localStorage copy
const DEFAULT_STYLE = 'glass';

/** A known style id, or null. 'solid' was this style's name in development builds. */
export function normalizeClockStyle(value) {
  const id = value === 'solid' ? 'vibrant' : value;
  return CLOCK_STYLES.some((s) => s.id === id) ? id : null;
}

function readMirror() {
  try {
    return normalizeClockStyle(localStorage.getItem(MIRROR_KEY));
  } catch {
    return null;
  }
}

function writeMirror(value) {
  try {
    localStorage.setItem(MIRROR_KEY, value);
  } catch {
    // Storage blocked: iWebDB still has it.
  }
}

let style = readMirror() ?? DEFAULT_STYLE;
const listeners = new Set();
const emit = () => {
  for (const listener of [...listeners]) listener();
};

function apply(next) {
  if (next === style) return;
  style = next;
  writeMirror(next);
  emit();
}

/** The style saved in iWebDB (null when none has been saved yet). */
export async function getStoredClockStyle() {
  const db = await openIwebDB();
  const row = await reqToPromise(db.transaction(STORES.META, 'readonly').objectStore(STORES.META).get(CLOCK_STYLE_KEY));
  return normalizeClockStyle(row?.value);
}

async function store(value) {
  const db = await openIwebDB();
  await reqToPromise(db.transaction(STORES.META, 'readwrite').objectStore(STORES.META).put({ key: CLOCK_STYLE_KEY, value }));
}

/** Chooses the clock style: shown at once, saved to iWebDB. Resolves once saved. */
export async function setClockStyle(next) {
  const value = normalizeClockStyle(next);
  if (!value) return;
  apply(value);
  try {
    await store(value);
  } catch (err) {
    console.warn('[clock] Could not save the clock style:', err);
  }
}

export const getClockStyle = () => style;

// Once per page: take the saved style from iWebDB, or save the current one there (a first run,
// or a style chosen before it was kept in iWebDB).
let loading = null;
export function loadClockStyle() {
  if (!loading) {
    loading = getStoredClockStyle()
      .then((saved) => (saved ? apply(saved) : store(style)))
      .catch((err) => console.warn('[clock] Could not read the clock style:', err));
  }
  return loading;
}

let storageAttached = false;
function subscribe(listener) {
  listeners.add(listener);
  loadClockStyle();
  if (!storageAttached && typeof window !== 'undefined') {
    storageAttached = true;
    // Another tab chose a style (it updated the localStorage copy).
    window.addEventListener('storage', (e) => {
      if (e.key !== MIRROR_KEY && e.key !== null) return;
      const next = readMirror();
      if (next && next !== style) {
        style = next;
        emit();
      }
    });
  }
  return () => listeners.delete(listener);
}

export function useClockStyle() {
  return useSyncExternalStore(subscribe, getClockStyle, getClockStyle);
}

/** For tests: forget the loaded state (the module keeps one per page). */
export function _resetClockStyle() {
  style = readMirror() ?? DEFAULT_STYLE;
  loading = null;
}
