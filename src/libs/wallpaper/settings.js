// Wallpaper settings and the active wallpaper reference, persisted in localStorage
// (existing app convention; `storage` events provide cross-tab sync via sync.js).

import { broadcast } from './sync.js';

export const SETTINGS_KEY = 'wallpaperSettings';
export const ACTIVE_KEY = 'activeWallpaper';
export const LEGACY_ACTIVE_KEY = 'lastUsedBackgroundId';

const SOURCES = ['local', 'unsplash'];
const DISCOVERY_MODES = ['topics', 'keyword', 'random'];
const MAX_TOPICS = 20;
const MAX_TOPIC_LENGTH = 60;
const MAX_KEYWORD_LENGTH = 100;

export const DEFAULT_SETTINGS = Object.freeze({
  source: 'local',
  discoveryMode: 'topics',
  topics: Object.freeze([]),
  keyword: '',
});

function readStorage(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn(`[wallpaper settings] could not write ${key}:`, err);
    return false;
  }
}

function removeStorage(key) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  } catch (err) {
    console.warn(`[wallpaper settings] could not remove ${key}:`, err);
  }
}

function parseJSON(raw) {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeTopics(value) {
  if (!Array.isArray(value)) return [...DEFAULT_SETTINGS.topics];
  const seen = new Set();
  const topics = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const topic = item.trim().slice(0, MAX_TOPIC_LENGTH);
    if (!topic || seen.has(topic)) continue;
    seen.add(topic);
    topics.push(topic);
    if (topics.length >= MAX_TOPICS) break;
  }
  return topics;
}

function normalizeSettings(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    source: SOURCES.includes(input.source) ? input.source : DEFAULT_SETTINGS.source,
    discoveryMode: DISCOVERY_MODES.includes(input.discoveryMode)
      ? input.discoveryMode
      : DEFAULT_SETTINGS.discoveryMode,
    topics: 'topics' in input ? normalizeTopics(input.topics) : [...DEFAULT_SETTINGS.topics],
    keyword: typeof input.keyword === 'string'
      ? input.keyword.trim().slice(0, MAX_KEYWORD_LENGTH)
      : DEFAULT_SETTINGS.keyword,
  };
}

/** Returns a normalized WallpaperRef, or null when `ref` is not a valid reference. */
export function normalizeWallpaperRef(ref) {
  if (!ref || typeof ref !== 'object') return null;
  if (ref.source === 'local') {
    const id = typeof ref.id === 'string' && ref.id.trim() !== '' ? Number(ref.id) : ref.id;
    return typeof id === 'number' && Number.isFinite(id) ? { source: 'local', id } : null;
  }
  if (ref.source === 'unsplash') {
    return typeof ref.id === 'string' && ref.id !== '' ? { source: 'unsplash', id: ref.id } : null;
  }
  return null;
}

export function getWallpaperSettings() {
  return normalizeSettings(parseJSON(readStorage(SETTINGS_KEY)));
}

export function setWallpaperSettings(patch = {}) {
  const current = getWallpaperSettings();
  const next = normalizeSettings({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) });
  writeStorage(SETTINGS_KEY, JSON.stringify(next));
  broadcast('settings-changed', next);
  return next;
}

export function getActiveWallpaper() {
  const stored = normalizeWallpaperRef(parseJSON(readStorage(ACTIVE_KEY)));
  if (stored) return stored;

  // Legacy fallback: the pre-v3 app only remembered the last local image id.
  const legacy = readStorage(LEGACY_ACTIVE_KEY);
  if (legacy == null || legacy.trim() === '') return null;
  const id = Number(legacy);
  return Number.isFinite(id) ? { source: 'local', id } : null;
}

export function setActiveWallpaper(ref) {
  if (ref == null) {
    removeStorage(ACTIVE_KEY);
    removeStorage(LEGACY_ACTIVE_KEY);
    broadcast('active-changed', null);
    return null;
  }

  const normalized = normalizeWallpaperRef(ref);
  if (!normalized) {
    throw new TypeError('setActiveWallpaper expects { source: "local" | "unsplash", id } or null');
  }

  writeStorage(ACTIVE_KEY, JSON.stringify(normalized));
  if (normalized.source === 'local') {
    writeStorage(LEGACY_ACTIVE_KEY, String(normalized.id));
  } else {
    removeStorage(LEGACY_ACTIVE_KEY);
  }
  broadcast('active-changed', normalized);
  return normalized;
}
