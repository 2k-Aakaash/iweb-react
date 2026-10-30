// The glass clock (iOS 26 Lock Screen): the digits are frosted glass over the wallpaper.
//
// The digits are filled (background-clip: text) with a blurred copy of the wallpaper, lined
// up with the wallpaper the body paints behind them and magnified a little around the clock,
// as a thick lens would; desktop.css adds a milky lift and the wallpaper colour on top, and
// an SVG filter (ClockGlassFilter in Clock.jsx) the lit, bevelled rim and a soft shadow.
//
// `background-attachment: fixed` would line the fill up by itself, but Chrome ignores it
// inside a transformed element and every desktop item is positioned with a transform, so the
// fill is placed here: measured from the digits' box and recomputed when the clock moves.
import { useEffect, useLayoutEffect, useState } from 'react';
import { loadWallpaper, wallpaperUrl } from '../../components/glass/staticGlass';

export const LENS_ZOOM = 1.08; // how much the glass magnifies what is behind it
const BLUR_WIDTH = 480; // the blurred copy is made this wide…
const BLUR_PX = 7; // …with this blur (≈ 20px at full screen width)

/** Where the body draws the wallpaper (`background-size: cover`, centred), in CSS px. */
export function coverRect(iw, ih, vw, vh) {
  const scale = Math.max(vw / iw, vh / ih);
  const w = iw * scale;
  const h = ih * scale;
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}

/**
 * Background size and position, in the box's own px, that put `cover` (the wallpaper on
 * screen) behind a box drawn at `rect` on screen, magnified by `zoom` around the box's centre.
 * `k`: the box's on-screen scale (edit mode draws items a little smaller).
 */
export function fillPlacement(cover, rect, k = 1, zoom = LENS_ZOOM) {
  const cx = rect.left + rect.w / 2;
  const cy = rect.top + rect.h / 2;
  // The wallpaper scaled by `zoom` about the box's centre, then into the box's own px.
  const x = cx + (cover.x - cx) * zoom;
  const y = cy + (cover.y - cy) * zoom;
  const round = (n) => Math.round(n * 100) / 100;
  return {
    size: [round((cover.w * zoom) / k), round((cover.h * zoom) / k)],
    position: [round((x - rect.left) / k), round((y - rect.top) / k)],
  };
}

// Blurred, downscaled copies of wallpapers: url -> Promise<{ url, w, h } | null>.
const blurred = new Map();
function blurredWallpaper(url) {
  if (!url) return Promise.resolve(null);
  if (!blurred.has(url)) {
    blurred.set(url, loadWallpaper(url).then((image) => {
      if (!image?.naturalWidth) return null;
      const w = image.naturalWidth;
      const h = image.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(BLUR_WIDTH, w);
      canvas.height = Math.max(1, Math.round((canvas.width / w) * h));
      const ctx = canvas.getContext('2d');
      // Drawn larger than the canvas so the blur doesn't fade in at the edges.
      const pad = BLUR_PX * 3;
      ctx.filter = `blur(${BLUR_PX}px)`;
      ctx.drawImage(image, -pad, -pad, canvas.width + pad * 2, canvas.height + pad * 2);
      return new Promise((resolve) => {
        try {
          canvas.toBlob((blob) => resolve(blob ? { url: URL.createObjectURL(blob), w, h } : null), 'image/jpeg', 0.9);
        } catch {
          resolve(null); // a wallpaper we may not read back (no CORS): plain frosted glass
        }
      });
    }));
  }
  return blurred.get(url);
}

// Follows the wallpaper the body paints (`--page-bg-url` on <html>).
function useWallpaper() {
  const [url, setUrl] = useState(() => (typeof window === 'undefined' ? null : wallpaperUrl()));
  useEffect(() => {
    const observer = new MutationObserver(() => setUrl(wallpaperUrl()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, []);
  return url;
}

/**
 * Fills the element in `ref` with the blurred wallpaper behind it while `enabled`, through
 * the CSS variables --glass-image, --glass-size and --glass-position.
 */
export function useGlassFill(ref, enabled) {
  const wallpaper = useWallpaper();
  const [fill, setFill] = useState(null); // { url, w, h } for `wallpaper`

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    blurredWallpaper(wallpaper).then((result) => {
      if (!cancelled) setFill(result);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, wallpaper]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const vars = ['--glass-image', '--glass-size', '--glass-position'];
    if (!enabled || !fill) {
      vars.forEach((name) => el.style.removeProperty(name));
      return undefined;
    }
    el.style.setProperty('--glass-image', `url("${fill.url}")`);
    let frame = 0;
    const place = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      if (!r.width || !el.offsetWidth) return;
      const cover = coverRect(fill.w, fill.h, window.innerWidth, window.innerHeight);
      const { size, position } = fillPlacement(cover, { left: r.left, top: r.top, w: r.width, h: r.height }, r.width / el.offsetWidth);
      el.style.setProperty('--glass-size', `${size[0]}px ${size[1]}px`);
      el.style.setProperty('--glass-position', `${position[0]}px ${position[1]}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    // The clock moves: dragged (its item's style), edit mode (a class and a scale transition),
    // resized, dropped (DesktopItem fires `resize` once it has settled), or the window resizes.
    const item = el.closest('[data-desktop-item]') || el.parentElement;
    const mutations = new MutationObserver(schedule);
    mutations.observe(item, { attributes: true, attributeFilter: ['style', 'class'] });
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    item.addEventListener('transitionend', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      item.removeEventListener('transitionend', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [ref, enabled, fill]);
}
