// Task Notes shown on the desktop as sticky cards: which notes, where, and how.
//
// A card is only a view of its note: it stores the note's id and how the card looks, never
// the tasks. Positions use the desktop's anchors (layout.js: kept relative to the nearest
// edge or the centre, so a card stays put across window sizes) and are clamped on screen
// when drawn. Saved in localStorage like the desktop layout, and followed across tabs.
//
//   { version: 1, cards: { [noteId]: { ax, x, ay, y, expanded, hideDone, color, z } } }
//
// `color` is the card's paper, one of the macOS 26 Stickies colours; null (the default) is
// clear frosted glass.
import { useSyncExternalStore } from 'react';

export const STICKY_STORAGE_KEY = 'iweb:stickyNotes';
export const STICKY_COLORS = Object.freeze([
  { id: 'yellow', label: 'Yellow', swatch: '#fde88a' },
  { id: 'blue', label: 'Blue', swatch: '#a9d4f5' },
  { id: 'green', label: 'Green', swatch: '#b9eb9c' },
  { id: 'pink', label: 'Pink', swatch: '#fbb6d2' },
  { id: 'purple', label: 'Purple', swatch: '#d3baf5' },
  { id: 'gray', label: 'Gray', swatch: '#d8d8d8' },
]);

const AX = ['left', 'center', 'right'];
const AY = ['top', 'middle', 'bottom'];
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** A valid card, or null. */
function normalizeCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const placed = AX.includes(raw.ax) && AY.includes(raw.ay) && finite(raw.x) && finite(raw.y);
  return {
    ...(placed ? { ax: raw.ax, x: raw.x, ay: raw.ay, y: raw.y } : { ax: 'right', x: 24, ay: 'top', y: 200 }),
    expanded: Boolean(raw.expanded),
    hideDone: Boolean(raw.hideDone),
    color: STICKY_COLORS.some((c) => c.id === raw.color) ? raw.color : null,
    z: finite(raw.z) ? raw.z : 0,
  };
}

/** Cards keyed by note id (numbers come back from JSON as strings). */
export function normalizeStickies(input) {
  const cards = {};
  const raw = input && typeof input === 'object' && input.cards && typeof input.cards === 'object' ? input.cards : {};
  for (const [key, value] of Object.entries(raw)) {
    const card = normalizeCard(value);
    if (card) cards[key] = card;
  }
  // Stacking order as 0..n-1, so z-indexes stay small however often cards are raised.
  Object.entries(cards)
    .sort((a, b) => a[1].z - b[1].z)
    .forEach(([key], i) => {
      cards[key] = { ...cards[key], z: i };
    });
  return { version: 1, cards };
}

function read() {
  try {
    return normalizeStickies(JSON.parse(localStorage.getItem(STICKY_STORAGE_KEY) || 'null'));
  } catch {
    return normalizeStickies(null);
  }
}

let state = null;
const listeners = new Set();
const getState = () => {
  if (!state) state = typeof localStorage === 'undefined' ? normalizeStickies(null) : read();
  return state;
};

function save(next) {
  state = normalizeStickies(next);
  try {
    if (Object.keys(state.cards).length) localStorage.setItem(STICKY_STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STICKY_STORAGE_KEY);
  } catch {
    // Not saved (storage full or blocked): still applies for this session.
  }
  for (const listener of [...listeners]) listener();
}

let storageAttached = false;
function subscribe(listener) {
  listeners.add(listener);
  if (!storageAttached && typeof window !== 'undefined') {
    storageAttached = true;
    window.addEventListener('storage', (e) => {
      if (e.key !== STICKY_STORAGE_KEY && e.key !== null) return;
      state = read();
      for (const l of [...listeners]) l();
    });
  }
  return () => listeners.delete(listener);
}

export function useStickies() {
  return useSyncExternalStore(subscribe, getState, getState);
}

export const getStickies = getState;
export const isOnDesktop = (id) => Boolean(getState().cards[String(id)]);

const topZ = () => Object.values(getState().cards).reduce((z, c) => Math.max(z, c.z + 1), 0);

/** Puts a note on the desktop at `position` (anchors), in front of the other cards. */
export function pinToDesktop(id, position) {
  const key = String(id);
  const cards = getState().cards;
  save({ cards: { ...cards, [key]: { ...(cards[key] || {}), ...position, z: topZ() } } });
}

export function removeFromDesktop(id) {
  const key = String(id);
  const { [key]: gone, ...cards } = getState().cards;
  if (gone) save({ cards });
}

/** Updates a card: { ax, x, ay, y } after a drag, expanded, hideDone. */
export function updateSticky(id, patch) {
  const key = String(id);
  const cards = getState().cards;
  if (!cards[key]) return;
  save({ cards: { ...cards, [key]: { ...cards[key], ...patch } } });
}

/** Brings a card in front of the others. */
export function raiseSticky(id) {
  const key = String(id);
  const cards = getState().cards;
  if (!cards[key] || cards[key].z === topZ() - 1) return;
  save({ cards: { ...cards, [key]: { ...cards[key], z: topZ() } } });
}

/** Drops cards whose note no longer exists (deleted here or in another tab). */
export function pruneStickies(noteIds) {
  const keep = new Set([...noteIds].map(String));
  const cards = getState().cards;
  const kept = Object.fromEntries(Object.entries(cards).filter(([key]) => keep.has(key)));
  if (Object.keys(kept).length !== Object.keys(cards).length) save({ cards: kept });
}

/** For tests. */
export function _resetStickies() {
  state = null;
  listeners.clear();
}
