// A still of the frosted glass behind a window, for the genie strips. Blurring dozens of strips
// live would stutter, so we redraw what the glass shows once, on a small canvas: the wallpaper
// (cover-fit, as the body paints it), blurred and saturated like the window's backdrop, dimmed
// by the modal overlay. Downscaled 4×: a blurred image doesn't need full resolution.

const SCALE = 0.25;
const images = new Map(); // wallpaper URL -> HTMLImageElement (decoded, or loading)

function wallpaperUrl() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--page-bg-url');
  return value.match(/url\(\s*["']?(.*?)["']?\s*\)/)?.[1] || null;
}

/** Starts decoding the current wallpaper so the first genie run already has it. */
export function warmBackdrop() {
  const url = wallpaperUrl();
  if (!url || images.has(url)) return;
  const img = new Image();
  img.crossOrigin = 'anonymous'; // remote wallpapers must not taint the canvas
  img.decoding = 'async';
  img.src = url;
  img.onerror = () => images.delete(url);
  images.set(url, img);
}

/**
 * Resolves once the current wallpaper is decoded (it's usually already cached from the page
 * background), or after `timeout` ms so a slow image never holds up the animation.
 */
export function backdropReady(timeout = 150) {
  warmBackdrop();
  const img = images.get(wallpaperUrl());
  if (!img || (img.complete && img.naturalWidth)) return Promise.resolve();
  return Promise.race([
    img.decode().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, timeout)),
  ]);
}

// "blur(40px) saturate(200%)" -> the same filter with the blur scaled to the small canvas.
function canvasFilter(backdropFilter) {
  const css = backdropFilter && backdropFilter !== 'none' ? backdropFilter : 'blur(24px) saturate(180%)';
  let blur = 0;
  const filter = css.replace(/blur\(([\d.]+)px\)/, (_, px) => {
    blur = Number(px);
    return `blur(${Number(px) * SCALE}px)`;
  });
  return { filter, blur };
}

/**
 * Returns a JPEG data URL of the glass backdrop behind `win` (viewport rect), or null when the
 * wallpaper isn't available yet or can't be read (cross-origin without CORS).
 */
export function backdropImage(win, { backdropFilter, dimColor }) {
  const url = wallpaperUrl();
  const img = url && images.get(url);
  if (!img?.complete || !img.naturalWidth) {
    warmBackdrop();
    return null;
  }
  try {
    const { filter, blur } = canvasFilter(backdropFilter);
    const w = Math.max(1, Math.round((win.right - win.left) * SCALE));
    const h = Math.max(1, Math.round((win.bottom - win.top) * SCALE));
    // Draw a margin around the window so the blur doesn't pull in transparent edges.
    const m = Math.ceil(blur * SCALE * 2);
    const work = document.createElement('canvas');
    work.width = w + 2 * m;
    work.height = h + 2 * m;
    const ctx = work.getContext('2d');
    ctx.filter = filter;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cover = Math.max(vw / img.naturalWidth, vh / img.naturalHeight);
    const dw = img.naturalWidth * cover;
    const dh = img.naturalHeight * cover;
    ctx.drawImage(img, ((vw - dw) / 2 - win.left) * SCALE + m, ((vh - dh) / 2 - win.top) * SCALE + m, dw * SCALE, dh * SCALE);

    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');
    octx.drawImage(work, -m, -m);
    if (dimColor) {
      octx.fillStyle = dimColor;
      octx.fillRect(0, 0, w, h);
    }
    return out.toDataURL('image/jpeg', 0.9);
  } catch {
    return null; // tainted canvas: fall back to a flat tint
  }
}
