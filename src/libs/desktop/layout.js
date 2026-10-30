// The iWeb desktop layout: where each movable item sits and at what size (Edit Widgets).
//
// A position is kept relative to the nearest edge or the centre of the screen, macOS-style,
// so an arrangement survives window resizes:
//   ax: 'left' | 'center' | 'right'   x: px from that edge (centre: offset of the item's centre)
//   ay: 'top'  | 'middle' | 'bottom'  y: likewise
// Pure functions only (tested); the React side lives in src/components/desktop/.

export const GRID = 8; // positions snap to this
export const MARGIN = 12; // items stay this far inside the screen
export const MENUBAR_H = 32; // the menu bar across the top (--menubar-h in menubar.css)

// Space the menu bar takes at the top of the desktop: MENUBAR_H when it stays on the desktop,
// 0 when it hides there (Settings → Appearance → Menu Bar; it then overlays when revealed).
let topInset = 0;
export function setDesktopTopInset(px) {
  topInset = px;
}
export const topMargin = () => topInset + MARGIN; // nothing goes under the menu bar
export const topEdge = () => topInset + EDGE; // the first row of widget slots
export const GAP = 10; // minimum space between items
export const SNAP_DISTANCE = 6; // alignment guides pull within this distance

// macOS widget sizes: small = square, medium = two smalls wide, large = 2 × 2.
export const WIDGET_SIZES = Object.freeze({
  small: { w: 150, h: 150 },
  medium: { w: 316, h: 150 },
  large: { w: 316, h: 316 },
});

// Widgets sit in slots, as on macOS 26: an invisible grid of 150px cells with a 16px gutter,
// starting EDGE in (rows: EDGE under the menu bar when it's shown on the desktop). Rows count from the top; columns from the left on the left half of the
// screen and from the right on the right half (so widgets hug either edge). A medium widget
// is two cells and a gutter wide, so every widget lines up with its neighbours.
export const EDGE = 16;
export const GUTTER = 16;
export const PITCH = WIDGET_SIZES.small.w + GUTTER; // 166

// Movable items. Widgets have fixed sizes from WIDGET_SIZES; the clock and search bar scale.
// `stackable` widgets can live in the Smart Stack (stack.pages) or on the desktop on their own,
// never both. The search bar can be removed: Ctrl K still opens Spotlight.
export const ITEMS = Object.freeze({
  clock: { label: 'Clock', kind: 'scale', sizes: ['small', 'medium', 'large'], removable: false },
  search: { label: 'Search Bar', kind: 'scale', sizes: ['small', 'medium', 'large'], removable: true },
  news: { label: 'News', kind: 'widget', sizes: ['small', 'medium', 'large'], removable: true },
  stack: { label: 'Smart Stack', kind: 'widget', sizes: ['small', 'medium'], removable: true },
  weather: { label: 'Weather', kind: 'widget', sizes: ['small', 'medium'], removable: true, stackable: true },
  currency: { label: 'Currency Converter', kind: 'widget', sizes: ['small', 'medium'], removable: true, stackable: true },
  metals: { label: 'Gold & Silver', kind: 'widget', sizes: ['small', 'medium'], removable: true, stackable: true },
  markets: { label: 'Markets', kind: 'widget', sizes: ['small', 'medium'], removable: true, stackable: true },
});

export const STACKABLE = Object.freeze(Object.keys(ITEMS).filter((id) => ITEMS[id].stackable));

export const SIZE_LABELS = Object.freeze({
  scale: { small: 'Small', medium: 'Medium', large: 'Large' },
  search: { small: 'Narrow', medium: 'Regular', large: 'Wide' },
  widget: { small: 'Small', medium: 'Medium', large: 'Large' },
});

export function sizeLabel(id, size) {
  const table = id === 'search' ? SIZE_LABELS.search : SIZE_LABELS[ITEMS[id]?.kind] || SIZE_LABELS.widget;
  return table[size] || size;
}

// Today's arrangement (measured from the original layout; rows sit lower when the menu bar
// stays on the desktop: snapToSlots moves them): News top-left, Smart Stack
// top-right, the clock centred just above the middle with the search bar under it.
// The stack holds Weather, Currency, Gold & Silver and Markets; on their own they start hidden.
export const DEFAULT_LAYOUT = Object.freeze({
  clock: { ax: 'center', x: 0, ay: 'middle', y: -8, size: 'medium', hidden: false },
  search: { ax: 'center', x: 0, ay: 'middle', y: 96, size: 'medium', hidden: false },
  news: { ax: 'left', x: 16, ay: 'top', y: 16, size: 'medium', hidden: false },
  stack: { ax: 'right', x: 16, ay: 'top', y: 16, size: 'small', hidden: false, pages: ['weather', 'currency', 'metals', 'markets'] },
  weather: { ax: 'left', x: 16, ay: 'top', y: 182, size: 'small', hidden: true },
  currency: { ax: 'left', x: 182, ay: 'top', y: 182, size: 'small', hidden: true },
  metals: { ax: 'left', x: 16, ay: 'top', y: 348, size: 'small', hidden: true },
  markets: { ax: 'left', x: 182, ay: 'top', y: 348, size: 'small', hidden: true },
});

const AX = ['left', 'center', 'right'];
const AY = ['top', 'middle', 'bottom'];
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** A layout with every item present and valid (unknown or broken entries fall back). */
export function normalizeLayout(raw) {
  const out = {};
  for (const [id, def] of Object.entries(DEFAULT_LAYOUT)) {
    const item = raw && typeof raw === 'object' ? raw[id] : null;
    const ok = item && AX.includes(item.ax) && AY.includes(item.ay) && finite(item.x) && finite(item.y);
    out[id] = {
      ...(ok ? { ax: item.ax, x: item.x, ay: item.ay, y: item.y } : { ax: def.ax, x: def.x, ay: def.ay, y: def.y }),
      size: ITEMS[id].sizes.includes(item?.size) ? item.size : def.size,
      hidden: ITEMS[id].removable ? Boolean(item?.hidden ?? def.hidden) : false,
    };
  }
  // Stack pages: known stackable widgets, each once, in order; a widget shown on the desktop
  // on its own is never also in the stack.
  const rawPages = Array.isArray(raw?.stack?.pages) ? raw.stack.pages : DEFAULT_LAYOUT.stack.pages;
  out.stack.pages = [...new Set(rawPages)].filter((id) => STACKABLE.includes(id) && out[id].hidden);
  return out;
}

/** Takes a widget out of the Smart Stack and shows it on the desktop (at `position`). */
export function detachFromStack(layout, id, position = null) {
  return normalizeLayout({
    ...layout,
    stack: { ...layout.stack, pages: layout.stack.pages.filter((page) => page !== id) },
    [id]: { ...layout[id], ...(position || {}), hidden: false },
  });
}

/** Puts a widget into the Smart Stack (its desktop copy goes away) and shows the stack. */
export function addToStack(layout, id) {
  if (!STACKABLE.includes(id)) return layout;
  return normalizeLayout({
    ...layout,
    stack: { ...layout.stack, hidden: false, pages: [...layout.stack.pages.filter((page) => page !== id), id] },
    [id]: { ...layout[id], hidden: true },
  });
}

/** Where an item is: 'desktop', 'stack' or 'hidden'. */
export function placementOf(layout, id) {
  if (!layout[id].hidden) return 'desktop';
  return layout.stack.pages.includes(id) ? 'stack' : 'hidden';
}

/** Items that can be added back to the desktop: removed ones (not on it, not in the stack). */
export function addableItems(layout) {
  return Object.keys(ITEMS).filter((id) => placementOf(layout, id) === 'hidden' && (id !== 'stack' || layout.stack.pages.length > 0));
}

/** Top-left of an item of size w×h for its anchors, kept on screen. */
export function resolvePosition(pos, w, h, vw, vh) {
  let left;
  if (pos.ax === 'left') left = pos.x;
  else if (pos.ax === 'right') left = vw - pos.x - w;
  else left = vw / 2 + pos.x - w / 2;
  let top;
  if (pos.ay === 'top') top = pos.y;
  else if (pos.ay === 'bottom') top = vh - pos.y - h;
  else top = vh / 2 + pos.y - h / 2;
  return {
    left: Math.round(Math.min(Math.max(left, MARGIN), Math.max(MARGIN, vw - w - MARGIN))),
    top: Math.round(Math.min(Math.max(top, topMargin()), Math.max(topMargin(), vh - h - MARGIN))),
  };
}

const snap = (n) => Math.round(n / GRID) * GRID || 0; // `|| 0`: never -0

/** Anchors for a rect: the edge or centre it is nearest to (by thirds of the screen), snapped. */
export function toAnchored(rect, vw, vh) {
  const cx = rect.left + rect.w / 2;
  const cy = rect.top + rect.h / 2;
  const ax = cx < vw / 3 ? 'left' : cx > (vw * 2) / 3 ? 'right' : 'center';
  const ay = cy < vh / 3 ? 'top' : cy > (vh * 2) / 3 ? 'bottom' : 'middle';
  const x = ax === 'left' ? rect.left : ax === 'right' ? vw - rect.left - rect.w : cx - vw / 2;
  const y = ay === 'top' ? rect.top : ay === 'bottom' ? vh - rect.top - rect.h : cy - vh / 2;
  return { ax, x: snap(x), ay, y: snap(y) };
}

// ---- Widget slots ------------------------------------------------------------------------

const slotOffset = (d, start = EDGE) => start + Math.max(0, Math.round((d - start) / PITCH)) * PITCH;

/** Anchors of the slot nearest to a widget rect. */
export function toSlot(rect, vw) {
  const ax = rect.left + rect.w / 2 < vw / 2 ? 'left' : 'right';
  const dx = ax === 'left' ? rect.left : vw - rect.left - rect.w;
  return { ax, x: slotOffset(dx), ay: 'top', y: slotOffset(rect.top, topEdge()) };
}

/** True when anchors sit exactly on a slot. */
export function isSlotted(pos) {
  const on = (d, start) => d >= start && (d - start) % PITCH === 0;
  return (pos.ax === 'left' || pos.ax === 'right') && pos.ay === 'top' && on(pos.x, EDGE) && on(pos.y, topEdge());
}

/**
 * The free slot nearest to `rect` (a widget being placed), as { pos, rect }, or null when no
 * slot is free. Each half of the screen uses its own columns (left half from the left edge,
 * right half from the right), so widgets on one side always line up with each other. A slot
 * is free when the widget fits on screen and keeps GAP from every rect in `others` (other
 * items, the Dynamic Island, the Dock).
 */
export function nearestFreeSlot(rect, others, vw, vh) {
  const { w, h } = rect;
  const preferred = toSlot(rect, vw);
  const fits = (r) => r.left >= MARGIN && r.top >= topMargin() && r.left + w <= vw - MARGIN && r.top + h <= vh - MARGIN
    && !others.some((o) => overlaps({ ...r, w, h }, o));
  let best = null;
  const cols = Math.max(1, Math.floor((vw - EDGE) / PITCH));
  const rows = Math.max(1, Math.floor((vh - topEdge()) / PITCH));
  for (const ax of ['left', 'right']) {
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const pos = { ax, x: EDGE + i * PITCH, ay: 'top', y: topEdge() + j * PITCH };
        const left = ax === 'left' ? pos.x : vw - pos.x - w;
        const r = { left, top: pos.y, w, h };
        // Only the columns of the half the slot is in (no interleaved grids mid-screen).
        if ((ax === 'left') !== (left + w / 2 < vw / 2)) continue;
        if (!fits(r)) continue;
        // Nearest by position; the snapped slot itself wins ties.
        const dist = (left - rect.left) ** 2 + (pos.y - rect.top) ** 2 - (ax === preferred.ax ? 0.5 : 0);
        if (!best || dist < best.dist) best = { pos, rect: r, dist };
      }
    }
  }
  return best && { pos: best.pos, rect: best.rect };
}

/**
 * Moves every visible widget onto a slot (an older, freely placed layout), keeping their
 * order: top to bottom, left to right, each to the free slot nearest where it was.
 * `fixed`: rects that stay put (the clock, the search bar, the island, the Dock).
 */
export function slotWidgets(layout, vw, vh, fixed = []) {
  const placed = [...fixed];
  const out = { ...layout };
  const widgets = Object.keys(ITEMS)
    .filter((id) => ITEMS[id].kind === 'widget' && !layout[id].hidden)
    .map((id) => {
      const { w, h } = WIDGET_SIZES[layout[id].size];
      return { id, rect: { ...resolvePosition(layout[id], w, h, vw, vh), w, h } };
    })
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
  for (const { id, rect } of widgets) {
    const slot = nearestFreeSlot(rect, placed, vw, vh);
    if (!slot) continue;
    out[id] = { ...layout[id], ...slot.pos };
    placed.push(slot.rect);
  }
  return out;
}

const overlaps = (a, b, gap = GAP) =>
  a.left < b.left + b.w + gap && b.left < a.left + a.w + gap && a.top < b.top + b.h + gap && b.top < a.top + a.h + gap;

/**
 * Alignment while dragging: snaps `rect` to the screen centre and to other items' edges and
 * centres within SNAP_DISTANCE. Returns the snapped rect and the guide lines to draw.
 */
export function alignRect(rect, others, vw, vh) {
  const xs = [{ at: vw / 2, kind: 'center' }];
  const ys = [{ at: vh / 2, kind: 'center' }];
  for (const o of others) {
    xs.push({ at: o.left }, { at: o.left + o.w }, { at: o.left + o.w / 2 });
    ys.push({ at: o.top }, { at: o.top + o.h }, { at: o.top + o.h / 2 });
  }
  const best = (edges, lines) => {
    let found = null;
    for (const edge of edges) {
      for (const line of lines) {
        const d = line.at - edge;
        if (Math.abs(d) <= SNAP_DISTANCE && (!found || Math.abs(d) < Math.abs(found.d))) found = { d, at: line.at };
      }
    }
    return found;
  };
  const sx = best([rect.left, rect.left + rect.w / 2, rect.left + rect.w], xs);
  const sy = best([rect.top, rect.top + rect.h / 2, rect.top + rect.h], ys);
  return {
    rect: { ...rect, left: rect.left + (sx?.d || 0), top: rect.top + (sy?.d || 0) },
    guides: { x: sx ? sx.at : null, y: sy ? sy.at : null },
  };
}

/** `rect` itself if it overlaps nothing, else the nearest free spot on screen (or null). */
export function resolveOverlap(rect, others, vw, vh, { step = GRID, maxDistance = 600 } = {}) {
  const fits = (r) =>
    r.left >= MARGIN && r.top >= topMargin() && r.left + r.w <= vw - MARGIN && r.top + r.h <= vh - MARGIN
    && !others.some((o) => overlaps(r, o));
  if (fits(rect)) return rect;
  // Rings of growing radius around the drop point; the first free candidate is the nearest.
  for (let radius = step; radius <= maxDistance; radius += step) {
    let best = null;
    for (let dx = -radius; dx <= radius; dx += step) {
      for (const dy of [-radius, radius]) {
        const candidate = { ...rect, left: rect.left + dx, top: rect.top + dy };
        const dist = dx * dx + dy * dy;
        if (fits(candidate) && (!best || dist < best.dist)) best = { candidate, dist };
      }
    }
    for (let dy = -radius + step; dy < radius; dy += step) {
      for (const dx of [-radius, radius]) {
        const candidate = { ...rect, left: rect.left + dx, top: rect.top + dy };
        const dist = dx * dx + dy * dy;
        if (fits(candidate) && (!best || dist < best.dist)) best = { candidate, dist };
      }
    }
    if (best) return best.candidate;
  }
  return null;
}
