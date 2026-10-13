// Unsplash API client (public Client-ID auth). Every API call goes through request(),
// which owns the auth headers, abort handling, error normalization, bounded retries
// and rate-limit bookkeeping. Responses are validated and normalized defensively;
// nothing returned here is ever rendered as HTML.
//
// API reference: https://unsplash.com/documentation
// Guidelines:    https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines

export const API_BASE = 'https://api.unsplash.com';
const API_HOST = 'api.unsplash.com';

const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 8000;
const MAX_RETRY_AFTER_MS = 30000;

const MAX_QUERY_LENGTH = 100;
const MAX_URL_LENGTH = 2048;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_NAME_LENGTH = 100;
const MAX_TAG_LENGTH = 40;
const MAX_TAGS = 20;
const MAX_RANDOM_COUNT = 30;
const MAX_PER_PAGE = 30;
const MAX_PAGE = 1000;

const PHOTO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const USERNAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F]/g;

export const UNSPLASH_ERROR_CODES = Object.freeze([
  'NOT_CONFIGURED',
  'UNAUTHORIZED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'NETWORK',
  'OFFLINE',
  'BAD_RESPONSE',
  'SERVER',
  'ABORTED',
  'INVALID_QUERY',
]);

/**
 * code:       one of UNSPLASH_ERROR_CODES
 * status:     HTTP status, or null when no response was received
 * retryAfter: seconds from the Retry-After header, or null when absent
 */
export class UnsplashError extends Error {
  constructor(code, message, { status = null, retryAfter = null, cause } = {}) {
    super(message || code, cause ? { cause } : undefined);
    this.name = 'UnsplashError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// ---------------------------------------------------------------------------
// Configuration

function readEnv(name) {
  const value = import.meta.env?.[name];
  return typeof value === 'string' ? value.trim() : '';
}

// Requests go through a server-side proxy that adds the Access Key (api/unsplash.js on
// Vercel, a Vite middleware in `npm run dev`), so the key is never shipped to the browser.
// VITE_UNSPLASH_PROXY_URL overrides the default same-origin path; the extension build
// needs an absolute URL (e.g. https://your-app.vercel.app/api/unsplash).
const DEFAULT_PROXY_PATH = '/api/unsplash';

function getProxyUrl() {
  const configured = readEnv('VITE_UNSPLASH_PROXY_URL') || DEFAULT_PROXY_PATH;
  if (/^https?:\/\//i.test(configured)) return new URL(configured);
  const origin = typeof location !== 'undefined' && /^https?:$/.test(location.protocol)
    ? location.origin
    : null;
  // A relative proxy path needs an http(s) page origin (not chrome-extension://).
  return origin ? new URL(configured, origin) : null;
}

export function isUnsplashConfigured() {
  return getProxyUrl() !== null;
}

function getAppName() {
  const name = (readEnv('UNSPLASH_APP_NAME') || readEnv('VITE_UNSPLASH_APP_NAME'))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return name || 'iweb';
}

// ---------------------------------------------------------------------------
// Small helpers

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function isAbortError(err, signal) {
  return Boolean(signal?.aborted) || err?.name === 'AbortError';
}

function abortedError(cause) {
  return new UnsplashError('ABORTED', 'The Unsplash request was cancelled.', { cause });
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function backoffDelay(attempt) {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  // "Equal jitter": half fixed, half random, so retries from several tabs spread out.
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

function parseRetryAfter(value) {
  if (value == null || value === '') return null;
  const trimmed = String(value).trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function parseIntHeader(headers, name) {
  const raw = headers?.get?.(name);
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_CHARS_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength).trim();
}

function isUnsplashHost(hostname) {
  return hostname === 'unsplash.com' || hostname.endsWith('.unsplash.com');
}

/** Returns a normalized https URL on an unsplash.com host, or null. */
function safeUnsplashUrl(value, { host } = {}) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (host ? url.hostname !== host : !isUnsplashHost(url.hostname)) return null;
  return url.href;
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

// ---------------------------------------------------------------------------
// Public helpers

/**
 * Validates a search query: control characters removed, whitespace collapsed,
 * trimmed, capped at 100 characters. Throws INVALID_QUERY when nothing is left.
 */
export function normalizeQuery(query) {
  const cleaned = typeof query === 'string' ? cleanText(query, MAX_QUERY_LENGTH) : '';
  if (!cleaned) throw new UnsplashError('INVALID_QUERY', 'Enter a search term.');
  return cleaned;
}

/** Adds the referral parameters the API guidelines require on links back to Unsplash. */
export function withUtm(url) {
  if (typeof url !== 'string' || !url.trim()) return '';
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return '';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
  parsed.searchParams.set('utm_source', getAppName());
  parsed.searchParams.set('utm_medium', 'referral');
  return parsed.href;
}

let rateInfo = null;

function recordRateInfo(headers) {
  const limit = parseIntHeader(headers, 'X-Ratelimit-Limit');
  const remaining = parseIntHeader(headers, 'X-Ratelimit-Remaining');
  if (limit == null && remaining == null) return;
  rateInfo = {
    limit: limit ?? rateInfo?.limit ?? null,
    remaining: remaining ?? null,
    updatedAt: Date.now(),
  };
}

/** Last API rate-limit status seen in the X-Ratelimit-* response headers (hourly window). */
export function getApiRateInfo() {
  return rateInfo ? { ...rateInfo } : null;
}

// Test helper: forget the recorded rate-limit info.
export function _resetApiRateInfo() {
  rateInfo = null;
}

// ---------------------------------------------------------------------------
// Central request

async function readErrorText(res) {
  try {
    const text = await res.text();
    return typeof text === 'string' ? text.slice(0, 500) : '';
  } catch {
    return '';
  }
}

async function errorFromResponse(res) {
  const status = res.status;
  const retryAfter = parseRetryAfter(res.headers?.get?.('Retry-After'));
  const body = await readErrorText(res);
  const remaining = parseIntHeader(res.headers, 'X-Ratelimit-Remaining');
  const rateLimited = status === 429
    || (status === 403 && (/rate limit exceeded/i.test(body) || remaining === 0));

  if (status === 500 && /not configured/i.test(body)) {
    return new UnsplashError('NOT_CONFIGURED', 'The Unsplash proxy has no access key configured.', { status });
  }
  if (rateLimited) {
    return new UnsplashError('RATE_LIMITED', 'Unsplash API rate limit reached. Try again later.', { status, retryAfter });
  }
  if (status === 401 || status === 403) {
    return new UnsplashError('UNAUTHORIZED', 'The Unsplash access key was rejected.', { status });
  }
  if (status === 404) {
    return new UnsplashError('NOT_FOUND', 'The requested Unsplash resource was not found.', { status });
  }
  if (status >= 500) {
    return new UnsplashError('SERVER', `Unsplash is having problems (HTTP ${status}).`, { status, retryAfter });
  }
  return new UnsplashError('BAD_RESPONSE', `Unexpected Unsplash response (HTTP ${status}).`, { status });
}

function buildUrl(pathOrUrl, params) {
  let url;
  if (/^https?:\/\//i.test(pathOrUrl)) {
    const safe = safeUnsplashUrl(pathOrUrl, { host: API_HOST });
    if (!safe) throw new UnsplashError('BAD_RESPONSE', 'Refusing to call a non-Unsplash API URL.');
    url = new URL(safe);
  } else {
    url = new URL(pathOrUrl, API_BASE);
  }
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  // Re-target the Unsplash URL at the proxy: ?path=<endpoint>&<original params>.
  const proxy = getProxyUrl();
  if (!proxy) throw new UnsplashError('NOT_CONFIGURED', 'Unsplash proxy URL is not configured.');
  proxy.searchParams.set('path', url.pathname);
  for (const [key, value] of url.searchParams) proxy.searchParams.append(key, value);
  return proxy.href;
}

/**
 * GET an Unsplash API endpoint and return the parsed JSON body.
 * Retries (max 2, exponential backoff with jitter, honouring Retry-After) only for
 * NETWORK and SERVER errors; auth, rate-limit and client errors fail immediately.
 */
async function request(pathOrUrl, { params, signal } = {}) {
  if (signal?.aborted) throw abortedError();
  if (isOffline()) throw new UnsplashError('OFFLINE', 'You are offline.');

  const url = buildUrl(pathOrUrl, params);
  const init = {
    method: 'GET',
    credentials: 'omit',
    signal,
  };

  for (let attempt = 0; ; attempt += 1) {
    let error;
    let res = null;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (isAbortError(err, signal)) throw abortedError(err);
      error = isOffline()
        ? new UnsplashError('OFFLINE', 'You are offline.', { cause: err })
        : new UnsplashError('NETWORK', 'Could not reach Unsplash.', { cause: err });
    }

    if (res) {
      recordRateInfo(res.headers);
      if (res.ok) {
        try {
          return await res.json();
        } catch (err) {
          if (isAbortError(err, signal)) throw abortedError(err);
          throw new UnsplashError('BAD_RESPONSE', 'Unsplash returned malformed JSON.', { status: res.status, cause: err });
        }
      }
      error = await errorFromResponse(res);
    }

    const retryable = error.code === 'NETWORK' || error.code === 'SERVER';
    if (!retryable || attempt >= MAX_RETRIES) throw error;

    const retryAfterMs = error.retryAfter != null ? error.retryAfter * 1000 : null;
    if (retryAfterMs != null && retryAfterMs > MAX_RETRY_AFTER_MS) throw error;
    await sleep(retryAfterMs ?? backoffDelay(attempt), signal);
    if (isOffline()) throw new UnsplashError('OFFLINE', 'You are offline.');
  }
}

// ---------------------------------------------------------------------------
// Normalization

/** Returns a NormalizedPhoto, or null when the payload is unusable. */
export function normalizePhoto(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const photoId = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!PHOTO_ID_RE.test(photoId)) return null;

  const rawUrls = raw.urls && typeof raw.urls === 'object' ? raw.urls : {};
  const urls = {
    raw: safeUnsplashUrl(rawUrls.raw),
    full: safeUnsplashUrl(rawUrls.full),
    regular: safeUnsplashUrl(rawUrls.regular),
    small: safeUnsplashUrl(rawUrls.small),
    thumb: safeUnsplashUrl(rawUrls.thumb),
  };
  if (!urls.raw) return null;

  const links = raw.links && typeof raw.links === 'object' ? raw.links : {};
  const user = raw.user && typeof raw.user === 'object' ? raw.user : {};
  const userLinks = user.links && typeof user.links === 'object' ? user.links : {};

  const username = typeof user.username === 'string' && USERNAME_RE.test(user.username.trim())
    ? user.username.trim()
    : null;
  const name = cleanText(user.name, MAX_NAME_LENGTH) || username || 'Unknown photographer';
  const profileUrl = withUtm(
    safeUnsplashUrl(userLinks.html)
    || (username ? `https://unsplash.com/@${encodeURIComponent(username)}` : 'https://unsplash.com/'),
  );
  const photoPageUrl = withUtm(
    safeUnsplashUrl(links.html) || `https://unsplash.com/photos/${encodeURIComponent(photoId)}`,
  );
  // The documented tracking endpoint is GET /photos/:id/download; prefer the URL the API returned.
  const downloadLocation = safeUnsplashUrl(links.download_location, { host: API_HOST })
    || `${API_BASE}/photos/${encodeURIComponent(photoId)}/download`;

  const description = cleanText(raw.description, MAX_DESCRIPTION_LENGTH)
    || cleanText(raw.alt_description, MAX_DESCRIPTION_LENGTH)
    || null;

  const tags = [];
  if (Array.isArray(raw.tags)) {
    const seen = new Set();
    for (const tag of raw.tags) {
      const title = cleanText(typeof tag === 'string' ? tag : tag?.title, MAX_TAG_LENGTH);
      const keyName = title.toLowerCase();
      if (!title || seen.has(keyName)) continue;
      seen.add(keyName);
      tags.push(title);
      if (tags.length >= MAX_TAGS) break;
    }
  }

  return {
    photoId,
    width: positiveInt(raw.width),
    height: positiveInt(raw.height),
    color: typeof raw.color === 'string' && COLOR_RE.test(raw.color.trim()) ? raw.color.trim() : null,
    description,
    urls,
    photographer: { name, username, profileUrl },
    photoPageUrl,
    downloadLocation,
    tags,
  };
}

function normalizePhotoList(list) {
  const seen = new Set();
  const photos = [];
  for (const item of list) {
    const photo = normalizePhoto(item);
    if (!photo || seen.has(photo.photoId)) continue;
    seen.add(photo.photoId);
    photos.push(photo);
  }
  return photos;
}

// ---------------------------------------------------------------------------
// Endpoints

/**
 * GET /photos/random — one API request regardless of `count` (max 30).
 * `query` is optional; when given it must be a valid search term.
 */
export async function getRandomPhotos({ query, count = 10, signal } = {}) {
  const q = query === undefined || query === null ? undefined : normalizeQuery(query);
  const data = await request('/photos/random', {
    params: {
      query: q,
      orientation: 'landscape',
      content_filter: 'high',
      // Always send count so the response is an array (documented behaviour).
      count: clampInt(count, 1, MAX_RANDOM_COUNT, 10),
    },
    signal,
  });
  if (!Array.isArray(data)) throw new UnsplashError('BAD_RESPONSE', 'Unexpected Unsplash response shape.');
  return normalizePhotoList(data);
}

/** GET /search/photos → { results, total, totalPages } (per_page max 30). */
export async function searchPhotos({ query, page = 1, perPage = 24, signal } = {}) {
  const q = normalizeQuery(query);
  const data = await request('/search/photos', {
    params: {
      query: q,
      page: clampInt(page, 1, MAX_PAGE, 1),
      per_page: clampInt(perPage, 1, MAX_PER_PAGE, 24),
      orientation: 'landscape',
      content_filter: 'high',
    },
    signal,
  });
  if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
    throw new UnsplashError('BAD_RESPONSE', 'Unexpected Unsplash response shape.');
  }
  const total = Number.isInteger(data.total) && data.total >= 0 ? data.total : 0;
  const totalPages = Number.isInteger(data.total_pages) && data.total_pages >= 0 ? data.total_pages : 0;
  return { results: normalizePhotoList(data.results), total, totalPages };
}

/**
 * Tells Unsplash a photo was used (required by the API guidelines whenever a photo
 * is set as a wallpaper). Authenticated request to `photo.links.download_location`.
 */
export async function trackDownload(downloadLocation, { signal } = {}) {
  const url = safeUnsplashUrl(downloadLocation, { host: API_HOST });
  if (!url) throw new UnsplashError('BAD_RESPONSE', 'Invalid Unsplash download location.');
  await request(url, { signal });
}
