// Where a sticky card goes on the desktop: a new one takes the first free spot from the top
// right (clear of widgets, the clock, the Dynamic Island, the Dock and other cards); a
// dragged one lands where it was dropped, nudged clear of the Island and the Dock only
// (cards float over widgets, like windows).
import { MARGIN, resolveOverlap, toAnchored, topMargin } from '../desktop/layout';
import { obstacleRects, occupiedRects } from '../desktop/placement';

export const STICKY_W = 260;
export const STICKY_H = 220; // a compact card with a few tasks, for finding room

const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, w: r.width, h: r.height };
};

const stickyRects = () => [...document.querySelectorAll('[data-sticky-note]')].filter((el) => el.getClientRects().length).map(rectOf);

/** Anchors for a new card. */
export function findStickySpot() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const taken = [...occupiedRects(), ...stickyRects()];
  const step = 16;
  for (let right = MARGIN + 4; right + STICKY_W <= vw - MARGIN; right += step) {
    for (let top = topMargin() + 4; top + STICKY_H <= vh - MARGIN; top += step) {
      const rect = { left: vw - right - STICKY_W, top, w: STICKY_W, h: STICKY_H };
      if (resolveOverlap(rect, taken, vw, vh, { maxDistance: 0 }) === rect) return toAnchored(rect, vw, vh);
    }
  }
  // A full desktop: cascade from the centre, a little lower for every card already there.
  const n = stickyRects().length;
  const rect = { left: (vw - STICKY_W) / 2 + n * 24, top: Math.max(topMargin(), vh / 3 + n * 24), w: STICKY_W, h: STICKY_H };
  return toAnchored(rect, vw, vh);
}

/** Anchors for a card dropped at `rect`, kept on screen and off the Island and the Dock. */
export function landSticky(rect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clamped = {
    ...rect,
    left: Math.min(Math.max(rect.left, MARGIN), Math.max(MARGIN, vw - rect.w - MARGIN)),
    top: Math.min(Math.max(rect.top, topMargin()), Math.max(topMargin(), vh - rect.h - MARGIN)),
  };
  const free = resolveOverlap(clamped, obstacleRects(), vw, vh, { maxDistance: 400 }) || clamped;
  return toAnchored(free, vw, vh);
}
