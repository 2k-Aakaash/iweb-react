// Paints the active wallpaper onto the page.
//
// The wallpaper lives on `document.body` (background-image) and on the
// `--page-bg-url` CSS variable, which the Liquid Glass surfaces (src/components/glass)
// refract and the genie animation's glass stills use. Swaps are crossfaded with a single fixed
// overlay that holds the OLD image on top of the body and fades out once the
// NEW image (already decoded off-screen) has been painted underneath.

import Vibrant from '../vibrant';
import { getWallpaperRecord, touchWallpaper } from './repository';
import { pickUnsplashUrl, decodeImage } from './imageLoader';

// With no wallpaper chosen (first launch) the page shows the body's solid dark colour
// (style.css) and white text; no remote image is loaded.
export const DEFAULT_TEXT_COLOR = '#ffffff';

const FADE_MS = 450;
const FADE_FALLBACK_MS = FADE_MS + 200;
const OVERLAY_ID = 'wallpaper-crossfade-layer';

// Monotonic token: every show/clear call takes a new one; a call whose token
// is no longer the latest must not touch the page.
let renderToken = 0;
// Every fade gets its own id so a superseded fade never resets the overlay
// that a newer fade is using.
let fadeId = 0;

let activeUrl = null;        // URL currently painted on body / --page-bg-url
let overlayUrl = null;       // URL currently shown by the crossfade overlay
const ownedUrls = new Set(); // blob: URLs created here (ours to revoke)
const retiredUrls = new Set(); // owned URLs waiting until they are off-screen

function cssUrl(url) {
  return `url("${String(url).replace(/["\\\n\r]/g, (c) => `\\${c}`)}")`;
}

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function createObjectUrl(blob) {
  const url = URL.createObjectURL(blob);
  ownedUrls.add(url);
  return url;
}

function revokeIfOwned(url) {
  if (url && ownedUrls.has(url) && url !== activeUrl && url !== overlayUrl) {
    URL.revokeObjectURL(url);
    ownedUrls.delete(url);
  }
}

// Revokes every retired object URL that is neither painted on the body nor on
// the overlay. Never touches the active URL.
function flushRetiredUrls() {
  for (const url of [...retiredUrls]) {
    if (url === activeUrl || url === overlayUrl) continue;
    retiredUrls.delete(url);
    revokeIfOwned(url);
  }
}

function retire(url) {
  if (url && ownedUrls.has(url)) retiredUrls.add(url);
}

function getOverlay() {
  let el = document.getElementById(OVERLAY_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'fixed',
      inset: '0',
      // Below every piece of content (all page content uses z-index >= -1),
      // above the body background that is painted on the canvas.
      zIndex: '-2147483647',
      pointerEvents: 'none',
      backgroundColor: 'transparent',
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      opacity: '0',
      transition: 'none',
      display: 'none',
    });
    // First child of body so it paints before anything else at negative z.
    document.body.prepend(el);
  }
  return el;
}

function resetOverlay(el) {
  el.style.transition = 'none';
  el.style.opacity = '0';
  el.style.backgroundImage = 'none';
  el.style.display = 'none';
  overlayUrl = null;
}

function paintBody(url) {
  if (url) {
    const value = cssUrl(url);
    document.body.style.backgroundImage = value;
    document.documentElement.style.setProperty('--page-bg-url', value);
  } else {
    document.body.style.backgroundImage = '';
    document.documentElement.style.removeProperty('--page-bg-url');
  }
  activeUrl = url || null;
}

// Paints `nextUrl` on the body and fades the previous image out on top of it.
// Resolves when the fade has finished (or immediately when there is no fade).
function swapTo(nextUrl, { allowFade = true } = {}) {
  const prevUrl = activeUrl;
  retire(prevUrl);

  const canFade = allowFade && Boolean(prevUrl) && prevUrl !== nextUrl && !prefersReducedMotion();
  if (!canFade) {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) {
      fadeId++;
      resetOverlay(existing);
    }
    paintBody(nextUrl);
    flushRetiredUrls();
    return Promise.resolve();
  }

  const myFade = ++fadeId;
  const overlay = getOverlay();

  // 1. Overlay shows the old (already decoded) image at full opacity.
  overlay.style.transition = 'none';
  overlay.style.backgroundImage = cssUrl(prevUrl);
  overlay.style.opacity = '1';
  overlay.style.display = 'block';
  overlayUrl = prevUrl;
  // Commit the opaque state before the body changes underneath it.
  void overlay.offsetWidth;

  // 2. Swap the body underneath the overlay.
  paintBody(nextUrl);

  // 3. Fade the overlay out.
  return new Promise((resolve) => {
    let finished = false;
    let timer = null;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      overlay.removeEventListener('transitionend', onEnd);
      if (myFade === fadeId) resetOverlay(overlay);
      flushRetiredUrls();
      resolve();
    };
    const onEnd = (e) => {
      if (e.target === overlay && e.propertyName === 'opacity') finish();
    };

    overlay.addEventListener('transitionend', onEnd);
    timer = setTimeout(finish, FADE_FALLBACK_MS);

    requestAnimationFrame(() => {
      if (myFade !== fadeId) {
        finish();
        return;
      }
      overlay.style.transition = `opacity ${FADE_MS}ms ease`;
      overlay.style.opacity = '0';
    });
  });
}

// Dominant colour of the displayed image (used for the clock colour).
// Runs after the swap and never blocks it.
function extractColor(url, token, onColor, fallbackHex) {
  if (typeof onColor !== 'function' || !url) return;

  const deliver = (hex) => {
    if (token === renderToken && hex) onColor(hex);
  };

  const img = new Image();
  if (!url.startsWith('blob:') && !url.startsWith('data:')) {
    img.crossOrigin = 'anonymous';
  }
  img.onload = () => {
    if (token !== renderToken) return;
    try {
      const vibrant = new Vibrant(img);
      const swatches = vibrant.swatches();
      const dominantColor = swatches['Vibrant'] || swatches['Muted'] || swatches['DarkVibrant'] || swatches['DarkMuted'] || swatches['LightVibrant'] || swatches['LightMuted'];
      deliver(dominantColor ? dominantColor.getHex() : fallbackHex);
    } catch (err) {
      console.error('Vibrant error:', err);
      deliver(fallbackHex);
    }
  };
  img.onerror = () => deliver(fallbackHex);
  img.src = url;
}

async function decodeBlob(blob) {
  const url = createObjectUrl(blob);
  try {
    await decodeImage(url);
    return url;
  } catch (err) {
    ownedUrls.delete(url);
    URL.revokeObjectURL(url);
    throw err;
  }
}

// Resolves a WallpaperRef to a decoded, ready-to-paint URL.
async function resolveSource(ref) {
  const record = await getWallpaperRecord(ref);
  if (!record) {
    throw new Error(`Wallpaper not found: ${ref.source}:${ref.id}`);
  }

  if (ref.source === 'unsplash') {
    if (navigator.onLine && record.urls) {
      try {
        const remote = pickUnsplashUrl(record.urls, { photoWidth: record.width });
        await decodeImage(remote);
        return { url: remote, record };
      } catch (err) {
        if (!record.blob) throw err;
      }
    }
    if (!record.blob) {
      throw new Error(`Unsplash wallpaper ${ref.id} is not available offline`);
    }
    return { url: await decodeBlob(record.blob), record };
  }

  if (!record.blob) {
    throw new Error(`Local wallpaper ${ref.id} has no image data`);
  }
  return { url: await decodeBlob(record.blob), record };
}

/**
 * Shows a wallpaper. Resolves true once the new image is on screen, false when
 * a newer call superseded this one. Rejects (keeping the current wallpaper)
 * when the record is missing or the image cannot be decoded.
 */
export async function showWallpaper(ref, { onColor } = {}) {
  if (!ref || (ref.source !== 'local' && ref.source !== 'unsplash') || ref.id == null) {
    throw new Error('showWallpaper: invalid wallpaper reference');
  }
  const token = ++renderToken;

  let resolved;
  try {
    resolved = await resolveSource(ref);
  } catch (err) {
    // A failure that no longer matters (a newer call took over) is not an error.
    if (token !== renderToken) return false;
    throw err;
  }
  const { url, record } = resolved;

  if (token !== renderToken) {
    revokeIfOwned(url);
    return false;
  }

  swapTo(url);

  if (ref.source === 'unsplash') {
    Promise.resolve()
      .then(() => touchWallpaper(ref))
      .catch((err) => console.warn('[wallpaper] Could not update lastUsedAt:', err));
  }

  extractColor(url, token, onColor, ref.source === 'unsplash' ? record.color : null);
  return true;
}

/** Shows the built-in default wallpaper (used when the library is empty). */
export async function showDefaultWallpaper({ onColor } = {}) {
  const token = ++renderToken;
  fadeId++;
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) resetOverlay(existing);
  retire(activeUrl);
  paintBody(null);
  flushRetiredUrls();
  if (token === renderToken) onColor?.(DEFAULT_TEXT_COLOR);
  return true;
}

/** Removes the wallpaper and releases every object URL held by the renderer. */
export function clearWallpaper() {
  renderToken++;
  fadeId++;
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) resetOverlay(existing);
  retire(activeUrl);
  paintBody(null);
  flushRetiredUrls();
}
