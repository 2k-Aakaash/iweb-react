import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  addToStack,
  addableItems,
  alignRect,
  detachFromStack,
  isSlotted,
  nearestFreeSlot,
  normalizeLayout,
  placementOf,
  resolveOverlap,
  resolvePosition,
  setDesktopTopInset,
  sizeLabel,
  slotWidgets,
  toAnchored,
  toSlot,
} from '../layout';

const VW = 1440;
const VH = 900;

describe('desktop layout', () => {
  afterEach(() => setDesktopTopInset(0));

  it('fills in missing or broken items from the default layout', () => {
    const layout = normalizeLayout({
      news: { ax: 'right', x: 40, ay: 'bottom', y: 120, size: 'large', hidden: true },
      clock: { ax: 'sideways', x: 1, ay: 'top', y: 2 },
      search: { ax: 'left', x: 'far', ay: 'top', y: 0 },
      stack: { ax: 'left', x: 20, ay: 'top', y: 20, size: 'large', hidden: true },
    });
    expect(layout.news).toEqual({ ax: 'right', x: 40, ay: 'bottom', y: 120, size: 'large', hidden: true });
    expect(layout.clock).toMatchObject({ ax: 'center', x: 0, ay: 'middle', hidden: false });
    expect(layout.search.ax).toBe('center');
    // The Smart Stack has no large size; it stays hideable.
    expect(layout.stack).toMatchObject({ size: 'small', hidden: true });
    expect(normalizeLayout(null)).toEqual(normalizeLayout(DEFAULT_LAYOUT));
  });

  it('resolves anchors to a position, keeping items on screen', () => {
    expect(resolvePosition({ ax: 'right', x: 15, ay: 'top', y: 15 }, 150, 150, VW, VH)).toEqual({ left: 1275, top: 15 });
    // With the menu bar kept on the desktop, never under it (32px + 12px margin).
    setDesktopTopInset(32);
    expect(resolvePosition({ ax: 'right', x: 15, ay: 'top', y: 15 }, 150, 150, VW, VH)).toEqual({ left: 1275, top: 44 });
    expect(resolvePosition({ ax: 'right', x: 15, ay: 'top', y: 60 }, 150, 150, VW, VH)).toEqual({ left: 1275, top: 60 });
    expect(resolvePosition({ ax: 'center', x: 0, ay: 'middle', y: 0 }, 300, 100, VW, VH)).toEqual({ left: 570, top: 400 });
    expect(resolvePosition({ ax: 'left', x: -500, ay: 'bottom', y: -500 }, 150, 150, VW, VH)).toEqual({ left: 12, top: 738 });
  });

  it('anchors a rect to the edge or centre it is nearest to, on the grid', () => {
    expect(toAnchored({ left: 21, top: 17, w: 150, h: 150 }, VW, VH)).toEqual({ ax: 'left', x: 24, ay: 'top', y: 16 });
    expect(toAnchored({ left: 1270, top: 700, w: 150, h: 150 }, VW, VH)).toEqual({ ax: 'right', x: 24, ay: 'bottom', y: 48 });
    // Today's clock: centred, 6.5px above the middle → snapped to −8 (the default layout).
    expect(toAnchored({ left: 571, top: 380, w: 297, h: 127 }, VW, VH)).toEqual({ ax: 'center', x: 0, ay: 'middle', y: -8 });
    // Round trip: a rect on the grid (120px from the right, 152px from the bottom) resolves
    // back to itself; anything else lands on the nearest grid position.
    const anchored = toAnchored({ left: 1004, top: 598, w: 316, h: 150 }, VW, VH);
    expect(anchored).toEqual({ ax: 'right', x: 120, ay: 'bottom', y: 152 });
    expect(resolvePosition(anchored, 316, 150, VW, VH)).toEqual({ left: 1004, top: 598 });
  });

  it('snaps to the screen centre and to other items, with guides', () => {
    const { rect, guides } = alignRect({ left: 568, top: 300, w: 300, h: 100 }, [], VW, VH);
    expect(rect.left).toBe(570); // centre line at 720
    expect(guides.x).toBe(720);
    const other = { left: 100, top: 200, w: 150, h: 150 };
    const aligned = alignRect({ left: 104, top: 600, w: 150, h: 150 }, [other], VW, VH);
    expect(aligned.rect.left).toBe(100);
    expect(aligned.guides).toEqual({ x: 100, y: null });
  });

  it('moves a dropped item to the nearest free spot instead of overlapping', () => {
    const other = { left: 100, top: 100, w: 150, h: 150 };
    const free = { left: 600, top: 400, w: 150, h: 150 };
    expect(resolveOverlap(free, [other], VW, VH)).toEqual(free);
    const moved = resolveOverlap({ left: 120, top: 110, w: 150, h: 150 }, [other], VW, VH);
    expect(moved).not.toBeNull();
    const clear = moved.left >= other.left + other.w + 10 || moved.top >= other.top + other.h + 10
      || moved.left + moved.w + 10 <= other.left || moved.top + moved.h + 10 <= other.top;
    expect(clear).toBe(true);
    // Nothing fits on a tiny screen.
    expect(resolveOverlap({ left: 0, top: 0, w: 150, h: 150 }, [], 100, 100)).toBeNull();
  });

  it('keeps stack widgets in the stack or on the desktop, never both', () => {
    const start = normalizeLayout(null);
    expect(start.stack.pages).toEqual(['weather', 'currency', 'metals', 'markets']);
    expect(placementOf(start, 'weather')).toBe('stack');

    const detached = detachFromStack(start, 'weather', { ax: 'left', x: 40, ay: 'top', y: 200 });
    expect(detached.stack.pages).toEqual(['currency', 'metals', 'markets']);
    expect(detached.weather).toMatchObject({ hidden: false, ax: 'left', x: 40, y: 200 });
    expect(placementOf(detached, 'weather')).toBe('desktop');

    const back = addToStack(detached, 'weather');
    expect(back.stack.pages).toEqual(['currency', 'metals', 'markets', 'weather']);
    expect(placementOf(back, 'weather')).toBe('stack');

    // A widget saved as both on the desktop and in the stack is shown on the desktop only;
    // unknown or repeated pages are dropped.
    const fixed = normalizeLayout({ weather: { ...start.weather, hidden: false }, stack: { ...start.stack, pages: ['weather', 'bogus', 'markets', 'markets'] } });
    expect(fixed.stack.pages).toEqual(['markets']);
    // Removed from both: hidden.
    expect(placementOf(normalizeLayout({ stack: { ...start.stack, pages: [] } }), 'metals')).toBe('hidden');
  });

  it('offers removed items to add back, but not ones in the stack or an empty stack', () => {
    const start = normalizeLayout(null);
    expect(addableItems(start)).toEqual([]);
    const removed = normalizeLayout({ ...start, search: { ...start.search, hidden: true }, stack: { ...start.stack, pages: ['weather'] } });
    expect(addableItems(removed)).toEqual(['search', 'currency', 'metals', 'markets']);
    const empty = normalizeLayout({ ...start, stack: { ...start.stack, hidden: true, pages: [] } });
    expect(addableItems(empty)).not.toContain('stack');
  });

  it('lets the search bar be removed (Ctrl K still opens Spotlight)', () => {
    expect(normalizeLayout({ search: { ...DEFAULT_LAYOUT.search, hidden: true } }).search.hidden).toBe(true);
    expect(normalizeLayout({ clock: { ...DEFAULT_LAYOUT.clock, hidden: true } }).clock.hidden).toBe(false);
  });

  it('snaps widgets to slots: 150px cells, 16px gutters, rows from the top', () => {
    expect(toSlot({ left: 20, top: 20, w: 150, h: 150 }, VW)).toEqual({ ax: 'left', x: 16, ay: 'top', y: 16 });
    expect(toSlot({ left: 240, top: 30, w: 150, h: 150 }, VW)).toEqual({ ax: 'left', x: 182, ay: 'top', y: 16 });
    // On the right half, columns count from the right edge.
    expect(toSlot({ left: 1270, top: 700, w: 150, h: 150 }, VW)).toEqual({ ax: 'right', x: 16, ay: 'top', y: 680 });
    expect(isSlotted({ ax: 'left', x: 182, ay: 'top', y: 348 })).toBe(true);
    expect(isSlotted({ ax: 'left', x: 182, ay: 'bottom', y: 16 })).toBe(false);
    expect(isSlotted({ ax: 'left', x: 20, ay: 'top', y: 16 })).toBe(false);
    expect(isSlotted({ ax: 'center', x: 16, ay: 'top', y: 16 })).toBe(false);
  });

  it('starts the rows under the menu bar when it stays on the desktop', () => {
    setDesktopTopInset(32);
    expect(toSlot({ left: 20, top: 20, w: 150, h: 150 }, VW)).toEqual({ ax: 'left', x: 16, ay: 'top', y: 48 });
    expect(isSlotted({ ax: 'left', x: 182, ay: 'top', y: 380 })).toBe(true);
    // Rows for a hidden bar (16, 182, …) are off this grid, so snapToSlots moves them down.
    expect(isSlotted({ ax: 'left', x: 182, ay: 'top', y: 348 })).toBe(false);
    expect(nearestFreeSlot({ left: 16, top: 16, w: 150, h: 150 }, [], VW, VH).pos).toEqual({ ax: 'left', x: 16, ay: 'top', y: 48 });
  });

  it('lands a widget in the nearest free slot', () => {
    const taken = { left: 16, top: 16, w: 150, h: 150 };
    const landing = nearestFreeSlot({ left: 30, top: 25, w: 150, h: 150 }, [taken], VW, VH);
    expect(landing.pos).toEqual({ ax: 'left', x: 182, ay: 'top', y: 16 });
    expect(landing.rect).toEqual({ left: 182, top: 16, w: 150, h: 150 });
    // A medium widget needs two free cells side by side.
    const medium = nearestFreeSlot({ left: 16, top: 16, w: 316, h: 150 }, [{ left: 182, top: 16, w: 150, h: 150 }], VW, VH);
    expect(medium.pos).toEqual({ ax: 'left', x: 16, ay: 'top', y: 182 });
    expect(nearestFreeSlot({ left: 0, top: 0, w: 150, h: 150 }, [{ left: 0, top: 0, w: VW, h: VH }], VW, VH)).toBeNull();
  });

  it('lines up a freely arranged desktop on the slot grid, keeping the order', () => {
    // The arrangement from the screenshot (at 125%, so in CSS px): uneven edges and gaps.
    const start = normalizeLayout(null);
    const messy = normalizeLayout({
      ...start,
      currency: { ax: 'left', x: 16, ay: 'top', y: 16, size: 'small', hidden: false },
      weather: { ax: 'left', x: 192, ay: 'top', y: 16, size: 'small', hidden: false },
      metals: { ax: 'left', x: 24, ay: 'top', y: 194, size: 'medium', hidden: false },
      markets: { ax: 'left', x: 352, ay: 'top', y: 194, size: 'small', hidden: false },
      news: { ax: 'left', x: 24, ay: 'top', y: 378, size: 'medium', hidden: false },
      stack: { ...start.stack, pages: [] },
    });
    const tidy = slotWidgets(messy, 1536, 724);
    const at = (id) => [tidy[id].x, tidy[id].y];
    expect(at('currency')).toEqual([16, 16]);
    expect(at('weather')).toEqual([182, 16]);
    expect(at('metals')).toEqual([16, 182]);
    expect(at('markets')).toEqual([348, 182]);
    expect(at('news')).toEqual([16, 348]);
  });

  it('names sizes per item', () => {
    expect(sizeLabel('news', 'medium')).toBe('Medium');
    expect(sizeLabel('search', 'large')).toBe('Wide');
  });
});
