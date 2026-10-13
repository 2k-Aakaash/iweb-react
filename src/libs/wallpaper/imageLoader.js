// Image helpers shared by the wallpaper modules: Unsplash URL sizing, size-limited
// image downloads, decode checks, thumbnails and content hashing.

export const ACCEPTED_LOCAL_TYPES = ['image/jpeg', 'image/png', 'image/gif'];

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

const WIDTH_STEP = 320;
const MAX_WIDTH = 3840;
const DEFAULT_VIEWPORT = { width: 1920, height: 1080, dpr: 1 };
const MAX_DPR = 4;
const THUMB_QUALITY = 0.8;

/** code: 'HTTP' | 'NOT_IMAGE' | 'TOO_LARGE' | 'EMPTY' | 'NETWORK' | 'INVALID_URL' */
export class ImageLoadError extends Error {
  constructor(code, message, { status = null, cause } = {}) {
    super(message || code, cause ? { cause } : undefined);
    this.name = 'ImageLoadError';
    this.code = code;
    this.status = status;
  }
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function viewportDefaults() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  return {
    width: positiveNumber(g.innerWidth) ?? DEFAULT_VIEWPORT.width,
    height: positiveNumber(g.innerHeight) ?? DEFAULT_VIEWPORT.height,
    dpr: positiveNumber(g.devicePixelRatio) ?? DEFAULT_VIEWPORT.dpr,
  };
}

function httpsUnsplashUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    const hostOk = url.hostname === 'unsplash.com' || url.hostname.endsWith('.unsplash.com');
    return url.protocol === 'https:' && hostOk ? url : null;
  } catch {
    return null;
  }
}

/**
 * Builds a hotlinkable, size-appropriate Unsplash image URL from `urls.raw`
 * (keeps the `ixid` parameter, as the API requires). Width = viewport long edge × dpr,
 * rounded up to a 320px step, capped at 3840 and never above the photo's own width.
 */
export function pickUnsplashUrl(urls, { width, height, dpr, photoWidth } = {}) {
  const defaults = viewportDefaults();
  const w = positiveNumber(width) ?? defaults.width;
  const h = positiveNumber(height) ?? defaults.height;
  const ratio = Math.min(MAX_DPR, positiveNumber(dpr) ?? defaults.dpr);

  const raw = httpsUnsplashUrl(urls?.raw);
  if (!raw) {
    for (const key of ['full', 'regular', 'small']) {
      const fallback = httpsUnsplashUrl(urls?.[key]);
      if (fallback) return fallback.href;
    }
    return '';
  }

  const longEdge = Math.max(w, h) * ratio;
  let target = Math.min(MAX_WIDTH, Math.max(WIDTH_STEP, Math.ceil(longEdge / WIDTH_STEP) * WIDTH_STEP));
  const ownWidth = positiveNumber(photoWidth);
  if (ownWidth) target = Math.min(target, Math.floor(ownWidth));

  raw.searchParams.set('w', String(target));
  raw.searchParams.set('q', '80');
  raw.searchParams.set('fm', 'jpg');
  raw.searchParams.set('fit', 'max');
  return raw.href;
}

function parseContentType(value) {
  return typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '';
}

async function readBodyLimited(res, maxBytes, signal) {
  const reader = res.body?.getReader?.();
  if (!reader) return res.blob();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new ImageLoadError('TOO_LARGE', 'The image is too large.');
      }
      chunks.push(value);
    }
  } catch (err) {
    reader.cancel().catch(() => {});
    throw err;
  }
  return new Blob(chunks);
}

/**
 * Downloads an image and returns it as a Blob. Rejects non-OK statuses, non-image
 * (and SVG) content types, and bodies larger than `maxBytes` (header and actual size).
 * Abort errors from `signal` are rethrown unchanged.
 */
export async function fetchImageBlob(url, { signal, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ImageLoadError('INVALID_URL', 'Invalid image URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'blob:' && parsed.protocol !== 'data:') {
    throw new ImageLoadError('INVALID_URL', 'Only https image URLs are allowed.');
  }

  let res;
  try {
    res = await fetch(parsed.href, { signal, credentials: 'omit' });
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') throw err;
    throw new ImageLoadError('NETWORK', 'Could not download the image.', { cause: err });
  }

  if (!res.ok) {
    throw new ImageLoadError('HTTP', `Image download failed (HTTP ${res.status}).`, { status: res.status });
  }
  const type = parseContentType(res.headers.get('Content-Type'));
  if (!type.startsWith('image/') || type === 'image/svg+xml') {
    throw new ImageLoadError('NOT_IMAGE', 'The download is not a supported image.');
  }
  const declared = Number(res.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ImageLoadError('TOO_LARGE', 'The image is too large.');
  }

  const body = await readBodyLimited(res, maxBytes, signal);
  if (body.size > maxBytes) throw new ImageLoadError('TOO_LARGE', 'The image is too large.');
  if (body.size === 0) throw new ImageLoadError('EMPTY', 'The image is empty.');
  return body.type === type ? body : new Blob([body], { type });
}

/** Loads and fully decodes an image; rejects when the source cannot be decoded. */
export async function decodeImage(src) {
  if (typeof Image === 'undefined') throw new Error('Image decoding is not available here.');
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return img;
}

function canvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined' && document.createElement) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

/**
 * Creates a small preview (WebP, JPEG fallback) whose long edge is at most `maxEdge`.
 * Returns null where createImageBitmap/canvas are unavailable or decoding fails.
 */
export async function makeThumbnail(blob, maxEdge = 320) {
  if (typeof createImageBitmap !== 'function' || !blob) return null;
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = createCanvas(width, height);
    const ctx = canvas?.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);

    let thumb = await canvasToBlob(canvas, 'image/webp', THUMB_QUALITY);
    if (!thumb || thumb.type !== 'image/webp') {
      thumb = await canvasToBlob(canvas, 'image/jpeg', THUMB_QUALITY);
    }
    return thumb || null;
  } catch {
    return null;
  } finally {
    bitmap.close?.();
  }
}

/** Hex-encoded SHA-256 of the blob's bytes. */
export async function sha256Hex(blob) {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
