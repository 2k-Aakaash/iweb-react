// The desktop layout and Edit Widgets mode, shared by every movable item, the right-click
// menu and the edit toolbar. Saved in localStorage and followed across tabs.
import { useSyncExternalStore } from 'react';
import { DEFAULT_LAYOUT, ITEMS, addToStack, detachFromStack, isSlotted, normalizeLayout, slotWidgets } from './layout';
import { findFreeSpot, fixedRects } from './placement';

export const LAYOUT_STORAGE_KEY = 'iweb:desktopLayout';

function readLayout() {
  try {
    return normalizeLayout(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || 'null'));
  } catch {
    return normalizeLayout(DEFAULT_LAYOUT);
  }
}

let state = { layout: readLayout(), editing: false };
const listeners = new Set();

function emit() {
  for (const listener of [...listeners]) listener();
}

function save(layout) {
  state = { ...state, layout };
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Not saved (storage full or blocked): still applies for this session.
  }
  emit();
}

let storageAttached = false;
function subscribe(listener) {
  listeners.add(listener);
  if (!storageAttached && typeof window !== 'undefined') {
    storageAttached = true;
    window.addEventListener('storage', (e) => {
      if (e.key !== LAYOUT_STORAGE_KEY && e.key !== null) return;
      state = { ...state, layout: readLayout() };
      emit();
    });
  }
  return () => listeners.delete(listener);
}

const getState = () => state;

export function useDesktop() {
  return useSyncExternalStore(subscribe, getState, getState);
}

export function getDesktopState() {
  return state;
}

/** Updates one item: position anchors, size or hidden. */
export function updateItem(id, patch) {
  save(normalizeLayout({ ...state.layout, [id]: { ...state.layout[id], ...patch } }));
}

/** Shows an item on the desktop (out of the Smart Stack if it was there), at `size`. */
export function showOnDesktop(id, size = null) {
  const current = state.layout[id];
  const nextSize = size && ITEMS[id].sizes.includes(size) ? size : current.size;
  if (!current.hidden) {
    if (nextSize !== current.size) updateItem(id, { size: nextSize });
    return;
  }
  // News, the search bar, the stack: back where they were.
  if (!ITEMS[id].stackable) {
    updateItem(id, { hidden: false, size: nextSize });
    return;
  }
  // A widget leaving the stack: the first free spot.
  const spot = findFreeSpot(id, nextSize);
  save(detachFromStack(state.layout, id, { ...(spot || {}), size: nextSize }));
}

/** Places an item at `position` (anchors), e.g. dropped from the widget gallery. */
export function placeOnDesktop(id, size, position) {
  const nextSize = ITEMS[id].sizes.includes(size) ? size : state.layout[id].size;
  save(detachFromStack(state.layout, id, { ...position, size: nextSize }));
}

/** Removes an item from the desktop (a stack widget leaves the stack too). */
export function removeFromDesktop(id) {
  if (!ITEMS[id].removable) return;
  save(normalizeLayout({
    ...state.layout,
    stack: { ...state.layout.stack, pages: state.layout.stack.pages.filter((page) => page !== id) },
    [id]: { ...state.layout[id], hidden: true },
  }));
}

/** Puts a widget into the Smart Stack. */
export function moveToStack(id) {
  save(addToStack(state.layout, id));
}

/**
 * Puts widgets placed off the slot grid (an arrangement from before slots, or a narrower
 * screen) onto slots. Needs the desktop on screen: the clock and search bar stay put.
 */
export function snapToSlots() {
  const { layout } = state;
  const off = Object.keys(ITEMS).some((id) => ITEMS[id].kind === 'widget' && !layout[id].hidden && !isSlotted(layout[id]));
  if (off) save(normalizeLayout(slotWidgets(layout, window.innerWidth, window.innerHeight, fixedRects())));
}

export function resetLayout() {
  save(normalizeLayout(DEFAULT_LAYOUT));
}

export function setEditing(editing) {
  if (state.editing === editing) return;
  state = { ...state, editing };
  emit();
}
