// Unsplash discovery: picks, acquires and caches new wallpapers within the daily
// acquisition limit, and falls back to the local cache when the limit is reached,
// the browser is offline or the API fails.

import {
  getRandomPhotos,
  searchPhotos,
  trackDownload,
  isUnsplashConfigured,
  normalizeQuery,
  UnsplashError,
} from './unsplashClient.js';
import { pickUnsplashUrl, fetchImageBlob, decodeImage, makeThumbnail } from './imageLoader.js';
import { reserveSlot, commitSlot, releaseSlot, getQuotaStatus, QuotaError } from './quotaLimiter.js';
import {
  getUnsplash,
  putUnsplash,
  listUnsplash,
  searchUnsplashCache,
  touchWallpaper,
  evictUnsplashCache,
  deleteWallpapers,
  isQuotaExceededError,
} from './repository.js';
import { getWallpaperSettings, getActiveWallpaper, setActiveWallpaper } from './settings.js';

// Curated topics are plain search queries (not Unsplash topic slugs), so they cost no extra API calls.
export const CURATED_TOPICS = Object.freeze([
  { id: 'nature', label: 'Nature', query: 'nature' },
  { id: 'mountains', label: 'Mountains', query: 'mountains' },
  { id: 'architecture', label: 'Architecture', query: 'architecture' },
  { id: 'minimal', label: 'Minimal', query: 'minimal' },
  { id: 'landscapes', label: 'Landscapes', query: 'landscape' },
  { id: 'cities', label: 'Cities', query: 'city skyline' },
  { id: 'ocean', label: 'Ocean', query: 'ocean' },
  { id: 'space', label: 'Space', query: 'galaxy stars' },
  { id: 'wildlife', label: 'Wildlife', query: 'wildlife' },
  { id: 'abstract', label: 'Abstract', query: 'abstract' },
  { id: 'travel', label: 'Travel', query: 'travel' },
  { id: 'dark-moody', label: 'Dark & Moody', query: 'dark moody' },
].map((topic) => Object.freeze(topic)));

const RANDOM_COUNT = 10;
const SEARCH_PER_PAGE = 30;
const SEARCH_PAGE_SPREAD = 3;
const MAX_KEYWORDS = 64;

// Known page counts per search query, so later picks stay within real pages.
const knownTotalPages = new Map();

// The newest changeUnsplashBackground call supersedes (aborts) an older one.
let currentChange = null;

// ---------------------------------------------------------------------------
// Helpers

function isOnline() {
  return !(typeof navigator !== 'undefined' && navigator.onLine === false);
}

function isAbort(err, signal) {
  return Boolean(signal?.aborted) || err?.name === 'AbortError' || err?.code === 'ABORTED';
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new UnsplashError('ABORTED', 'The wallpaper change was cancelled.');
}

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function tokenize(text) {
  if (typeof text !== 'string' || !text) return [];
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 2);
}

function buildKeywords(values) {
  const set = new Set();
  for (const value of values) {
    for (const token of tokenize(value)) {
      set.add(token);
      if (set.size >= MAX_KEYWORDS) return Array.from(set);
    }
  }
  return Array.from(set);
}

function findCuratedTopic(value) {
  if (typeof value !== 'string') return null;
  const needle = value.trim().toLowerCase();
  return CURATED_TOPICS.find((t) => t.id === needle || t.label.toLowerCase() === needle) || null;
}

/** Resolves a settings topic (curated id/label or a custom term) to { id, query }. */
function resolveTopic(value) {
  const curated = findCuratedTopic(value);
  if (curated) return { id: curated.id, query: curated.query };
  try {
    const query = normalizeQuery(value);
    return { id: query.toLowerCase(), query };
  } catch {
    return null;
  }
}

/**
 * keyword mode → search endpoint with settings.keyword;
 * topics / random modes → random endpoint with one randomly chosen selected topic
 * (no query when no topic is selected).
 */
function resolveSelection(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  if (s.discoveryMode === 'keyword') {
    try {
      return { endpoint: 'search', query: normalizeQuery(s.keyword), topic: null, topics: [] };
    } catch {
      // An empty keyword falls back to unfiltered random photos.
      return { endpoint: 'random', query: undefined, topic: null, topics: [] };
    }
  }
  const topics = (Array.isArray(s.topics) ? s.topics : []).map(resolveTopic).filter(Boolean);
  const chosen = topics.length ? randomItem(topics) : null;
  return { endpoint: 'random', query: chosen?.query, topic: chosen?.id ?? null, topics };
}

function recordMatches(record, selection) {
  const keywords = new Set(Array.isArray(record.keywords) ? record.keywords : []);
  const hasAll = (query) => {
    const tokens = tokenize(query);
    return tokens.length > 0 && tokens.every((token) => keywords.has(token));
  };
  if (selection.endpoint === 'search') return hasAll(selection.query);
  if (!selection.topics.length) return true;
  return selection.topics.some((t) => record.topic === t.id || hasAll(t.query));
}

function lruTime(record) {
  return record.lastUsedAt ?? record.acquiredAt ?? 0;
}

function isActiveRecord(record) {
  const active = getActiveWallpaper();
  return active?.source === 'unsplash' && active.id === record.photoId;
}

function recordToResult(record) {
  return {
    photoId: record.photoId,
    width: record.width ?? null,
    height: record.height ?? null,
    color: record.color ?? null,
    description: record.description ?? null,
    urls: record.urls ?? {},
    photographer: record.photographer ?? { name: '', username: null, profileUrl: '' },
    photoPageUrl: record.photoPageUrl ?? '',
    downloadLocation: record.downloadLocation ?? null,
    tags: [],
    cached: true,
  };
}

/** Links the caller's signal with an internal controller that a newer call can abort. */
function startChange(signal) {
  currentChange?.controller.abort();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const change = {
    controller,
    signal: controller.signal,
    dispose() {
      signal?.removeEventListener('abort', onAbort);
      if (currentChange === change) currentChange = null;
    },
  };
  currentChange = change;
  return change;
}

async function verifyDecodable(blob) {
  // Skipped where there is no DOM image decoder (e.g. node tests); the browser always checks.
  if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  try {
    await decodeImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function storeRecord(record) {
  try {
    return await putUnsplash(record);
  } catch (err) {
    if (!isQuotaExceededError(err)) throw err;
    await evictUnsplashCache();
    return putUnsplash(record);
  }
}

// ---------------------------------------------------------------------------
// Acquisition

/**
 * Downloads, validates, stores and counts one Unsplash photo. Returns the cached
 * record without reserving when the photo is already cached. The reservation is
 * released on any failure or abort; a stale or aborted operation never commits.
 */
export async function acquirePhoto(photo, { query, topic, signal } = {}) {
  if (!photo || typeof photo.photoId !== 'string' || !photo.photoId || !photo.urls?.raw) {
    throw new UnsplashError('BAD_RESPONSE', 'Invalid Unsplash photo.');
  }
  const { photoId } = photo;

  const cached = await getUnsplash(photoId);
  if (cached) return cached;
  throwIfAborted(signal);

  const requestId = crypto.randomUUID();
  await reserveSlot({ requestId });

  let stored = false;
  let record;
  try {
    const url = pickUnsplashUrl(photo.urls, { photoWidth: photo.width });
    const blob = await fetchImageBlob(url, { signal });
    throwIfAborted(signal);
    await verifyDecodable(blob);
    throwIfAborted(signal);
    const thumb = await makeThumbnail(blob).catch(() => null);
    throwIfAborted(signal);

    record = await storeRecord({
      photoId,
      blob,
      thumb,
      size: blob.size,
      width: photo.width ?? null,
      height: photo.height ?? null,
      color: photo.color ?? null,
      description: photo.description ?? null,
      urls: { ...photo.urls },
      photographer: { ...photo.photographer },
      photoPageUrl: photo.photoPageUrl ?? null,
      downloadLocation: photo.downloadLocation ?? null,
      query: query ?? null,
      topic: topic ?? null,
      keywords: buildKeywords([query, topic, photo.description, ...(photo.tags || [])]),
      acquiredAt: Date.now(),
      lastUsedAt: null,
    });
    stored = true;
    throwIfAborted(signal);
    await commitSlot(requestId, photoId);
  } catch (err) {
    try {
      await releaseSlot(requestId);
    } catch (releaseErr) {
      console.warn('[wallpaper] could not release the Unsplash reservation:', releaseErr);
    }
    if (stored) {
      // Uncounted bytes must not stay in the cache.
      await deleteWallpapers([{ source: 'unsplash', id: photoId }]).catch((deleteErr) => {
        console.warn('[wallpaper] could not roll back an aborted acquisition:', deleteErr);
      });
    }
    throw err;
  }

  if (photo.downloadLocation) {
    trackDownload(photo.downloadLocation).catch((err) => {
      console.warn('[wallpaper] Unsplash download tracking failed:', err?.code || err?.message);
    });
  }

  try {
    await evictUnsplashCache({ protect: [photoId] });
  } catch (err) {
    console.warn('[wallpaper] cache eviction failed:', err);
  }

  return record;
}

async function fetchCandidates(selection, signal) {
  if (selection.endpoint === 'search') {
    const known = knownTotalPages.get(selection.query);
    const spread = Math.max(1, Math.min(SEARCH_PAGE_SPREAD, known ?? SEARCH_PAGE_SPREAD));
    let page = 1 + Math.floor(Math.random() * spread);
    let res = await searchPhotos({ query: selection.query, page, perPage: SEARCH_PER_PAGE, signal });
    knownTotalPages.set(selection.query, res.totalPages);
    if (!res.results.length && page > 1 && res.totalPages >= 1) {
      page = 1 + Math.floor(Math.random() * Math.min(SEARCH_PAGE_SPREAD, res.totalPages));
      res = await searchPhotos({ query: selection.query, page, perPage: SEARCH_PER_PAGE, signal });
    }
    return res.results;
  }
  return getRandomPhotos({ query: selection.query, count: RANDOM_COUNT, signal });
}

async function fetchAndAcquire(selection, signal) {
  const candidates = await fetchCandidates(selection, signal);
  throwIfAborted(signal);
  const cachedFlags = await Promise.all(candidates.map((p) => getUnsplash(p.photoId)));
  const fresh = candidates.filter((_, i) => !cachedFlags[i]);
  if (!fresh.length) return null;
  const photo = randomItem(fresh);
  return acquirePhoto(photo, { query: selection.query ?? null, topic: selection.topic, signal });
}

// ---------------------------------------------------------------------------
// Public API

/**
 * Changes the Unsplash wallpaper:
 *  1. a cached image matching the current topics/keyword that was never displayed;
 *  2. else, when the quota allows and the browser is online, a newly acquired photo;
 *  3. else the least-recently-used cached image;
 *  4. else throws (QuotaError or UnsplashError).
 */
export async function changeUnsplashBackground({ settings, signal } = {}) {
  const change = startChange(signal);
  const sig = change.signal;
  try {
    const selection = resolveSelection(settings ?? getWallpaperSettings());
    const records = await listUnsplash();
    throwIfAborted(sig);

    const activate = async (record, origin) => {
      throwIfAborted(sig);
      const ref = { source: 'unsplash', id: record.photoId };
      const touched = await touchWallpaper(ref);
      throwIfAborted(sig);
      setActiveWallpaper(ref);
      const quota = await getQuotaStatus();
      return { record: touched ?? record, origin, quota };
    };

    // 1. Unseen cached image for the current selection (oldest acquisition first).
    const unseen = records
      .filter((r) => r.lastUsedAt == null && recordMatches(r, selection) && !isActiveRecord(r))
      .sort((a, b) => (a.acquiredAt ?? 0) - (b.acquiredAt ?? 0));
    if (unseen.length) return await activate(unseen[0], 'cache');

    // 2. New photo, if the daily limit and connectivity allow.
    let lastError = null;
    const quota = await getQuotaStatus();
    const online = isOnline();
    const configured = isUnsplashConfigured();
    if (quota.remaining > 0 && online && configured) {
      try {
        const record = await fetchAndAcquire(selection, sig);
        if (record) return await activate(record, 'new');
      } catch (err) {
        if (isAbort(err, sig)) throw err;
        lastError = err;
      }
    }

    // 3. Least-recently-used cached image (matching ones first, never the current one if avoidable).
    throwIfAborted(sig);
    const byLru = (a, b) => lruTime(a) - lruTime(b);
    const others = records.filter((r) => !isActiveRecord(r));
    const pool = others.length ? others : records;
    const matching = pool.filter((r) => recordMatches(r, selection)).sort(byLru);
    const rotation = matching.length ? matching : [...pool].sort(byLru);
    if (rotation.length) return await activate(rotation[0], 'cache');

    // 4. Nothing to show.
    if (lastError) throw lastError;
    if (quota.remaining <= 0) {
      throw new QuotaError('The daily limit for new Unsplash wallpapers has been reached.', {
        code: 'DAILY_LIMIT',
        resetsAt: quota.resetsAt ?? null,
      });
    }
    if (!online) throw new UnsplashError('OFFLINE', 'You are offline and no Unsplash wallpapers are cached.');
    if (!configured) throw new UnsplashError('NOT_CONFIGURED', 'Unsplash is not configured (missing access key).');
    throw new UnsplashError('NOT_FOUND', 'No new Unsplash photos were found for this selection.');
  } finally {
    change.dispose();
  }
}

/**
 * Searches Unsplash, or only the local cache when the daily limit is reached or the
 * browser is offline (no API call). API results are flagged `cached` when already stored.
 */
export async function searchWallpapers({ query, page = 1, signal } = {}) {
  const q = normalizeQuery(query);
  const quota = await getQuotaStatus();
  const limitReached = quota.remaining <= 0;

  const fromCache = async () => {
    const records = await searchUnsplashCache(q);
    return {
      results: records.map(recordToResult),
      fromCache: true,
      limitReached,
      totalPages: records.length ? 1 : 0,
    };
  };

  if (limitReached || !isOnline()) return fromCache();

  let res;
  try {
    res = await searchPhotos({ query: q, page, signal });
  } catch (err) {
    if (err instanceof UnsplashError && ['RATE_LIMITED', 'NETWORK', 'OFFLINE'].includes(err.code)) {
      return fromCache();
    }
    throw err;
  }
  const cached = await Promise.all(res.results.map((p) => getUnsplash(p.photoId)));
  return {
    results: res.results.map((p, i) => ({ ...p, cached: Boolean(cached[i]) })),
    fromCache: false,
    limitReached: false,
    totalPages: res.totalPages,
  };
}
