// Dock bookmark icons, cached in iWebDB (store `favicons`, keyed by domain).
//
// Icons are shown straight from IndexedDB; the API (/api/favicon) is only asked when a
// domain has no cached icon or its icon is older than a week. A failed refresh keeps the old
// icon and tries again a day later, so being offline never costs the Dock its icons.

import { apiUrl } from '../apiBase';
import { openIwebDB, reqToPromise, STORES } from '../wallpaper/db';

export const REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // weekly
const RETRY_MS = 24 * 60 * 60 * 1000; // after a failed refresh

const objectUrls = new Map(); // domain -> object URL of the cached blob
const records = new Map(); // domain -> stored record (filled by the preload)
const inFlight = new Map(); // domain -> Promise<string|null>

// Read every cached icon in ONE IndexedDB request as soon as this module loads (it is imported
// by the Dock, so this starts with the app's code, before the first render). By the time the
// Dock renders, the icons are usually already in memory and show on the first frame.
let preload = null;
export function preloadFavicons() {
  if (!preload) {
    preload = (async () => {
      try {
        const db = await openIwebDB();
        const all = await reqToPromise(db.transaction(STORES.FAVICONS, 'readonly').objectStore(STORES.FAVICONS).getAll());
        for (const record of all) {
          records.set(record.domain, record);
          if (record.blob && !objectUrls.has(record.domain)) objectUrls.set(record.domain, URL.createObjectURL(record.blob));
        }
      } catch {
        /* IndexedDB unavailable: icons come from the network */
      }
    })();
  }
  return preload;
}
if (typeof indexedDB !== 'undefined' && typeof window !== 'undefined') preloadFavicons();

// Test helper: forget everything held in memory (used with fake-indexeddb resets).
export function _resetFaviconCache() {
  objectUrls.clear();
  records.clear();
  inFlight.clear();
  preload = null;
}

/**
 * Synchronous peek for the first render: the cached icon URL, null when the site is known to
 * have no icon, or undefined when nothing is known yet.
 */
export function peekFavicon(domain) {
  if (objectUrls.has(domain)) return objectUrls.get(domain);
  return records.has(domain) ? null : undefined;
}

async function readRecord(domain) {
  await preloadFavicons();
  if (records.has(domain)) return records.get(domain);
  const db = await openIwebDB();
  return reqToPromise(db.transaction(STORES.FAVICONS, 'readonly').objectStore(STORES.FAVICONS).get(domain));
}

async function writeRecord(record) {
  records.set(record.domain, record);
  const db = await openIwebDB();
  return reqToPromise(db.transaction(STORES.FAVICONS, 'readwrite').objectStore(STORES.FAVICONS).put(record));
}

function urlFor(domain, blob) {
  const old = objectUrls.get(domain);
  if (old) URL.revokeObjectURL(old);
  if (!blob) {
    objectUrls.delete(domain);
    return null;
  }
  const url = URL.createObjectURL(blob);
  objectUrls.set(domain, url);
  return url;
}

async function download(domain) {
  const url = apiUrl(`/api/favicon?domain=${encodeURIComponent(domain)}`);
  if (!url) return { ok: false };
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (res.status === 404) return { ok: true, blob: null }; // the site has no icon: remember that
    if (!res.ok) return { ok: false };
    const blob = await res.blob();
    return blob.type.startsWith('image/') ? { ok: true, blob } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Object URL of the cached icon for `domain` (or null if there is none yet / the site has no
 * icon), calling `onUpdate(url)` if a background refresh replaces it.
 */
export async function getFavicon(domain, { onUpdate, now = Date.now() } = {}) {
  if (!domain) return null;
  let record;
  try {
    record = await readRecord(domain);
  } catch {
    record = null; // IndexedDB unavailable: fall back to the network icons
  }

  const cachedUrl = objectUrls.get(domain) ?? (record?.blob ? urlFor(domain, record.blob) : null);
  // Refresh when there is nothing cached or it is a week old, unless a refresh failed today.
  const due = !record || now - (record.fetchedAt ?? 0) >= REFRESH_MS;
  const retryBlocked = record?.failedAt != null && now - record.failedAt < RETRY_MS;

  if (due && !retryBlocked) {
    const refresh = refreshFavicon(domain, record, now);
    if (!record) return refresh; // first time: wait for it
    refresh.then((url) => {
      if (url && url !== cachedUrl) onUpdate?.(url);
    });
  }
  return cachedUrl;
}

function refreshFavicon(domain, previous, now) {
  if (inFlight.has(domain)) return inFlight.get(domain);
  const job = (async () => {
    const result = await download(domain);
    try {
      if (result.ok) {
        await writeRecord({ domain, blob: result.blob, fetchedAt: now, failedAt: null });
        return urlFor(domain, result.blob);
      }
      // Keep whatever we had; try again tomorrow.
      await writeRecord({ ...(previous ?? { domain, blob: null, fetchedAt: 0 }), failedAt: now });
    } catch {
      /* storage failed: nothing cached this time */
    }
    return objectUrls.get(domain) ?? null;
  })().finally(() => inFlight.delete(domain));
  inFlight.set(domain, job);
  return job;
}
