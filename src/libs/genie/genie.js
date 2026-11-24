// Runs the genie effect on a live DOM element. During the effect the real window is hidden and
// replaced by horizontal strips, each an overflow-clipped copy of the window mapped onto its
// trapezoid of the funnel with a projective matrix3d, so the strips meet without seams. Only
// transforms change per frame (compositor work); the copies are built once per run.
import { genieRows, rectToQuadMatrix } from './geometry';
import { backdropImage, backdropReady } from './backdrop';
import '../../styles/genie.css';

// Measured from the real macOS minimise (~430ms from first bend to inside the icon).
const CLOSE_MS = 440;
const OPEN_MS = 420;
// Restored: the live window takes over from the strips, with their glass still under its own
// glass for a moment while the browser draws its backdrop blur (see handBack).
const SETTLE_MS = 120; // how long the still stays before fading (the blur is ready by then)
const SETTLE_FADE_MS = 220;
const MIN_ROWS = 16;
const MAX_ROWS = 24;
const ROW_PX = 24; // one strip per ~24px: each strip is an exact trapezoid, so this still traces the curve

export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

const rectOf = (r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });

// Where to shrink into when the dock icon is missing or off screen: a small square at the
// bottom centre, where the dock normally sits.
function fallbackTarget() {
  const s = 48;
  const x = window.innerWidth / 2 - s / 2;
  const y = window.innerHeight - s - 12;
  return { left: x, right: x + s, top: y, bottom: y + s };
}

export function targetRect(selector) {
  const el = selector ? document.querySelector(selector) : null;
  const r = el?.getBoundingClientRect();
  if (!r || r.width < 2 || r.height < 2) return fallbackTarget();
  if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return fallbackTarget();
  return rectOf(r);
}

// cloneNode copies markup and form values, not scroll positions. Record them once, as child
// index paths, so they can be applied to every copy without re-walking the live window.
function scrollPaths(root) {
  const out = [];
  const walk = (node, path) => {
    if (node.scrollTop || node.scrollLeft) out.push([path, node.scrollTop, node.scrollLeft]);
    for (let i = 0; i < node.children.length; i++) walk(node.children[i], [...path, i]);
  };
  walk(root, []);
  return out;
}

function applyScroll(copy, paths) {
  for (const [path, top, left] of paths) {
    let node = copy;
    for (const i of path) node = node?.children[i];
    if (!node) continue;
    node.scrollTop = top;
    node.scrollLeft = left;
  }
}

// The copies can't blur what's behind them, so they get a still of the glass instead: the
// window's own tint over a pre-blurred picture of the wallpaper behind it.
function paintGlass(copy, el, win, overlay) {
  const style = getComputedStyle(el);
  // Liquid Glass windows (<GlassSurface>): a lightly frosted wallpaper under the glass veil.
  if (el.classList.contains('glass-host')) {
    const still = backdropImage(win, { backdropFilter: 'blur(6px) saturate(140%)', dimColor: null });
    const veil = Number(el.dataset.glassVeil) || 0;
    const tone = veil < 0 ? `rgba(0, 0, 0, ${-veil})` : `rgba(255, 255, 255, ${veil})`;
    copy.style.setProperty('background-image', still ? `linear-gradient(${tone}, ${tone}), url("${still}")` : 'none', 'important');
    copy.style.setProperty('background-size', '100% 100%', 'important');
    copy.style.setProperty('background-color', still ? 'transparent' : 'rgba(18, 20, 32, 0.9)', 'important');
    return;
  }
  // Other windows: their backdrop-filter, which also sees the overlay's dimming.
  const tint = style.backgroundColor;
  const still = backdropImage(win, {
    backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
    dimColor: overlay ? getComputedStyle(overlay).backgroundColor : null,
  });
  if (still) {
    copy.style.setProperty('background-image', `linear-gradient(${tint}, ${tint}), url("${still}")`, 'important');
    copy.style.setProperty('background-size', '100% 100%', 'important');
    copy.style.setProperty('background-color', 'transparent', 'important');
  } else {
    copy.style.setProperty('background-color', 'rgba(18, 20, 32, 0.9)', 'important');
  }
}

/**
 * Creates a genie controller for `el`. Call `play(toward)` with 1 to minimise into the target
 * or 0 to restore; a call during a run reverses from the current position. Resolves with the
 * final progress, or with null if the run was superseded.
 */
export function createGenie(el, { getTarget, overlay = null }) {
  let layer = null;
  let strips = [];
  let win = null;
  let target = null;
  let progress = 0;
  let goal = 0;
  let frame = 0;
  let last = 0;
  let settle = null;
  let handoff = 0;
  let starting = null; // waiting for the wallpaper before the first frame
  let still = null; // the copies' glass still (background-image, size, colour)
  let settleLayer = null; // the still shown under the live window's glass just after a restore
  let destroyed = false;

  function build() {
    const r = el.getBoundingClientRect();
    win = rectOf(r);
    target = getTarget();
    const width = r.width;
    const height = r.height;
    const rows = Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.round(height / ROW_PX)));

    layer = document.createElement('div');
    layer.className = 'genie-layer';
    layer.setAttribute('aria-hidden', 'true');
    const template = el.cloneNode(true);
    template.classList.add('genie-copy');
    template.classList.remove('genie-hidden'); // the live window may already be hidden while we waited
    template.classList.remove('window-maximized'); // the copies are laid out from the measured box
    template.removeAttribute('id');
    template.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    // The measured rect is the border box; size the copy the same way so its layout matches the
    // live window exactly (some windows also size themselves with !important rules).
    template.style.setProperty('box-sizing', 'border-box', 'important');
    template.style.setProperty('width', `${width}px`, 'important');
    template.style.setProperty('height', `${height}px`, 'important');
    paintGlass(template, el, win, overlay);
    // The same still, for the live window's first moments after the hand-back (handBack).
    still = {
      image: template.style.getPropertyValue('background-image'),
      size: template.style.getPropertyValue('background-size'),
      color: template.style.getPropertyValue('background-color'),
    };

    strips = [];
    for (let i = 0; i < rows; i++) {
      const y0 = (height * i) / rows;
      const rowH = height / rows;
      // 1px of overlap hides anti-aliasing hairlines between neighbouring strips.
      const h = i === rows - 1 ? rowH : rowH + 1;
      const strip = document.createElement('div');
      strip.className = 'genie-strip';
      strip.style.width = `${width}px`;
      strip.style.height = `${h}px`;
      const copy = i === 0 ? template : template.cloneNode(true);
      copy.style.setProperty('top', `${-y0}px`, 'important');
      strip.append(copy);
      layer.append(strip);
      strips.push({ strip, copy, h, stretch: h / rowH });
    }
    document.body.append(layer);
    // Scroll offsets only apply once the copies are in the document.
    const paths = scrollPaths(el);
    if (paths.length) for (const { copy } of strips) applyScroll(copy, paths);
    el.classList.add('genie-hidden');
    if (overlay) overlay.classList.add('genie-overlay');
  }

  function render() {
    const rowsAt = genieRows(win, target, progress, strips.length);
    const width = win.right - win.left;
    for (let i = 0; i < strips.length; i++) {
      const { strip, h, stretch } = strips[i];
      const a = rowsAt[i];
      const b = rowsAt[i + 1];
      // The strip holds its row plus 1px of overlap; extend its quad by the same proportion.
      const by = a.y + (b.y - a.y) * stretch;
      const bl = a.left + (b.left - a.left) * stretch;
      const br = a.right + (b.right - a.right) * stretch;
      const m = b.y - a.y < 0.05 ? null : rectToQuadMatrix(
        width,
        h,
        { x: a.left, y: a.y },
        { x: a.right, y: a.y },
        { x: br, y: by },
        { x: bl, y: by },
      );
      if (m) {
        strip.style.transform = `matrix3d(${m.join(',')})`;
        strip.style.visibility = '';
      } else {
        strip.style.visibility = 'hidden';
      }
    }
    // Fade the last moments so the window dissolves into the icon instead of popping.
    layer.style.opacity = String(Math.min(1, (1 - progress) / 0.12));
    if (overlay) overlay.style.opacity = String(1 - progress);
  }

  function teardown() {
    cancelAnimationFrame(frame);
    frame = 0;
    clearTimeout(handoff);
    handoff = 0;
    layer?.remove();
    layer = null;
    strips = [];
    // Minimised windows stay hidden (and their overlay transparent) until the caller unmounts
    // them; revealing them here would flash them for a frame.
    if (progress < 1) {
      el.classList.remove('genie-hidden');
      if (overlay) {
        overlay.classList.remove('genie-overlay');
        overlay.style.opacity = '';
      }
    }
  }

  // Restored: show the live window underneath and cross-fade the strips away.
  // A window's backdrop blur isn't drawn while the strips cover it, and needs ~60–70 ms once
  // it's uncovered: handing back plainly showed the desktop sharp through the window for that
  // moment ("the glass goes off, then the blur comes back"). So the live window first gets
  // the strips' own glass still underneath its glass layer (it looks exactly like the strips),
  // the strips go in one step, and the still then fades away into the real blur, drawn by then.
  function handBack() {
    if (still) { // the still, or without a wallpaper the copies' plain colour
      settleLayer?.remove();
      const under = document.createElement('div');
      under.className = 'genie-settle';
      under.setAttribute('aria-hidden', 'true');
      if (still.image && still.image !== 'none') under.style.backgroundImage = still.image;
      under.style.backgroundSize = still.size;
      under.style.backgroundColor = still.color;
      el.prepend(under);
      settleLayer = under;
    }
    el.classList.remove('genie-hidden');
    if (overlay) {
      overlay.classList.remove('genie-overlay');
      overlay.style.opacity = '';
    }
    handoff = setTimeout(() => requestAnimationFrame(() => {
      if (!layer || goal !== 0) return; // torn down, or reversed meanwhile
      teardown();
      const under = settleLayer;
      if (!under) return;
      setTimeout(() => {
        under.style.opacity = '0';
        setTimeout(() => {
          under.remove();
          if (settleLayer === under) settleLayer = null;
        }, SETTLE_FADE_MS + 40);
      }, SETTLE_MS);
    }), 0);
  }

  function tick(now) {
    const dt = Math.min(64, now - last);
    last = now;
    const step = dt / (goal > progress ? CLOSE_MS : OPEN_MS);
    progress = goal > progress ? Math.min(goal, progress + step) : Math.max(goal, progress - step);
    render();
    if (progress === goal) {
      frame = 0;
      if (goal === 0) handBack();
      const done = settle;
      settle = null;
      done?.(goal);
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  return {
    get running() {
      return frame !== 0;
    },
    play(toward) {
      goal = toward;
      if (handoff) {
        // Reversed during the hand-back: take over from the live window again.
        clearTimeout(handoff);
        handoff = 0;
        layer.style.transition = '';
        el.classList.add('genie-hidden');
        if (overlay) overlay.classList.add('genie-overlay');
      }
      if (settleLayer) {
        settleLayer.remove();
        settleLayer = null;
      }
      settle?.(null); // a reversed run supersedes the previous promise
      const promise = new Promise((resolve) => {
        settle = resolve;
      });
      if (layer) {
        if (!frame) {
          last = performance.now();
          frame = requestAnimationFrame(tick);
        }
      } else if (!starting) {
        // Hide the live window now (no flash), then start once the glass backdrop is ready.
        const from = toward === 1 ? 0 : 1;
        el.classList.add('genie-hidden');
        if (overlay && from === 1) overlay.style.opacity = '0';
        starting = backdropReady().then(() => {
          starting = null;
          if (destroyed) return;
          progress = from;
          build();
          render();
          last = performance.now();
          frame = requestAnimationFrame(tick);
        });
      }
      return promise;
    },
    destroy() {
      destroyed = true;
      settle?.(null);
      settle = null;
      teardown();
    },
  };
}
