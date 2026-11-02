import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Glass } from '@samasante/liquid-glass';
import { GLASS_PRESETS, STATIC_PRESETS } from './glassPresets';
import { useGlassMode } from './glassMode';
import { loadWallpaper, paintStaticGlass, staticGlassSupported, wallpaperUrl } from './staticGlass';
import '../../styles/glass-surface.css';

// Glass for every iWeb surface. <GlassSurface> goes inside a surface (the Dock, a window, a
// widget…) as its background layer; the surface's own content sits crisp on top. The host
// element gets `glass-host` (isolation, no CSS frost of its own). A host can colour its
// glass with `--glass-tint` (any CSS background) and `--glass-tint-opacity` — the widgets
// use this for their market mood.
//
// Two renderers, chosen in Settings → Appearance (see glassMode.js):
//   static — staticGlass.js renders the glass once per size/wallpaper change into a canvas.
//            No per-frame cost. Until the first render, a CSS frost stands in.
//
// Measuring (getBoundingClientRect) forces a layout, so surfaces are measured together in one
// pass per frame, and only when something can have moved them (see track / requestMeasure).
//   liquid — @samasante/liquid-glass refracting a copy of the wallpaper aligned to the page
//            (the library's "panel over a photo" pattern): live, but the GPU re-runs it on
//            every frame while anything on the page animates.

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

// Measuring forces a layout, so every surface that needs measuring is read in one pass per
// frame: all the reads first, then all the state updates (one layout per frame, not one per
// surface).
const pending = new Map(); // surface element -> onMeasured(box)
let measureFrame = 0;

function flushMeasures() {
  measureFrame = 0;
  const batch = [...pending];
  pending.clear();
  const boxes = batch.map(([el]) => (el.isConnected ? measure(el) : null));
  batch.forEach(([, onMeasured], i) => boxes[i] && onMeasured(boxes[i]));
}

function requestMeasure(el, onMeasured) {
  pending.set(el, onMeasured);
  if (!measureFrame) measureFrame = requestAnimationFrame(flushMeasures);
}

// A panel that scales in or a window that opens only settles when its animation or transition
// ends: surfaces inside it measure again then (instead of measuring every frame meanwhile).
const tracked = new Map(); // surface element -> onMeasured(box)
let listening = false;

function onAnimationDone(e) {
  if (!(e.target instanceof Node)) return;
  for (const [el, onMeasured] of tracked) {
    if (e.target.contains(el)) requestMeasure(el, onMeasured);
  }
}

function track(el, onMeasured) {
  tracked.set(el, onMeasured);
  if (!listening) {
    listening = true;
    document.addEventListener('animationend', onAnimationDone, true);
    document.addEventListener('transitionend', onAnimationDone, true);
  }
  return () => {
    tracked.delete(el);
    pending.delete(el);
  };
}

// While a surface keeps changing size (the Dock magnifying), static glass repaints at most this
// often, and once more when it settles; the canvas stretches in between.
const REPAINT_INTERVAL_MS = 100;
const repaintWait = (lastPaintAt) => REPAINT_INTERVAL_MS - (performance.now() - lastPaintAt);

// Static paints run in a queue with a time budget per frame, so a panel full of surfaces
// (Control Center's tiles) doesn't paint them all in one long frame. Each surface keeps its
// CSS frost until its glass is ready.
const PAINT_BUDGET_MS = 8;
const paintQueue = new Set();
let paintFrame = 0;

function flushPaints() {
  paintFrame = 0;
  const start = performance.now();
  for (const job of paintQueue) {
    paintQueue.delete(job);
    job();
    if (performance.now() - start > PAINT_BUDGET_MS) break;
  }
  if (paintQueue.size) paintFrame = requestAnimationFrame(flushPaints);
}

function queuePaint(job) {
  paintQueue.add(job);
  if (!paintFrame) paintFrame = requestAnimationFrame(flushPaints);
  return () => paintQueue.delete(job);
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
function veilOf(mode, liquid, still) {
  if (mode === 'liquid') return liquid.brightness ?? 0;
  const [r, g, b, a] = still.tint;
  const light = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
  return (light ? a : -a) + still.lift;
}

export default function GlassSurface({ preset = 'panel', optics, radius }) {
  const ref = useRef(null);
  const canvasRef = useRef(null);
  const [box, setBox] = useState(null);
  const [painted, setPainted] = useState(false);
  const mode = useGlassMode();
  const isStatic = mode === 'static' && staticGlassSupported();
  const wallpaper = useWallpaperUrl();

  // Measured in the next shared read pass, then again on size changes (Dock magnification,
  // Island morphing), window resizes (DesktopItem fires one after a drop), and when an
  // animation or transition around it ends (a panel scaling in, a window opening).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onMeasured = (next) => setBox((prev) => (same(prev, next) ? prev : next));
    const schedule = () => requestMeasure(el, onMeasured);
    schedule();
    const untrack = track(el, onMeasured);
    const ro = new ResizeObserver(schedule);
    ro.observe(el.parentElement);
    window.addEventListener('resize', schedule);
    return () => {
      untrack();
      ro.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, []);

  const liquidLook = { ...GLASS_PRESETS[preset], ...(isStatic ? null : optics) };
  const staticLook = { ...STATIC_PRESETS[preset], ...(isStatic ? optics : null) };

  // Static: render the glass whenever the box, the wallpaper or the look changes; at most every
  // REPAINT_INTERVAL_MS while the box keeps changing, and once more when it settles.
  const staticKey = JSON.stringify(staticLook);
  const lastPaint = useRef(-Infinity);
  useEffect(() => {
    if (!isStatic || !box || box.width < 1 || box.height < 1) return undefined;
    let cancelled = false;
    let unqueue = () => {};
    const paint = () => {
      lastPaint.current = performance.now();
      loadWallpaper(wallpaper).then((image) => {
        if (cancelled) return;
        unqueue = queuePaint(() => {
          const canvas = canvasRef.current;
          if (cancelled || !canvas) return;
          paintStaticGlass(canvas, { image, rect: box, radius: radius ?? box.radius, opts: JSON.parse(staticKey) });
          setPainted(true);
        });
      });
    };
    const wait = repaintWait(lastPaint.current);
    const timer = wait > 0 ? setTimeout(paint, wait) : (paint(), 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unqueue();
    };
  }, [isStatic, box, wallpaper, radius, staticKey]);

  // The genie animation paints a still of this glass and needs its veil.
  const veil = veilOf(isStatic ? 'static' : 'liquid', liquidLook, staticLook);
  useLayoutEffect(() => {
    ref.current?.parentElement?.setAttribute('data-glass-veil', String(veil));
  }, [veil]);

  const r = radius ?? box?.radius ?? 0;
  const ready = box && box.width > 0 && box.height > 0;
  return (
    <div ref={ref} className={`glass-surface${isStatic && !painted ? ' is-pending' : ''}`} aria-hidden="true">
      {isStatic && <canvas ref={canvasRef} className="glass-surface-canvas" />}
      {!isStatic && ready && (
        <Glass
          optics={liquidLook}
          brightnessInFilter
          width={box.width}
          height={box.height}
          radius={r}
          refract={
            <div
              className="glass-surface-wallpaper"
              style={{ left: -box.left, top: -box.top, width: box.vw, height: box.vh }}
            />
          }
          style={{ position: 'absolute', inset: 0, width: box.width, height: box.height, borderRadius: r }}
        />
      )}
      <div className="glass-surface-tint" />
    </div>
  );
}
