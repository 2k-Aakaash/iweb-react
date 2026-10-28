import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetIwebDBConnection, DB_NAME, openIwebDB, STORES } from '../db.js';
import {
  addLocalRecord,
  deleteWallpapers,
  evictUnsplashCache,
  findLocalByHash,
  getUnsplash,
  getWallpaperRecord,
  isQuotaExceededError,
  listLocal,
  listUnsplash,
  putUnsplash,
  searchUnsplashCache,
  touchWallpaper,
} from '../repository.js';
import { getActiveWallpaper, setActiveWallpaper } from '../settings.js';
import { subscribe } from '../sync.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(i) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k) { return this.map.has(String(k)) ? this.map.get(String(k)) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(String(k)); }
  clear() { this.map.clear(); }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
});

const blobOf = (text, type = 'image/jpeg') => new Blob([text], { type });

function unsplash(photoId, extra = {}) {
  return {
    photoId,
    blob: blobOf(`img-${photoId}`),
    thumb: null,
    width: 4000,
    height: 3000,
    color: '#000000',
    description: null,
    urls: { raw: `https://images.example/${photoId}` },
    photographer: { name: 'P', username: 'p', profileUrl: 'https://unsplash.com/@p' },
    photoPageUrl: `https://unsplash.com/photos/${photoId}`,
    downloadLocation: `https://api.unsplash.com/photos/${photoId}/download`,
    query: '',
    topic: null,
    keywords: [],
    acquiredAt: 1000,
    lastUsedAt: null,
    ...extra,
  };
}

let unsubscribers = [];

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetIwebDBConnection();
  localStorage.clear();
});

afterEach(() => {
  unsubscribers.forEach((off) => off());
  unsubscribers = [];
  _resetIwebDBConnection();
});

describe('v2 -> v3 migration', () => {
  it('keeps existing background_images records and adds the v3 stores', async () => {
    // Recreate the v2 schema exactly as the pre-v3 app did.
    await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('background_images', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('custom_fonts', { keyPath: 'family' });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['background_images', 'custom_fonts'], 'readwrite');
        tx.objectStore('background_images').add({ blob: blobOf('legacy-1') });
        tx.objectStore('background_images').add({ blob: blobOf('legacy-2') });
        tx.objectStore('custom_fonts').add({ family: 'MyFont', name: 'my.ttf', blob: blobOf('font') });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const db = await openIwebDB();
    expect(db.version).toBe(5);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(
      [STORES.LOCAL, STORES.FONTS, STORES.UNSPLASH, STORES.META, STORES.FAVICONS, STORES.PROFILE].sort(),
    );

    const local = await listLocal();
    expect(local.map((r) => r.id)).toEqual([1, 2]);
    expect(await local[0].blob.text()).toBe('legacy-1');
    expect(local[0]).toMatchObject({ source: 'local', thumb: null, name: null, createdAt: null });

    const font = await new Promise((resolve) => {
      const req = db.transaction(STORES.FONTS).objectStore(STORES.FONTS).get('MyFont');
      req.onsuccess = () => resolve(req.result);
    });
    expect(font.name).toBe('my.ttf');

    // New records continue the old id sequence and the hash index works.
    const id = await addLocalRecord({ blob: blobOf('new'), name: 'new.jpg', hash: 'h-new' });
    expect(id).toBe(3);
    expect(await findLocalByHash('h-new')).toBe(3);
    expect(await findLocalByHash('missing')).toBeNull();
  });
});

describe('local records', () => {
  it('adds, lists and looks up local images', async () => {
    const thumb = blobOf('t', 'image/webp');
    const id = await addLocalRecord({ blob: blobOf('abc'), thumb, name: 'a.jpg', type: 'image/jpeg', size: 3, hash: 'h1' });
    const [record] = await listLocal();
    expect(record).toMatchObject({ id, source: 'local', name: 'a.jpg', type: 'image/jpeg', size: 3 });
    expect(record.thumb).toBeInstanceOf(Blob);
    expect(typeof record.createdAt).toBe('number');

    const full = await getWallpaperRecord({ source: 'local', id });
    expect(full).toMatchObject({ id, hash: 'h1', source: 'local' });
    expect(await getWallpaperRecord({ source: 'local', id: 999 })).toBeNull();
    expect(await getWallpaperRecord({ source: 'nope', id: 1 })).toBeNull();
  });

  it('requires a Blob', async () => {
    await expect(addLocalRecord({ blob: 'nope' })).rejects.toBeInstanceOf(TypeError);
  });
});

describe('unsplash cache', () => {
  it('stores records with normalized keywords and lists newest first', async () => {
    await putUnsplash(unsplash('a', { acquiredAt: 100, keywords: ['Mountain Lake'], query: 'Alps', topic: 'nature' }));
    await putUnsplash(unsplash('b', { acquiredAt: 300 }));
    await putUnsplash(unsplash('c', { acquiredAt: 200 }));

    expect((await listUnsplash()).map((r) => r.photoId)).toEqual(['b', 'c', 'a']);
    const a = await getUnsplash('a');
    expect(a.keywords.sort()).toEqual(['alps', 'lake', 'mountain', 'nature']);
    expect(a.lastUsedAt).toBeNull();
    expect(await getUnsplash('zzz')).toBeNull();
    expect(await getWallpaperRecord({ source: 'unsplash', id: 'a' })).toMatchObject({ photoId: 'a', source: 'unsplash' });
  });

  it('touchWallpaper updates lastUsedAt for Unsplash and is a no-op for local', async () => {
    await putUnsplash(unsplash('a'));
    const updated = await touchWallpaper({ source: 'unsplash', id: 'a' }, { now: 5000 });
    expect(updated.lastUsedAt).toBe(5000);
    expect((await getUnsplash('a')).lastUsedAt).toBe(5000);
    expect(await touchWallpaper({ source: 'unsplash', id: 'missing' })).toBeNull();

    const id = await addLocalRecord({ blob: blobOf('x') });
    expect(await touchWallpaper({ source: 'local', id })).toBeNull();
    const [local] = await listLocal();
    expect(local).not.toHaveProperty('lastUsedAt');
  });

  it('searches the cache by ALL query tokens, most recently used first', async () => {
    await putUnsplash(unsplash('a', { keywords: ['mountain', 'lake'], acquiredAt: 100 }));
    await putUnsplash(unsplash('b', { keywords: ['mountain', 'lake', 'snow'], acquiredAt: 200 }));
    await putUnsplash(unsplash('c', { keywords: ['mountain'], acquiredAt: 300 }));
    await putUnsplash(unsplash('d', { keywords: ['lake'], acquiredAt: 50, lastUsedAt: 400 }));
    await putUnsplash(unsplash('e', { keywords: ['mountain', 'lake'], acquiredAt: 10, lastUsedAt: 500 }));

    expect((await searchUnsplashCache('Mountain-Lake!')).map((r) => r.photoId)).toEqual(['e', 'b', 'a']);
    expect((await searchUnsplashCache('  LAKE  ')).map((r) => r.photoId)).toEqual(['e', 'd', 'b', 'a']);
    // Single-character tokens are dropped.
    expect((await searchUnsplashCache('a snow')).map((r) => r.photoId)).toEqual(['b']);
    expect(await searchUnsplashCache('mountain desert')).toEqual([]);
    expect(await searchUnsplashCache('x')).toEqual([]);
    expect(await searchUnsplashCache('')).toEqual([]);
  });
});

describe('deleteWallpapers', () => {
  it('switches the active wallpaper to a replacement before deleting it', async () => {
    const id1 = await addLocalRecord({ blob: blobOf('1') });
    const id2 = await addLocalRecord({ blob: blobOf('2') });
    const id3 = await addLocalRecord({ blob: blobOf('3') });
    setActiveWallpaper({ source: 'local', id: id2 });

    let readAtSwitch = null;
    let activeAtSwitch = null;
    unsubscribers.push(subscribe((msg) => {
      if (msg.type !== 'active-changed') return;
      activeAtSwitch = msg.payload;
      // Started synchronously from the signal, so it reads the pre-delete state.
      readAtSwitch = getWallpaperRecord({ source: 'local', id: id2 });
    }));

    const result = await deleteWallpapers([{ source: 'local', id: id2 }]);
    expect(activeAtSwitch).toEqual({ source: 'local', id: id3 });
    expect(await readAtSwitch).not.toBeNull();

    expect(result).toEqual({
      deleted: [{ source: 'local', id: id2 }],
      missing: [],
      newActive: { source: 'local', id: id3 },
    });
    expect(getActiveWallpaper()).toEqual({ source: 'local', id: id3 });
    expect(localStorage.getItem('lastUsedBackgroundId')).toBe(String(id3));
    expect((await listLocal()).map((r) => r.id)).toEqual([id1, id3]);
  });

  it('deletes across both stores, dedupes refs and reports missing records', async () => {
    const id1 = await addLocalRecord({ blob: blobOf('1') });
    await putUnsplash(unsplash('u1'));
    await putUnsplash(unsplash('u2'));
    const events = [];
    unsubscribers.push(subscribe((msg) => events.push(msg.type)));

    const result = await deleteWallpapers([
      { source: 'local', id: id1 },
      { source: 'local', id: id1 },
      { source: 'unsplash', id: 'u1' },
      { source: 'unsplash', id: 'gone' },
      { source: 'local', id: 404 },
    ]);
    expect(result.deleted).toEqual([{ source: 'local', id: id1 }, { source: 'unsplash', id: 'u1' }]);
    expect(result.missing).toEqual([{ source: 'unsplash', id: 'gone' }, { source: 'local', id: 404 }]);
    expect(result.newActive).toBeNull();
    expect(await listLocal()).toEqual([]);
    expect((await listUnsplash()).map((r) => r.photoId)).toEqual(['u2']);
    expect(events).toEqual(['library-changed']);

    // Deleting only missing records is harmless and does not broadcast.
    events.length = 0;
    const again = await deleteWallpapers([{ source: 'unsplash', id: 'u1' }]);
    expect(again).toMatchObject({ deleted: [], missing: [{ source: 'unsplash', id: 'u1' }] });
    expect(events).toEqual([]);
  });

  it('replaces an active Unsplash wallpaper with the most recent remaining one, then local', async () => {
    const localId = await addLocalRecord({ blob: blobOf('1') });
    await putUnsplash(unsplash('old', { acquiredAt: 100 }));
    await putUnsplash(unsplash('recent', { acquiredAt: 50, lastUsedAt: 900 }));
    await putUnsplash(unsplash('active', { acquiredAt: 1000 }));
    setActiveWallpaper({ source: 'unsplash', id: 'active' });

    let result = await deleteWallpapers([{ source: 'unsplash', id: 'active' }]);
    expect(result.newActive).toEqual({ source: 'unsplash', id: 'recent' });

    result = await deleteWallpapers([{ source: 'unsplash', id: 'recent' }, { source: 'unsplash', id: 'old' }]);
    expect(result.newActive).toEqual({ source: 'local', id: localId });
    expect(getActiveWallpaper()).toEqual({ source: 'local', id: localId });
  });

  it('clears the active wallpaper when nothing is left, even if its record is already gone', async () => {
    setActiveWallpaper({ source: 'local', id: 77 });
    const result = await deleteWallpapers([{ source: 'local', id: 77 }]);
    expect(result).toEqual({ deleted: [], missing: [{ source: 'local', id: 77 }], newActive: null });
    expect(getActiveWallpaper()).toBeNull();
    expect(localStorage.getItem('lastUsedBackgroundId')).toBeNull();
  });

  it('leaves an unaffected active wallpaper alone', async () => {
    const id1 = await addLocalRecord({ blob: blobOf('1') });
    const id2 = await addLocalRecord({ blob: blobOf('2') });
    setActiveWallpaper({ source: 'local', id: id1 });
    const result = await deleteWallpapers([{ source: 'local', id: id2 }]);
    expect(result.newActive).toEqual({ source: 'local', id: id1 });
    expect(getActiveWallpaper()).toEqual({ source: 'local', id: id1 });
  });
});

describe('evictUnsplashCache', () => {
  it('evicts least recently used records, protecting the active one and the protect list', async () => {
    const localIds = [];
    for (let i = 0; i < 3; i += 1) localIds.push(await addLocalRecord({ blob: blobOf(`local-${i}`) }));
    await putUnsplash(unsplash('oldest', { acquiredAt: 10 }));
    await putUnsplash(unsplash('active', { acquiredAt: 20 }));
    await putUnsplash(unsplash('protected', { acquiredAt: 30 }));
    await putUnsplash(unsplash('used', { acquiredAt: 5, lastUsedAt: 500 }));
    await putUnsplash(unsplash('newer', { acquiredAt: 40 }));
    setActiveWallpaper({ source: 'unsplash', id: 'active' });

    const evicted = await evictUnsplashCache({ maxCount: 3, protect: ['protected'] });
    expect(evicted).toBe(2);
    expect((await listUnsplash()).map((r) => r.photoId).sort()).toEqual(['active', 'protected', 'used']);
    expect((await listLocal()).map((r) => r.id)).toEqual(localIds);

    // Even a zero budget keeps protected records and local images.
    expect(await evictUnsplashCache({ maxCount: 0, protect: [{ source: 'unsplash', id: 'protected' }] })).toBe(1);
    expect((await listUnsplash()).map((r) => r.photoId).sort()).toEqual(['active', 'protected']);
    expect(await listLocal()).toHaveLength(3);
  });

  it('enforces the byte budget', async () => {
    await putUnsplash(unsplash('a', { acquiredAt: 1, size: 100 }));
    await putUnsplash(unsplash('b', { acquiredAt: 2, size: 100 }));
    await putUnsplash(unsplash('c', { acquiredAt: 3, size: 100 }));
    expect(await evictUnsplashCache({ maxBytes: 250 })).toBe(1);
    expect((await listUnsplash()).map((r) => r.photoId)).toEqual(['c', 'b']);
    expect(await evictUnsplashCache({ maxBytes: 250 })).toBe(0);
  });
});

describe('isQuotaExceededError', () => {
  it('recognizes storage quota errors', () => {
    expect(isQuotaExceededError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaExceededError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaExceededError(new Error('wrapped', { cause: new DOMException('full', 'QuotaExceededError') }))).toBe(true);
    expect(isQuotaExceededError(new Error('other'))).toBe(false);
    expect(isQuotaExceededError(null)).toBe(false);
  });
});
