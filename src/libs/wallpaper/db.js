// Single shared opener for the `iWebDB` IndexedDB database.
// Every module that touches iWebDB (wallpapers, custom fonts, backups) must use
// openIwebDB() — opening with a hard-coded older version throws VersionError
// once the database has been upgraded.

export const DB_NAME = 'iWebDB';
export const DB_VERSION = 5;

export const STORES = {
  LOCAL: 'background_images',   // existing: { id (autoInc), blob, + v3 optional: thumb, name, type, size, hash, createdAt }
  FONTS: 'custom_fonts',        // existing: { family, name, blob }
  UNSPLASH: 'unsplash_images',  // v3: keyed by Unsplash photoId
  META: 'wallpaper_meta',       // v3: { key, ... } — e.g. key 'unsplash_quota'
  FAVICONS: 'favicons',         // v4: { domain, blob, fetchedAt } — Dock bookmark icons
  PROFILE: 'profile',           // v5: { key, ... } — key 'avatar': { blob, updatedAt }
};

// Deterministic, idempotent upgrade: only creates what is missing, never deletes data.
export function upgradeIwebDB(db, tx) {
  const local = db.objectStoreNames.contains(STORES.LOCAL)
    ? tx.objectStore(STORES.LOCAL)
    : db.createObjectStore(STORES.LOCAL, { keyPath: 'id', autoIncrement: true });
  if (!local.indexNames.contains('hash')) local.createIndex('hash', 'hash', { unique: false });

  if (!db.objectStoreNames.contains(STORES.FONTS)) {
    db.createObjectStore(STORES.FONTS, { keyPath: 'family' });
  }

  const unsplash = db.objectStoreNames.contains(STORES.UNSPLASH)
    ? tx.objectStore(STORES.UNSPLASH)
    : db.createObjectStore(STORES.UNSPLASH, { keyPath: 'photoId' });
  if (!unsplash.indexNames.contains('acquiredAt')) unsplash.createIndex('acquiredAt', 'acquiredAt');
  if (!unsplash.indexNames.contains('lastUsedAt')) unsplash.createIndex('lastUsedAt', 'lastUsedAt');
  if (!unsplash.indexNames.contains('keywords')) unsplash.createIndex('keywords', 'keywords', { multiEntry: true });

  if (!db.objectStoreNames.contains(STORES.META)) {
    db.createObjectStore(STORES.META, { keyPath: 'key' });
  }

  if (!db.objectStoreNames.contains(STORES.FAVICONS)) {
    db.createObjectStore(STORES.FAVICONS, { keyPath: 'domain' });
  }

  if (!db.objectStoreNames.contains(STORES.PROFILE)) {
    db.createObjectStore(STORES.PROFILE, { keyPath: 'key' });
  }
}

let dbPromise = null;

export function openIwebDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => upgradeIwebDB(e.target.result, e.target.transaction);
    req.onblocked = () => {
      console.warn('[iWebDB] upgrade blocked by another open tab; it will continue once that tab closes or reloads.');
    };
    req.onsuccess = () => {
      const db = req.result;
      // Let a newer version in another tab upgrade instead of blocking it.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

// Test helper: forget the cached connection (used with fake-indexeddb resets).
export function _resetIwebDBConnection() {
  dbPromise = null;
}

// Promisified helpers.
export function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new DOMException('Transaction aborted', 'AbortError'));
  });
}
