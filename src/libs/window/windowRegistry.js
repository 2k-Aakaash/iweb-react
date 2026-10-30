// Which app windows exist and which one is in front, for the menu bar (and anything else that
// needs to act on "the active app"). Every useMacWindow() reports here:
//
//   state      'open' | 'minimized' | 'closed'
//   maximized  zoomed with the green button
//   focusedAt  bumped when the window opens or is clicked / focused: the highest open one is
//              the front window
//
// Each window also registers a controller (a ref, so it always holds the latest render's
// functions): close, minimize, toggleMaximize, open, windowRef and menus() for its own
// menu-bar menus.
import { useSyncExternalStore } from 'react';

export const APP_TITLES = Object.freeze({
  notes: 'Notes',
  music: 'Music',
  settings: 'Settings',
  markets: 'Markets',
  news: 'News',
});

const entries = new Map();
const controllers = new Map();
const listeners = new Set();
let clock = 0;
let snapshot = { windows: [], front: null };

function publish() {
  const windows = [...entries.values()];
  const front = windows
    .filter((w) => w.state === 'open')
    .reduce((best, w) => (!best || w.focusedAt > best.focusedAt ? w : best), null);
  snapshot = { windows, front };
  for (const listener of [...listeners]) listener();
}

/** Updates a window's state; opening brings it to the front. */
export function setWindowState(app, patch) {
  const prev = entries.get(app) || { app, title: APP_TITLES[app] || app, state: 'closed', maximized: false, focusedAt: 0 };
  const next = { ...prev, ...patch };
  if (next.state === 'open' && prev.state !== 'open') next.focusedAt = ++clock;
  if (next.state === prev.state && next.maximized === prev.maximized && next.focusedAt === prev.focusedAt) return;
  entries.set(app, next);
  publish();
}

/** Brings an open window to the front (it was clicked or focused). */
export function focusWindow(app) {
  const entry = entries.get(app);
  if (!entry || entry.state !== 'open' || snapshot.front?.app === app) return;
  entries.set(app, { ...entry, focusedAt: ++clock });
  publish();
}

export function registerController(app, ref) {
  controllers.set(app, ref);
  return () => {
    if (controllers.get(app) === ref) controllers.delete(app);
  };
}

/** The window's latest controller ({ close, minimize, toggleMaximize, open, windowRef, menus }). */
export function getController(app) {
  return controllers.get(app)?.current || null;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => snapshot;

export function useWindows() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
