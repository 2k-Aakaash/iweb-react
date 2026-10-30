import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetIwebDBConnection } from '../../wallpaper/db.js';
import {
  _resetClockStyle,
  getClockStyle,
  getStoredClockStyle,
  loadClockStyle,
  normalizeClockStyle,
  setClockStyle,
} from '../clockStyle.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(String(k)) ? this.map.get(String(k)) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(String(k)); }
  clear() { this.map.clear(); }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });

describe('clock style', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    _resetIwebDBConnection();
    localStorage.clear();
    _resetClockStyle();
  });

  it('knows the two styles (and the old name for Vibrant Colour)', () => {
    expect(normalizeClockStyle('glass')).toBe('glass');
    expect(normalizeClockStyle('vibrant')).toBe('vibrant');
    expect(normalizeClockStyle('solid')).toBe('vibrant');
    expect(normalizeClockStyle('neon')).toBeNull();
  });

  it('is Glass until chosen, and saves the choice in iWebDB', async () => {
    expect(getClockStyle()).toBe('glass');
    await setClockStyle('vibrant');
    expect(getClockStyle()).toBe('vibrant');
    expect(await getStoredClockStyle()).toBe('vibrant');
    // The localStorage copy draws the right clock on the next page's first frame.
    expect(localStorage.getItem('iweb:clockStyle')).toBe('vibrant');
    await setClockStyle('neon'); // ignored
    expect(await getStoredClockStyle()).toBe('vibrant');
  });

  it('takes the saved style from iWebDB on load', async () => {
    await setClockStyle('vibrant');
    // A new page whose localStorage copy was lost.
    localStorage.clear();
    _resetClockStyle();
    expect(getClockStyle()).toBe('glass');
    await loadClockStyle();
    expect(getClockStyle()).toBe('vibrant');
  });

  it('moves a style chosen before iWebDB kept it into iWebDB', async () => {
    localStorage.setItem('iweb:clockStyle', 'solid');
    _resetClockStyle();
    expect(getClockStyle()).toBe('vibrant');
    await loadClockStyle();
    expect(await getStoredClockStyle()).toBe('vibrant');
  });
});
