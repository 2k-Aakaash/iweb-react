import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  getActiveWallpaper,
  getWallpaperSettings,
  setActiveWallpaper,
  setWallpaperSettings,
} from '../settings.js';
import { broadcast, subscribe } from '../sync.js';

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

let unsubscribers = [];
function collect() {
  const events = [];
  unsubscribers.push(subscribe((msg) => events.push(msg)));
  return events;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  unsubscribers.forEach((off) => off());
  unsubscribers = [];
});

describe('wallpaper settings', () => {
  it('returns defaults when nothing is stored or the JSON is corrupt', () => {
    expect(getWallpaperSettings()).toEqual({ ...DEFAULT_SETTINGS, topics: [] });
    localStorage.setItem('wallpaperSettings', '{not json');
    expect(getWallpaperSettings()).toEqual({ ...DEFAULT_SETTINGS, topics: [] });
  });

  it('validates and merges stored values with defaults', () => {
    localStorage.setItem('wallpaperSettings', JSON.stringify({
      source: 'flickr',
      discoveryMode: 'keyword',
      topics: ['nature', '', 'nature', 42, ' city '],
      keyword: '  mountains  ',
    }));
    expect(getWallpaperSettings()).toEqual({
      source: 'local',
      discoveryMode: 'keyword',
      topics: ['nature', 'city'],
      keyword: 'mountains',
    });
  });

  it('persists a patch, returns the merged settings and broadcasts settings-changed', () => {
    const events = collect();
    const next = setWallpaperSettings({ source: 'unsplash', topics: ['ocean'] });
    expect(next).toEqual({ source: 'unsplash', discoveryMode: 'topics', topics: ['ocean'], keyword: '' });
    expect(JSON.parse(localStorage.getItem('wallpaperSettings'))).toEqual(next);
    expect(getWallpaperSettings()).toEqual(next);
    expect(events).toEqual([{ type: 'settings-changed', payload: next, local: true }]);

    setWallpaperSettings({ keyword: 'forest' });
    expect(getWallpaperSettings()).toMatchObject({ source: 'unsplash', topics: ['ocean'], keyword: 'forest' });
  });

  it('does not leak mutations into DEFAULT_SETTINGS', () => {
    const settings = getWallpaperSettings();
    settings.topics.push('mutated');
    expect(DEFAULT_SETTINGS.topics).toEqual([]);
    expect(getWallpaperSettings().topics).toEqual([]);
  });
});

describe('active wallpaper', () => {
  it('stores local refs and keeps the legacy lastUsedBackgroundId in sync', () => {
    const events = collect();
    setActiveWallpaper({ source: 'local', id: 7 });
    expect(JSON.parse(localStorage.getItem('activeWallpaper'))).toEqual({ source: 'local', id: 7 });
    expect(localStorage.getItem('lastUsedBackgroundId')).toBe('7');
    expect(getActiveWallpaper()).toEqual({ source: 'local', id: 7 });
    expect(events).toEqual([{ type: 'active-changed', payload: { source: 'local', id: 7 }, local: true }]);
  });

  it('removes the legacy key for Unsplash refs and for null', () => {
    setActiveWallpaper({ source: 'local', id: 3 });
    setActiveWallpaper({ source: 'unsplash', id: 'abc123' });
    expect(localStorage.getItem('lastUsedBackgroundId')).toBeNull();
    expect(getActiveWallpaper()).toEqual({ source: 'unsplash', id: 'abc123' });

    setActiveWallpaper({ source: 'local', id: 4 });
    setActiveWallpaper(null);
    expect(localStorage.getItem('activeWallpaper')).toBeNull();
    expect(localStorage.getItem('lastUsedBackgroundId')).toBeNull();
    expect(getActiveWallpaper()).toBeNull();
  });

  it('falls back to the legacy lastUsedBackgroundId', () => {
    localStorage.setItem('lastUsedBackgroundId', '12');
    expect(getActiveWallpaper()).toEqual({ source: 'local', id: 12 });
    localStorage.setItem('activeWallpaper', '{"source":"bogus"}');
    expect(getActiveWallpaper()).toEqual({ source: 'local', id: 12 });
    localStorage.setItem('lastUsedBackgroundId', 'garbage');
    expect(getActiveWallpaper()).toBeNull();
  });

  it('normalizes numeric-string local ids and rejects invalid refs', () => {
    expect(setActiveWallpaper({ source: 'local', id: '5' })).toEqual({ source: 'local', id: 5 });
    expect(() => setActiveWallpaper({ source: 'unsplash', id: '' })).toThrow(TypeError);
    expect(() => setActiveWallpaper({ source: 'web', id: 1 })).toThrow(TypeError);
    expect(getActiveWallpaper()).toEqual({ source: 'local', id: 5 });
  });

  it('survives a throwing localStorage', () => {
    const original = globalThis.localStorage;
    globalThis.localStorage = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
      removeItem() { throw new Error('denied'); },
    };
    try {
      expect(getWallpaperSettings()).toEqual({ ...DEFAULT_SETTINGS, topics: [] });
      expect(getActiveWallpaper()).toBeNull();
      expect(() => setActiveWallpaper({ source: 'local', id: 1 })).not.toThrow();
      expect(() => setWallpaperSettings({ source: 'unsplash' })).not.toThrow();
    } finally {
      globalThis.localStorage = original;
    }
  });
});

describe('sync', () => {
  it('notifies same-tab subscribers synchronously and supports unsubscribe', () => {
    const received = [];
    const off = subscribe((msg) => received.push(msg));
    broadcast('quota-changed');
    expect(received).toEqual([{ type: 'quota-changed', payload: undefined, local: true }]);
    off();
    off();
    broadcast('quota-changed');
    expect(received).toHaveLength(1);
  });

  it('isolates a failing subscriber from the others', () => {
    const received = [];
    unsubscribers.push(subscribe(() => { throw new Error('boom'); }));
    unsubscribers.push(subscribe((msg) => received.push(msg.type)));
    const spy = console.error;
    console.error = () => {};
    try {
      broadcast('library-changed');
    } finally {
      console.error = spy;
    }
    expect(received).toEqual(['library-changed']);
  });

  it('rejects unknown event types', () => {
    expect(() => broadcast('nope')).toThrow(TypeError);
  });
});
