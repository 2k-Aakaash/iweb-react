// Shown while an item is dragged in Edit Widgets mode (one set for the desktop): alignment
// guide lines (x, y) for the clock and search bar, or the slot a widget will land in (slot).
import { useSyncExternalStore } from 'react';

let guides = { x: null, y: null, slot: null };
const sameRect = (a, b) => a === b || (a && b && a.left === b.left && a.top === b.top && a.w === b.w && a.h === b.h);
const listeners = new Set();

export function setGuides({ x = null, y = null, slot = null }) {
  if (x === guides.x && y === guides.y && sameRect(slot, guides.slot)) return;
  guides = { x, y, slot };
  for (const listener of [...listeners]) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGuides() {
  return useSyncExternalStore(subscribe, () => guides, () => guides);
}
