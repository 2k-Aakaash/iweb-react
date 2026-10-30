import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetIwebDBConnection } from '../../wallpaper/db.js';
import { allPrefs, createStoredPref, toBoolean } from '../storedPref.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(String(k)) ? this.map.get(String(k)) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(String(k)); }
  clear() { this.map.clear(); }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });

const flag = createStoredPref({ key: 'test_flag', mirrorKey: 'iweb:testFlag', fallback: false, normalize: toBoolean });
const level = createStoredPref({
  key: 'test_level',
  mirrorKey: 'iweb:testLevel',
  fallback: 50,
  normalize: (v) => (Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null),
  debounceMs: 50,
});

describe('stored settings', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    _resetIwebDBConnection();
    localStorage.clear();
    flag._reset();
    level._reset();
  });

  it('saves to iWebDB and keeps a copy for the first frame', async () => {
    expect(flag.get()).toBe(false);
    await flag.set(true);
    expect(flag.get()).toBe(true);
    expect(await flag.getStored()).toBe(true);
    expect(localStorage.getItem('iweb:testFlag')).toBe('true');
    await flag.set('yes'); // not a boolean: ignored
    expect(flag.get()).toBe(true);
    await flag.set((v) => !v); // from the current value
    expect(await flag.getStored()).toBe(false);
  });

  it('trusts iWebDB over the copy when the page loads', async () => {
    await flag.set(true);
    localStorage.setItem('iweb:testFlag', 'false');
    flag._reset();
    expect(flag.get()).toBe(false);
    await flag.load();
    expect(flag.get()).toBe(true);
  });

  it('writes a slider once it settles', async () => {
    vi.useFakeTimers();
    const saving = [level.set(10), level.set(20), level.set(130)];
    expect(level.get()).toBe(100); // shown at once, clamped
    vi.advanceTimersByTime(60);
    vi.useRealTimers();
    await Promise.all(saving.slice(-1));
    expect(await level.getStored()).toBe(100);
  });

  it('lists every setting for backups', () => {
    expect(allPrefs().get('test_flag')).toBe(flag);
    expect(allPrefs().get('test_level')).toBe(level);
  });
});
