// Wallpaper library storage: local uploads (`background_images`) and the Unsplash
// cache (`unsplash_images`). Components never touch IndexedDB directly.

import { openIwebDB, STORES, txDone } from './db.js';
import { getActiveWallpaper, normalizeWallpaperRef, setActiveWallpaper } from './settings.js';
import { broadcast } from './sync.js';

const DEFAULT_MAX_COUNT = 40;
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Transaction helper
// ---------------------------------------------------------------------------

async function openTransaction(storeNames, mode) {
  const db = await openIwebDB();
  try {
    return db.transaction(storeNames, mode);
  } catch (err) {
    // The cached connection was closed (e.g. versionchange); reopen once.
    if (err?.name !== 'InvalidStateError') throw err;
  }
  const fresh = await openIwebDB();
  return fresh.transaction(storeNames, mode);
}

/**
 * Runs `work(tx)` in one transaction. `work` issues requests synchronously (with
 * callbacks) and returns a getter that produces the result once the transaction
 * has committed. A getter that throws turns into a rejection.
 */
async function runTransaction(storeNames, mode, work) {
  const tx = await openTransaction(storeNames, mode);
  const done = txDone(tx);
  let getResult;
  try {
    getResult = work(tx);
  } catch (err) {
    done.catch(() => {});
    try {
      tx.abort();
    } catch {
      // Already finished; nothing to roll back.
    }
    throw err;
  }
  await done;
  return typeof getResult === 'function' ? getResult() : undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function refKey(ref) {
  return `${ref.source}:${ref.id}`;
}

function recency(record) {
  return record.lastUsedAt ?? record.acquiredAt ?? 0;
}

function recordBytes(record) {
  const main = typeof record.size === 'number' && Number.isFinite(record.size)
    ? record.size
    : (record.blob?.size ?? 0);
  return main + (record.thumb?.size ?? 0);
}

/** Lower-cases, splits on anything that is not a letter or digit, drops tokens < 2 chars. */
export function tokenizeKeywords(text) {
  if (typeof text !== 'string' || !text) return [];
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2);
}

function uniqueTokens(values) {
  const set = new Set();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    for (const token of tokenizeKeywords(value)) set.add(token);
  }
  return Array.from(set);
}

export function isQuotaExceededError(err) {
  let current = err;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (current.name === 'QuotaExceededError'
      || current.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || current.code === 22
      || current.code === 1014) {
      return true;
    }
    current = current.cause ?? current.error ?? null;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Local images
// ---------------------------------------------------------------------------

export async function listLocal() {
  return runTransaction(STORES.LOCAL, 'readonly', (tx) => {
    const req = tx.objectStore(STORES.LOCAL).getAll();
    return () => req.result.map((record) => ({
      id: record.id,
      source: 'local',
      thumb: record.thumb ?? null,
      blob: record.blob ?? null,
      name: record.name ?? null,
      type: record.type ?? record.blob?.type ?? null,
      size: record.size ?? record.blob?.size ?? null,
      createdAt: record.createdAt ?? null,
    }));
  });
}

export async function addLocalRecord({ blob, thumb = null, name, type, size, hash } = {}) {
  if (!(blob instanceof Blob)) throw new TypeError('addLocalRecord requires a Blob');
  const record = {
    blob,
    thumb: thumb instanceof Blob ? thumb : null,
    name: typeof name === 'string' ? name : '',
    type: typeof type === 'string' && type ? type : blob.type,
    size: typeof size === 'number' && Number.isFinite(size) ? size : blob.size,
    createdAt: Date.now(),
  };
  // Only valid keys are indexed; leave `hash` out entirely when unknown.
  if (typeof hash === 'string' && hash) record.hash = hash;

  return runTransaction(STORES.LOCAL, 'readwrite', (tx) => {
    const req = tx.objectStore(STORES.LOCAL).add(record);
    return () => req.result;
  });
}

export async function findLocalByHash(hash) {
  if (typeof hash !== 'string' || !hash) return null;
  return runTransaction(STORES.LOCAL, 'readonly', (tx) => {
    const req = tx.objectStore(STORES.LOCAL).index('hash').getKey(hash);
    return () => req.result ?? null;
  });
}

// ---------------------------------------------------------------------------
// Unsplash cache
// ---------------------------------------------------------------------------

export async function listUnsplash() {
  const records = await runTransaction(STORES.UNSPLASH, 'readonly', (tx) => {
    const req = tx.objectStore(STORES.UNSPLASH).getAll();
    return () => req.result;
  });
  return records.sort((a, b) => (b.acquiredAt ?? 0) - (a.acquiredAt ?? 0));
}

export async function getUnsplash(photoId) {
  if (typeof photoId !== 'string' || !photoId) return null;
  return runTransaction(STORES.UNSPLASH, 'readonly', (tx) => {
    const req = tx.objectStore(STORES.UNSPLASH).get(photoId);
    return () => req.result ?? null;
  });
}

export async function putUnsplash(record) {
  if (!record || typeof record.photoId !== 'string' || !record.photoId) {
    throw new TypeError('putUnsplash requires a record with a photoId');
  }
  const keywords = uniqueTokens([
    ...(Array.isArray(record.keywords) ? record.keywords : []),
    ...(Array.isArray(record.tags) ? record.tags : []),
    record.query,
    record.topic,
    record.description,
  ]);
  const blob = record.blob instanceof Blob ? record.blob : null;
  const stored = {
    ...record,
    blob,
    thumb: record.thumb instanceof Blob ? record.thumb : null,
    size: typeof record.size === 'number' && Number.isFinite(record.size) ? record.size : (blob?.size ?? 0),
    keywords,
    acquiredAt: typeof record.acquiredAt === 'number' ? record.acquiredAt : Date.now(),
    lastUsedAt: typeof record.lastUsedAt === 'number' ? record.lastUsedAt : null,
  };

  await runTransaction(STORES.UNSPLASH, 'readwrite', (tx) => {
    tx.objectStore(STORES.UNSPLASH).put(stored);
    return null;
  });
  return stored;
}

/** Marks a wallpaper as displayed. Updates `lastUsedAt` for Unsplash records; no-op for local. */
export async function touchWallpaper(ref, { now } = {}) {
  const normalized = normalizeWallpaperRef(ref);
  if (!normalized || normalized.source !== 'unsplash') return null;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();

  return runTransaction(STORES.UNSPLASH, 'readwrite', (tx) => {
    const store = tx.objectStore(STORES.UNSPLASH);
    const req = store.get(normalized.id);
    let updated = null;
    req.onsuccess = () => {
      if (!req.result) return;
      updated = { ...req.result, lastUsedAt: at };
      store.put(updated);
    };
    return () => updated;
  });
}

/**
 * Records whose `keywords` contain ALL tokens of `query`, most recently used /
 * acquired first. A query without usable tokens matches nothing.
 */
export async function searchUnsplashCache(query) {
  const tokens = uniqueTokens([query]);
  if (tokens.length === 0) return [];

  const records = await runTransaction(STORES.UNSPLASH, 'readonly', (tx) => {
    const store = tx.objectStore(STORES.UNSPLASH);
    const index = store.index('keywords');
    const keySets = new Array(tokens.length);
    const found = [];
    let pending = tokens.length;

    tokens.forEach((token, i) => {
      const req = index.getAllKeys(token);
      req.onsuccess = () => {
        keySets[i] = req.result;
        pending -= 1;
        if (pending > 0) return;

        // Intersect, starting from the smallest set.
        const ordered = [...keySets].sort((a, b) => a.length - b.length);
        let matches = new Set(ordered[0]);
        for (let k = 1; k < ordered.length && matches.size > 0; k += 1) {
          const next = new Set(ordered[k]);
          matches = new Set([...matches].filter((key) => next.has(key)));
        }
        for (const key of matches) {
          const getReq = store.get(key);
          getReq.onsuccess = () => {
            if (getReq.result) found.push(getReq.result);
          };
        }
      };
    });
    return () => found;
  });

  return records.sort((a, b) => recency(b) - recency(a));
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export async function getWallpaperRecord(ref) {
  const normalized = normalizeWallpaperRef(ref);
  if (!normalized) return null;
  const storeName = normalized.source === 'local' ? STORES.LOCAL : STORES.UNSPLASH;
  return runTransaction(storeName, 'readonly', (tx) => {
    const req = tx.objectStore(storeName).get(normalized.id);
    return () => (req.result ? { ...req.result, source: normalized.source } : null);
  });
}

// Picks the active wallpaper's replacement from the records that survive the delete:
// same source first (local: the next id after the deleted one, wrapping; Unsplash:
// the most recently used), then the other source.
async function pickReplacement(active, removedKeys) {
  const { localIds, unsplashRecords } = await runTransaction(
    [STORES.LOCAL, STORES.UNSPLASH],
    'readonly',
    (tx) => {
      const localReq = tx.objectStore(STORES.LOCAL).getAllKeys();
      const unsplashReq = tx.objectStore(STORES.UNSPLASH).getAll();
      return () => ({ localIds: localReq.result, unsplashRecords: unsplashReq.result });
    },
  );

  const localCandidates = localIds.filter((id) => !removedKeys.has(refKey({ source: 'local', id })));
  const unsplashCandidates = unsplashRecords
    .filter((r) => !removedKeys.has(refKey({ source: 'unsplash', id: r.photoId })))
    .sort((a, b) => recency(b) - recency(a));

  const pickLocal = () => {
    if (localCandidates.length === 0) return null;
    const after = active.source === 'local' ? localCandidates.find((id) => id > active.id) : undefined;
    return { source: 'local', id: after ?? localCandidates[0] };
  };
  const pickUnsplash = () => (
    unsplashCandidates.length ? { source: 'unsplash', id: unsplashCandidates[0].photoId } : null
  );

  return active.source === 'local'
    ? (pickLocal() ?? pickUnsplash())
    : (pickUnsplash() ?? pickLocal());
}

export async function deleteWallpapers(refs) {
  if (!Array.isArray(refs)) throw new TypeError('deleteWallpapers expects an array of refs');

  const targets = [];
  const invalid = [];
  const keys = new Set();
  for (const ref of refs) {
    const normalized = normalizeWallpaperRef(ref);
    if (!normalized) {
      if (ref != null) invalid.push(ref);
      continue;
    }
    const key = refKey(normalized);
    if (keys.has(key)) continue;
    keys.add(key);
    targets.push(normalized);
  }

  let active = getActiveWallpaper();
  if (targets.length === 0) {
    return { deleted: [], missing: invalid, newActive: active };
  }

  // Switch away from the active wallpaper BEFORE its data disappears.
  if (active && keys.has(refKey(active))) {
    active = await pickReplacement(active, keys);
    setActiveWallpaper(active);
  }

  const { deleted, missing } = await runTransaction(
    [STORES.LOCAL, STORES.UNSPLASH],
    'readwrite',
    (tx) => {
      const outcome = targets.map(() => null);
      targets.forEach((ref, i) => {
        const store = tx.objectStore(ref.source === 'local' ? STORES.LOCAL : STORES.UNSPLASH);
        const countReq = store.count(ref.id);
        countReq.onsuccess = () => {
          if (countReq.result > 0) {
            store.delete(ref.id);
            outcome[i] = true;
          } else {
            outcome[i] = false;
          }
        };
      });
      return () => ({
        deleted: targets.filter((_, i) => outcome[i]),
        missing: targets.filter((_, i) => !outcome[i]),
      });
    },
  );

  if (deleted.length > 0) broadcast('library-changed');
  return { deleted, missing: [...missing, ...invalid], newActive: active };
}

/**
 * Evicts least-recently-used Unsplash records until the cache fits within
 * `maxCount` records and `maxBytes`. Never evicts the active wallpaper or anything
 * in `protect` (WallpaperRefs or photoId strings). Never touches local images.
 */
export async function evictUnsplashCache({
  maxCount = DEFAULT_MAX_COUNT,
  maxBytes = DEFAULT_MAX_BYTES,
  protect = [],
} = {}) {
  const protectedIds = new Set();
  for (const item of Array.isArray(protect) ? protect : []) {
    if (typeof item === 'string' && item) {
      protectedIds.add(item);
    } else {
      const ref = normalizeWallpaperRef(item);
      if (ref?.source === 'unsplash') protectedIds.add(ref.id);
    }
  }
  const active = getActiveWallpaper();
  if (active?.source === 'unsplash') protectedIds.add(active.id);

  const countLimit = Math.max(0, Number.isFinite(maxCount) ? maxCount : DEFAULT_MAX_COUNT);
  const byteLimit = Math.max(0, Number.isFinite(maxBytes) ? maxBytes : DEFAULT_MAX_BYTES);

  const evicted = await runTransaction(STORES.UNSPLASH, 'readwrite', (tx) => {
    const store = tx.objectStore(STORES.UNSPLASH);
    const req = store.getAll();
    let removed = 0;
    req.onsuccess = () => {
      const records = req.result;
      let count = records.length;
      let bytes = records.reduce((sum, r) => sum + recordBytes(r), 0);
      const candidates = records
        .filter((r) => !protectedIds.has(r.photoId))
        .sort((a, b) => recency(a) - recency(b));

      for (const record of candidates) {
        if (count <= countLimit && bytes <= byteLimit) break;
        store.delete(record.photoId);
        count -= 1;
        bytes -= recordBytes(record);
        removed += 1;
      }
    };
    return () => removed;
  });

  if (evicted > 0) broadcast('library-changed');
  return evicted;
}

// ---------------------------------------------------------------------------
// Thumbnail backfill (records created before thumbnails existed)
// ---------------------------------------------------------------------------

/** Refs of records whose `thumb` is missing but whose full image is stored. */
export async function listMissingThumbnails() {
  const [local, unsplash] = await Promise.all([
    runTransaction(STORES.LOCAL, 'readonly', (tx) => {
      const req = tx.objectStore(STORES.LOCAL).getAll();
      return () => req.result.filter((r) => !r.thumb && r.blob).map((r) => ({ source: 'local', id: r.id }));
    }),
    runTransaction(STORES.UNSPLASH, 'readonly', (tx) => {
      const req = tx.objectStore(STORES.UNSPLASH).getAll();
      return () => req.result.filter((r) => !r.thumb && r.blob).map((r) => ({ source: 'unsplash', id: r.photoId }));
    }),
  ]);
  return [...local, ...unsplash];
}

/** Stores a generated thumbnail on an existing record. Returns false if the record is gone. */
export async function setThumbnail(ref, thumb) {
  if (!(thumb instanceof Blob)) return false;
  const storeName = ref.source === 'unsplash' ? STORES.UNSPLASH : STORES.LOCAL;
  return runTransaction(storeName, 'readwrite', (tx) => {
    const store = tx.objectStore(storeName);
    const req = store.get(ref.id);
    let updated = false;
    req.onsuccess = () => {
      const record = req.result;
      if (!record || record.thumb) return;
      store.put({ ...record, thumb });
      updated = true;
    };
    return () => updated;
  });
}
