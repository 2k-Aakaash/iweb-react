// Geometry for the macOS "genie" minimise effect, after Harshil Shah's "Recreating the macOS
// Genie Effect". Pure functions, screen coordinates (y grows downwards).
//
// The effect is two overlapping sub-animations over one progress value f (0 = window shown,
// 1 = fully inside the target):
//   slide     (f 0 → SLIDE_END):        the bottom ends of the two funnel curves move from the
//                                       window's side edges to the target's side edges.
//   translate (f TRANSLATE_START → 1):  the window travels down between the curves.
// The phase boundaries and easings were measured frame by frame from a recording of the real
// macOS minimise: the slide eases in and out over the first ~45%, and the window starts
// travelling at ~25% and then moves almost linearly, with a slightly soft start.
// Each curve runs from the window's top edge to the target's top edge and is shaped by a
// quadratic ease-in-out; above it the funnel is the window's width, below it the target's.

export const SLIDE_END = 0.45;
export const TRANSLATE_START = 0.25;
const TRANSLATE_EASE_POWER = 1.15;

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export const quadraticEaseInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

export function phases(f) {
  return {
    slide: quadraticEaseInOut(clamp01(f / SLIDE_END)),
    translate: clamp01((f - TRANSLATE_START) / (1 - TRANSLATE_START)) ** TRANSLATE_EASE_POWER,
  };
}

const flip = (r) => ({ left: r.left, right: r.right, top: -r.bottom, bottom: -r.top });

/**
 * Mesh rows for progress f. Returns rows + 1 edges from the window's top to its bottom, each
 * { y, left, right } in screen coordinates. `win` and `target` are { left, right, top, bottom }.
 * Targets above the window (e.g. a dock at the top) are handled by mirroring vertically.
 */
export function genieRows(win, target, f, rows) {
  if (target.top < win.top) {
    return genieRows(flip(win), flip(target), f, rows)
      .map((r) => ({ ...r, y: -r.y }))
      .reverse();
  }

  const { slide, translate } = phases(f);
  const curveTop = win.top;
  const curveBottom = Math.max(target.top, win.top + 1e-6);
  const curveHeight = curveBottom - curveTop;

  // Edges of the window as it travels; the bottom never passes the target's bottom.
  const travel = translate * (target.top - win.top);
  const topEdge = win.top + travel;
  const bottomEdge = Math.min(win.bottom + travel, target.bottom);

  const leftBottom = win.left + slide * (target.left - win.left);
  const rightBottom = win.right + slide * (target.right - win.right);

  const curveX = (topX, bottomX, y) => {
    if (y <= curveTop) return topX;
    if (y >= curveBottom) return bottomX;
    const fromBottom = quadraticEaseInOut((curveBottom - y) / curveHeight);
    return bottomX + fromBottom * (topX - bottomX);
  };

  const out = [];
  for (let i = 0; i <= rows; i++) {
    const y = topEdge + (bottomEdge - topEdge) * (i / rows);
    out.push({ y, left: curveX(win.left, leftBottom, y), right: curveX(win.right, rightBottom, y) });
  }
  return out;
}

/**
 * CSS matrix3d that maps the rectangle (0, 0, w, h) onto the quad tl, tr, br, bl ({x, y}),
 * with transform-origin 0 0. Projective (Heckbert's square-to-quad), so neighbouring strips
 * share edges exactly. Returns null for a degenerate quad.
 */
export function rectToQuadMatrix(w, h, tl, tr, br, bl) {
  const dx1 = tr.x - br.x;
  const dx2 = bl.x - br.x;
  const dx3 = tl.x - tr.x + br.x - bl.x;
  const dy1 = tr.y - br.y;
  const dy2 = bl.y - br.y;
  const dy3 = tl.y - tr.y + br.y - bl.y;

  let g = 0;
  let k = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 1e-9) return null;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    k = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const a = tr.x - tl.x + g * tr.x;
  const b = bl.x - tl.x + k * bl.x;
  const d = tr.y - tl.y + g * tr.y;
  const e = bl.y - tl.y + k * bl.y;
  if (!Number.isFinite(a + b + d + e) || Math.abs(a * e - b * d) < 1e-6) return null;

  // Column-major: x' = (a·u + b·v + c) / (g·u + k·v + 1), with u = x / w and v = y / h.
  return [a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, tl.x, tl.y, 0, 1];
}

/** Applies a 2D projective matrix from rectToQuadMatrix to a point (for tests/debugging). */
export function applyMatrix(m, x, y) {
  const w = m[3] * x + m[7] * y + m[15];
  return { x: (m[0] * x + m[4] * y + m[12]) / w, y: (m[1] * x + m[5] * y + m[13]) / w };
}
