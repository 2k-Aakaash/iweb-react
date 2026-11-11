// Moving, resizing and snapping app windows, as in macOS (used by useMacWindow.js).
//
//   Move     drag the title area (the window's top 44px, not its buttons or fields)
//   Resize   drag any edge or corner (a 6px band inside the border)
//   Snap     drop on the left or right edge of the screen: that half; on the top: fill it
//   Zoom     double-click the title area (the green button)
//
// A window's frame (where it is and how big) is kept per app in localStorage and put back when
// it opens. It's applied with the CSS `translate` property and an inline size, so the windows'
// own CSS (which centres them) stays as it is, and the zoom and genie animations (which use
// `transform`) still work. Zoomed or snapped, a window drops its frame and remembers it for
// when it's dragged out again.

const STORAGE_KEY = 'iweb:windowFrames';
const TITLE_H = 44;
const EDGE = 6;
const MIN_W = 380;
const MIN_H = 280;
const KEEP_VISIBLE = 80; // px of a window kept on screen when it's dragged off an edge
const MARGIN = 12;
const NO_DRAG = 'button, a, input, textarea, select, label, [contenteditable="true"], [role="button"], [role="slider"], [role="tab"], [role="radio"], [draggable="true"], .no-window-drag';

export const SNAP_ZONES = ['left', 'right', 'fill'];

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

export function loadFrame(app) {
  const f = readAll()[app];
  return f && [f.left, f.top, f.width, f.height].every(Number.isFinite) ? f : null;
}

export function saveFrame(app, frame) {
  const all = readAll();
  if (frame) all[app] = frame;
  else delete all[app];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage blocked: the window keeps its frame until the page closes.
  }
}

const topLimit = () => {
  const space = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--menubar-space')) || 0;
  return Math.max(0, space);
};

/** `frame` moved and sized so it fits the screen and its title area stays reachable. */
export function clampFrame(frame, vw = window.innerWidth, vh = window.innerHeight, top = topLimit()) {
  const width = Math.round(Math.min(Math.max(frame.width, MIN_W), vw - MARGIN * 2));
  const height = Math.round(Math.min(Math.max(frame.height, MIN_H), vh - top - MARGIN));
  const left = Math.round(Math.min(Math.max(frame.left, KEEP_VISIBLE - width), vw - KEEP_VISIBLE));
  const y = Math.round(Math.min(Math.max(frame.top, top), vh - TITLE_H));
  return { left, top: y, width, height };
}

/** Which snap zone the pointer is in while dragging a window, if any. */
export function snapZoneAt(x, y, vw = window.innerWidth, top = topLimit()) {
  if (y <= top + 2) return 'fill';
  if (x <= 2) return 'left';
  if (x >= vw - 3) return 'right';
  return null;
}

/**
 * The edge or corner under the pointer ('n', 'se'…), or '' — for a window's rect. The band
 * reaches `band` px inside the border and `outside` px beyond it (rounded corners leave the
 * very corner outside the window itself).
 */
export function edgeAt(rect, x, y, band = EDGE, outside = 4) {
  if (x < rect.left - outside || x > rect.right + outside || y < rect.top - outside || y > rect.bottom + outside) return '';
  const n = y - rect.top <= band;
  const s = rect.bottom - y <= band;
  const w = x - rect.left <= band;
  const e = rect.right - x <= band;
  return `${n ? 'n' : s ? 's' : ''}${w ? 'w' : e ? 'e' : ''}`;
}

/** The new frame while dragging edge `edge` by (dx, dy) from `start`. */
export function resizeFrame(start, edge, dx, dy) {
  let { left, top, width, height } = start;
  if (edge.includes('e')) width = Math.max(MIN_W, start.width + dx);
  if (edge.includes('s')) height = Math.max(MIN_H, start.height + dy);
  if (edge.includes('w')) {
    width = Math.max(MIN_W, start.width - dx);
    left = start.left + start.width - width;
  }
  if (edge.includes('n')) {
    height = Math.max(MIN_H, start.height - dy);
    top = start.top + start.height - height;
  }
  return { left, top, width, height };
}

// ── Applying a frame to a window element ──────────────────────────────────────────────────

const SIZE_PROPS = ['width', 'height', 'max-width', 'max-height', 'min-height', 'min-width', 'box-sizing'];

/** Puts the window at `frame` (viewport px), or back to its own CSS (null). */
export function applyFrame(el, frame) {
  if (!el) return;
  el.style.removeProperty('translate');
  if (!frame) {
    SIZE_PROPS.forEach((p) => el.style.removeProperty(p));
    return;
  }
  // The frame is the window's outer box, padding and border included.
  el.style.setProperty('box-sizing', 'border-box', 'important');
  el.style.setProperty('width', `${frame.width}px`, 'important');
  el.style.setProperty('height', `${frame.height}px`, 'important');
  el.style.setProperty('max-width', 'none', 'important');
  el.style.setProperty('max-height', 'none', 'important');
  el.style.setProperty('min-height', '0', 'important');
  el.style.setProperty('min-width', '0', 'important');
  // Where its own CSS puts it at this size; the difference is the translate.
  const natural = el.getBoundingClientRect();
  el.style.translate = `${Math.round(frame.left - natural.left)}px ${Math.round(frame.top - natural.top)}px`;
}

export function frameOf(el) {
  const r = el.getBoundingClientRect();
  return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
}

// ── The snap preview (a glass outline where the window will land) ──────────────────────────

let preview = null;
export function showSnapPreview(zone) {
  if (!zone) {
    preview?.classList.remove('is-shown');
    return;
  }
  if (!preview) {
    preview = document.createElement('div');
    preview.className = 'window-snap-preview';
    preview.setAttribute('aria-hidden', 'true');
    document.body.appendChild(preview);
  }
  preview.dataset.zone = zone;
  // Next frame, so a first show still animates in.
  requestAnimationFrame(() => preview?.classList.add('is-shown'));
}

export const isNoDragTarget = (target) => Boolean(target?.closest?.(NO_DRAG));
export const TITLE_HEIGHT = TITLE_H;
