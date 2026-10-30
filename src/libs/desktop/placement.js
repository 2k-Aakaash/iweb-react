// Free-space queries on the live desktop (DOM): what is occupied, and where a new widget fits.
// The Dynamic Island and the Dock are fixed parts of the screen that items must keep clear of.
import { EDGE, ITEMS, MARGIN, WIDGET_SIZES, nearestFreeSlot, resolveOverlap, toAnchored, topEdge, topMargin } from './layout';

const OBSTACLES = ['nav[data-glass="dock"]'];
const OBSTACLE_PADDING = 8;
// The Dynamic Island's zone at the top centre (style.css: 15px from the top, or 8px under the
// menu bar when it stays on the desktop; up to 320px wide when it opens, 42px tall on hover). Always kept clear: the island only appears once there is music,
// and grows on hover, so its live size isn't enough.
const ISLAND = { w: 320, h: 42 };
const islandTop = () => Math.max(15, topMargin() - 4);

const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, w: r.width, h: r.height };
};

const pad = (r) => ({ left: r.left - OBSTACLE_PADDING, top: r.top - OBSTACLE_PADDING, w: r.w + OBSTACLE_PADDING * 2, h: r.h + OBSTACLE_PADDING * 2 });

/** The Dynamic Island's zone and the Dock, padded. */
export function obstacleRects() {
  const island = { left: window.innerWidth / 2 - ISLAND.w / 2, top: islandTop(), w: ISLAND.w, h: ISLAND.h };
  const live = OBSTACLES.flatMap((selector) => [...document.querySelectorAll(selector)])
    .filter((el) => el.getClientRects().length)
    .map(rectOf);
  return [island, ...live].map(pad);
}

/** Every other desktop item plus the obstacles. */
export function occupiedRects(exceptEl = null) {
  const items = [...document.querySelectorAll('[data-desktop-item]')]
    .filter((el) => el !== exceptEl && el.getClientRects().length)
    .map(rectOf);
  return [...items, ...obstacleRects()];
}

/** Rects that stay put when widgets are re-slotted: the clock, the search bar, the obstacles. */
export function fixedRects() {
  const items = [...document.querySelectorAll('[data-desktop-item]')]
    .filter((el) => ITEMS[el.dataset.desktopItem]?.kind !== 'widget' && el.getClientRects().length)
    .map(rectOf);
  return [...items, ...obstacleRects()];
}

/**
 * Where an item dropped at `rect` lands, as { pos, rect } (null: no room). Widgets take the
 * nearest free slot, measured at their true `size` (in edit mode they're drawn a little
 * smaller); the clock and search bar the nearest free spot, anchored to the nearest edge.
 */
export function landingFor(id, rect, exceptEl = null, size = null) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const others = occupiedRects(exceptEl);
  if (ITEMS[id]?.kind === 'widget') {
    const dim = WIDGET_SIZES[size] || { w: rect.w, h: rect.h };
    const cx = rect.left + rect.w / 2;
    const cy = rect.top + rect.h / 2;
    return nearestFreeSlot({ left: cx - dim.w / 2, top: cy - dim.h / 2, ...dim }, others, vw, vh);
  }
  const free = resolveOverlap(rect, others, vw, vh);
  return free && { pos: toAnchored(free, vw, vh), rect: free };
}

/**
 * Anchors for placing item `id` at `size` in the first free spot, from the top-left like
 * macOS; null when the screen is full.
 */
export function findFreeSpot(id, size) {
  if (ITEMS[id]?.kind === 'widget') {
    const { w, h } = WIDGET_SIZES[size];
    return nearestFreeSlot({ left: EDGE, top: topEdge(), w, h }, occupiedRects(), window.innerWidth, window.innerHeight)?.pos ?? null;
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const dim = { w: 320, h: 140 };
  const occupied = occupiedRects();
  const step = 16;
  for (let top = topMargin() + 3; top + dim.h <= vh - MARGIN; top += step) {
    for (let left = MARGIN + 3; left + dim.w <= vw - MARGIN; left += step) {
      const rect = { left, top, w: dim.w, h: dim.h };
      if (resolveOverlap(rect, occupied, vw, vh, { maxDistance: 0 }) === rect) return toAnchored(rect, vw, vh);
    }
  }
  return null;
}
