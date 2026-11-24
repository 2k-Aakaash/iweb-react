import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LIGHT_STATIC_PRESETS, STATIC_PRESETS } from './glassPresets';
import { useResolvedAppearance } from '../../libs/appearance/appearance';
import { loadedWallpaper, loadWallpaper, paintStaticGlass, staticGlassSupported, wallpaperUrl } from './staticGlass';
import { bootRevealed, markBootReady } from '../../libs/boot/bootReveal';
import '../../styles/glass-surface.css';

// Glass for every iWeb surface. <GlassSurface> goes inside a surface (the Dock, a window, a
// widget…) as its background layer; the surface's own content sits crisp on top. The host
// element gets `glass-host` (isolation, no CSS frost of its own). A host can colour its
// glass with `--glass-tint` (any CSS background) and `--glass-tint-opacity` — the widgets
// use this for their market mood.
//
// Static glass: staticGlass.js renders the glass into a canvas whenever its box changes, in
// the same frame (see "Following surfaces"). Nothing runs while nothing moves. Until the
// first render, a CSS frost stands in. Windows and Spotlight use the browser's backdrop blur
// with the same look instead (see BACKDROP_PRESETS), as does everything without WebGL.

function measure(el) {
  const host = el.parentElement;
  const r = host.getBoundingClientRect();
  return {
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    radius: parseFloat(getComputedStyle(host).borderTopLeftRadius) || 0,
    vw: window.innerWidth,
    vh: window.innerHeight,
  };
}

const same = (a, b) => a && b && a.left === b.left && a.top === b.top && a.width === b.width
  && a.height === b.height && a.radius === b.radius && a.vw === b.vw && a.vh === b.vh;

// ---- Following surfaces --------------------------------------------------------------
//
// Static glass is drawn for one box (where the surface is, its size and corners). When the
// box changes, the glass must be redrawn in that same frame: a stretched or misplaced canvas
// for even a few frames shows as the glass "refreshing" (the Dock magnifying, a window or a
// widget dragged). So:
//   size changes   one shared ResizeObserver; its callback runs after layout and before paint,
//                  so measuring there is free and the repaint lands in the same frame
//   movement       a window or widget being dragged, or anything transitioning or animating
//                  around a surface: every surface is measured each frame while it lasts
//                  (one layout read for all of them), then once more when it ends
//   everything     window resizes
// Repaints run outside React, within a time budget per frame; anything over it is drawn in
// the next frame.

const tracked = new Map(); // surface element -> onMeasured(box)
const pending = new Set();
let measureFrame = 0;
let followUntil = 0;
let observer = null;

function measureNow(els) {
  const list = [...els].filter((el) => el.isConnected && tracked.has(el));
  const boxes = list.map(measure); // all reads first: one layout
  list.forEach((el, i) => tracked.get(el)?.(boxes[i]));
}

const following = () => performance.now() < followUntil;

function flushMeasures() {
  measureFrame = 0;
  const els = [...pending];
  pending.clear();
  measureNow(els);
  if (following()) {
    for (const el of tracked.keys()) pending.add(el);
    measureFrame = requestAnimationFrame(flushMeasures);
  }
}

function requestMeasure(el) {
  pending.add(el);
  if (!measureFrame) measureFrame = requestAnimationFrame(flushMeasures);
}

/** Measures every surface each frame for the next `ms` (something is moving). */
function follow(ms) {
  followUntil = Math.max(followUntil, performance.now() + ms);
  for (const el of tracked.keys()) pending.add(el);
  if (!measureFrame) measureFrame = requestAnimationFrame(flushMeasures);
}

const around = (target, el) => target instanceof Node && (target.contains(el) || el.contains(target));

function listen() {
  if (observer) return;
  observer = new ResizeObserver((entries) => {
    const hosts = new Set(entries.map((e) => e.target));
    const els = [...tracked.keys()].filter((el) => hosts.has(el.parentElement));
    measureNow(els);
  });
  // A transition or animation on (or around) a surface: follow it, then settle.
  const start = (e) => {
    for (const el of tracked.keys()) {
      if (around(e.target, el)) {
        follow(1500);
        return;
      }
    }
  };
  const done = (e) => {
    for (const el of tracked.keys()) if (around(e.target, el)) requestMeasure(el);
  };
  document.addEventListener('transitionrun', start, true);
  document.addEventListener('animationstart', start, true);
  document.addEventListener('transitionend', done, true);
  document.addEventListener('animationend', done, true);
  // Dragging (a window by its title, a widget, the Dock's divider): follow while it moves.
  document.addEventListener('pointermove', (e) => {
    if (e.buttons) follow(250);
  }, { passive: true, capture: true });
  window.addEventListener('resize', () => follow(300));
}

function track(el, onMeasured) {
  listen();
  tracked.set(el, onMeasured);
  observer.observe(el.parentElement);
  requestMeasure(el);
  return () => {
    tracked.delete(el);
    pending.delete(el);
    observer.unobserve(el.parentElement);
  };
}

// Static repaints: drawn at once while this frame's budget lasts; beyond it, in the next
// frame (latest request per surface wins), so a panel full of surfaces (Control Center's
// tiles) never makes one long frame.
const PAINT_BUDGET_MS = 6;
let frameSpent = 0;
let frameReset = 0;
const queued = new Map(); // surface element -> paint()
let queueFrame = 0;

function paintSoon(el, paint) {
  if (!frameReset) {
    frameReset = requestAnimationFrame(() => {
      frameSpent = 0;
      frameReset = 0;
    });
  }
  if (frameSpent <= PAINT_BUDGET_MS) {
    const t = performance.now();
    paint();
    frameSpent += performance.now() - t;
    return;
  }
  queued.set(el, paint);
  if (!queueFrame) queueFrame = requestAnimationFrame(flushQueued);
}

function flushQueued() {
  queueFrame = 0;
  const start = performance.now();
  for (const [el, paint] of queued) {
    queued.delete(el);
    paint();
    if (performance.now() - start > PAINT_BUDGET_MS) break;
  }
  if (queued.size) queueFrame = requestAnimationFrame(flushQueued);
}

// A window opening paints its glass while its genie plays (hidden behind the strips), so the
// glass is there the moment the window is handed back. The window glass's blurred layers are
// prepared at idle (App.jsx → warmStaticGlass), so that paint is quick.

// Glass that shows what's really behind it (CSS backdrop-filter), from a static look.
const BACKDROP_PRESETS = new Set(['window', 'spotlight']);
// The dark veils a window sits in (a modal's dimming overlay) darken what its backdrop blur
// sees: this brightens the blur by the same amount, so the glass is as light as designed
// while still showing what's behind it. Light veils (the Light appearance) are left alone.
function veilBrightness(host) {
  let keep = 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  for (let el = host?.parentElement; el && el !== document.body; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.9 || r.height < vh * 0.9) continue;
    const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
    if (!m) continue;
    const [cr, cg, cb, ca = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    const lum = (0.299 * cr + 0.587 * cg + 0.114 * cb) / 255;
    if (lum < 0.3 && ca > 0 && ca < 0.95) keep *= 1 - ca;
  }
  return Math.min(2.2, 1 / keep);
}

function backdropStyle(look) {
  const [r, g, b, a] = look.tint;
  const lift = look.lift || 0;
  return {
    '--gb-blur': `${look.blur}px`, // the same radius the canvas glass blurs the wallpaper by
    '--gb-saturate': look.saturate,
    '--gb-tint': `rgba(${r}, ${g}, ${b}, ${a})`,
    '--gb-lift': lift >= 0 ? `rgba(255, 255, 255, ${lift})` : `rgba(0, 0, 0, ${-lift})`,
    '--gb-rim': look.specular ?? 0.7,
  };
}

// Start-up: the veil waits until every glass surface mounted before it lifts has rendered
// (its canvas painted, or its backdrop blur mounted), so the desktop appears with its glass.
const bootPending = new Set();
function bootDone(id) {
  if (!bootPending.delete(id) || bootPending.size) return;
  markBootReady('glass');
}

// Follows the wallpaper the body paints (`--page-bg-url` on <html>).
function useWallpaperUrl() {
  const [url, setUrl] = useState(() => (typeof window === 'undefined' ? null : wallpaperUrl()));
  useEffect(() => {
    const observer = new MutationObserver(() => setUrl(wallpaperUrl()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, []);
  return url;
}

// The veil the genie animation lays over its still of this glass (− darkens, + lightens).
function veilOf(still) {
  const [r, g, b, a] = still.tint;
  const light = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
  return (light ? a : -a) + still.lift;
}

// `appearance`: 'dark' keeps the dark glass in the Light appearance (Music's window).
export default function GlassSurface({ preset = 'panel', optics, radius, appearance }) {
  const ref = useRef(null);
  const canvasRef = useRef(null);
  const [box, setBox] = useState(null);
  const [painted, setPainted] = useState(false);
  // Windows (and Spotlight) float over other things: the clock, widgets, the Dock, other
  // windows. Static glass only knows the wallpaper, so they use the browser's own backdrop
  // blur instead, which shows what's really behind them, with the same tint and rim light.
  // Without WebGL every surface does.
  const backdrop = BACKDROP_PRESETS.has(preset) || !staticGlassSupported();
  const canvasGlass = !backdrop;
  // How much to brighten the backdrop blur (veilBrightness), measured once mounted.
  const [bright, setBright] = useState(1);
  const wallpaper = useWallpaperUrl();

  const bootId = useRef(null);
  useLayoutEffect(() => {
    if (bootRevealed()) return undefined;
    const id = {};
    bootId.current = id;
    bootPending.add(id);
    return () => bootDone(id); // unmounted before rendering: don't hold the veil
  }, []);

  const light = useResolvedAppearance() === 'light' && appearance !== 'dark';
  const staticLook = { ...((light && LIGHT_STATIC_PRESETS[preset]) || STATIC_PRESETS[preset]), ...optics };
  const staticKey = JSON.stringify(staticLook);

  // Static: draw for a box, now (within the frame's budget), unless it's the box and look
  // already drawn. Reads the latest settings through a ref, so measuring can call it directly.
  const lastBox = useRef(null);
  const drawn = useRef({ key: '', box: null });
  const paintedRef = useRef(false);
  const paintRef = useRef(null);
  useLayoutEffect(() => {
    paintRef.current = (box, force = false) => {
      const el = ref.current;
      const canvas = canvasRef.current;
      if (!canvasGlass || !el || !canvas || !box || box.width < 1 || box.height < 1) return;
      const image = loadedWallpaper(wallpaper);
      if (image === undefined) {
        // Still decoding: draw as soon as it's ready.
        loadWallpaper(wallpaper).then(() => paintRef.current?.(lastBox.current, true));
        return;
      }
      const corner = radius ?? box.radius;
      const key = `${staticKey}|${corner}|${wallpaper}`;
      if (!force && drawn.current.key === key && same(drawn.current.box, box)) return;
      paintSoon(el, () => {
        if (!canvasRef.current) return;
        const latest = lastBox.current || box;
        paintStaticGlass(canvasRef.current, { image, rect: latest, radius: radius ?? latest.radius, opts: JSON.parse(staticKey) });
        drawn.current = { key, box: latest };
        if (!paintedRef.current) {
          paintedRef.current = true;
          setPainted(true);
          if (bootId.current) bootDone(bootId.current);
        }
      });
    };
  });

  // Measured when it mounts, then on every change of size or place (see "Following surfaces").
  // The glass repaints straight from the measurement; React only hears about it when the
  // surface first gets (or loses) a size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    return track(el, (next) => {
      lastBox.current = next;
      paintRef.current?.(next);
      setBox((prev) => {
        if (same(prev, next)) return prev;
        if (prev && (prev.width > 0) === (next.width > 0) && (prev.height > 0) === (next.height > 0)) return prev;
        return next;
      });
    });
  }, []);
  // A new look, wallpaper or corner: draw again.
  useEffect(() => {
    paintRef.current?.(lastBox.current, true);
  }, [canvasGlass, wallpaper, radius, staticKey]);

  useLayoutEffect(() => {
    if (!backdrop) return;
    const next = veilBrightness(ref.current?.parentElement);
    setBright((prev) => (Math.abs(prev - next) < 0.01 ? prev : next));
  }, [backdrop, light]);

  // The genie animation paints a still of this glass and needs its veil.
  const veil = veilOf(staticLook);
  useLayoutEffect(() => {
    ref.current?.parentElement?.setAttribute('data-glass-veil', String(veil));
  }, [veil]);

  const ready = box && box.width > 0 && box.height > 0;
  // Backdrop glass needs no paint: ready once measured.
  // A surface measured at zero size (hidden at start) has nothing to show yet: don't wait for it.
  useEffect(() => {
    if (!bootId.current || !box) return;
    if (!ready || !canvasGlass) bootDone(bootId.current);
  }, [canvasGlass, ready, box]);
  return (
    <div ref={ref} className={`glass-surface${canvasGlass && !painted ? ' is-pending' : ''}`} aria-hidden="true">
      {canvasGlass && <canvas ref={canvasRef} className="glass-surface-canvas" />}
      {backdrop && <div className="glass-surface-backdrop" style={{ ...backdropStyle(staticLook), '--gb-bright': bright }} />}
      <div className="glass-surface-tint" />
    </div>
  );
}
