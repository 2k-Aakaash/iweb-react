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

  // Measure before paint, then follow size changes (Dock magnification, Island morphing)
  // and window resizes. Position-only moves come with a size change or a resize here.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = measure(el);
      setBox((prev) => (same(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    // Panels that scale in (Spotlight, Markets) change their box without a resize, so keep
    // measuring for the length of an entrance animation.
    const settleUntil = performance.now() + 700;
    const settle = () => {
      update();
      if (performance.now() < settleUntil) frame = requestAnimationFrame(settle);
    };
    frame = requestAnimationFrame(settle);
    const ro = new ResizeObserver(schedule);
    ro.observe(el.parentElement);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, []);

  const liquidLook = { ...GLASS_PRESETS[preset], ...(isStatic ? null : optics) };
  const staticLook = { ...STATIC_PRESETS[preset], ...(isStatic ? optics : null) };

  // Static: render the glass whenever the box, the wallpaper or the look changes.
  const staticKey = JSON.stringify(staticLook);
  useEffect(() => {
    if (!isStatic || !box || box.width < 1 || box.height < 1) return undefined;
    let cancelled = false;
    loadWallpaper(wallpaper).then((image) => {
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      paintStaticGlass(canvas, { image, rect: box, radius: radius ?? box.radius, opts: JSON.parse(staticKey) });
      setPainted(true);
    });
    return () => {
      cancelled = true;
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
