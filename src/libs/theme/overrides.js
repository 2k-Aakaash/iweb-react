// A small map a theme can override at runtime (icons, names…): readers subscribe, so whatever
// shows a value re-renders when the theme changes.
import { useSyncExternalStore } from 'react';

export function createOverrides() {
  let map = Object.freeze({});
  const listeners = new Set();
  const subscribe = (cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  };
  return {
    get: (key) => map[key],
    /** The whole map (a new object each time it changes). */
    all: () => map,
    /** Replaces every override (a theme applied, or none: {}). */
    set(next) {
      map = Object.freeze({ ...(next || {}) });
      for (const cb of [...listeners]) cb();
    },
    subscribe,
    /** Re-renders the caller when the overrides change; returns the map. */
    use: () => useSyncExternalStore(subscribe, () => map, () => map),
  };
}
